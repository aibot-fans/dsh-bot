import type { DatabaseSync } from 'node:sqlite'
import { maskSecrets, t } from 'pod-domain'
import {
  afterCommit,
  cancelEffect,
  effectRows,
  failEffect,
  finishEffect,
  getEffect,
  listEffects,
  maxEffectSeq,
  postponeEffect,
  raiseProblem,
  resolveProblem,
  retryEffect,
  upsertEffect,
  wakeEffects,
  type EffectRow,
} from 'pod-store'

/** 现在做不了（没有空名额、会话在恢复、处理暂停了）：只往后排，不算失败。 */
export class Later extends Error {
  constructor(message = 'later') {
    super(message)
    this.name = 'Later'
  }
}

/** 同一种动作连续失败几次算系统问题。 */
export const FAILURES_BEFORE_PROBLEM = 3

/** 开工、送达、转交、通知、回复、判断、合批送进前台。 */
export type EffectKind = 'open' | 'deliver' | 'relay' | 'notify' | 'reply' | 'judge' | 'front'

export interface EffectRun {
  readonly key: string
  /** 这一行已经连续失败了几次。 */
  readonly attempts: number
  readonly since: number
}

export interface EffectHandler {
  readonly run: (payload: Readonly<Record<string, unknown>>, row: EffectRun) => Promise<void>
  /** 现在最多同时跑几个；0 表示这一种先停着。 */
  readonly limit: () => number
  /** 第一次退避和最长退避，毫秒。 */
  readonly retry: readonly [number, number]
  /** 按登记顺序一个一个来，前面的失败了后面的等着。 */
  readonly ordered: boolean
  /** 这一行的失败不进系统问题（已经显示在对应的任务上）。 */
  readonly quiet: (key: string) => boolean
  /** 在登记顺序之前的排序表达式，比如按待投消息的优先级。 */
  readonly order?: string
  /** 这一行做完、往后排或者失败记下之后（失败次数已经加上）。 */
  readonly settled?: (row: EffectRow, outcome: 'done' | 'later' | 'failed') => void
}

export interface EffectsDeps {
  readonly db: DatabaseSync
  readonly now: () => number
  /** 系统问题出现或恢复。 */
  readonly onHealth: () => void
  readonly warn: (message: string, error?: unknown) => void
}

interface Task {
  readonly kind: EffectKind
  readonly key: string
  done: Promise<void>
}

const PROBLEM_LABELS: Readonly<Record<EffectKind, string>> = {
  open: '开任务会话',
  deliver: '把消息交给会话',
  relay: '转交消息',
  notify: '发通知',
  reply: '往聊天室发消息',
  judge: '自动来源的判断',
  front: '把消息交给前台',
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return maskSecrets(text).text.slice(0, 500)
}

/**
 * 副作用队列：命令在事务里登记要对外做的事，提交后才去做。
 * 每种有自己的并发、退避和顺序；失败不丢，一直按退避重试；同一种连续失败到门槛记一条系统问题，成功一次就恢复。
 * 只在 start 和 stop 之间执行；没做完的留在表里，下次启动接着做。
 */
export class Effects {
  private readonly handlers = new Map<EffectKind, EffectHandler>()
  private readonly tasks = new Set<Task>()
  private seq: number
  private scheduled = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private started = false
  private stopped = false
  private readonly deps: EffectsDeps

  constructor(deps: EffectsDeps) {
    this.deps = deps
    this.seq = maxEffectSeq(deps.db)
  }

  /** 在调用方的事务里登记（或覆盖同 key 的那一行，排队位置不变）；提交后再唤醒。 */
  enqueue(kind: EffectKind, key: string, payload: Readonly<Record<string, unknown>> = {}, delayMs = 0): void {
    this.seq += 1
    const now = this.deps.now()
    upsertEffect(this.deps.db, { kind, key, payload, seq: this.seq, due: now + delayMs, now })
    afterCommit(this.deps.db, () => this.kick())
  }

  handle(kind: EffectKind, run: EffectHandler['run'], options: Partial<Omit<EffectHandler, 'run'>> = {}): void {
    if (this.handlers.has(kind)) throw new Error(`${kind} 已经有执行函数了`)
    const limit = options.limit ?? (() => 1)
    const ordered = options.ordered ?? false
    this.handlers.set(kind, {
      run,
      limit: ordered ? () => Math.min(1, limit()) : limit,
      retry: options.retry ?? [2000, 60_000],
      ordered,
      quiet: options.quiet ?? (() => false),
      ...(options.order === undefined ? {} : { order: options.order }),
      ...(options.settled === undefined ? {} : { settled: options.settled }),
    })
    this.kick()
  }

  pending(kind: EffectKind, key: string): EffectRow | undefined {
    return getEffect(this.deps.db, kind, key)
  }

  /** 撤掉排着的一行；已经在执行的照常做完。 */
  cancel(kind: EffectKind, key: string): void {
    cancelEffect(this.deps.db, kind, key)
    afterCommit(this.deps.db, () => this.report(kind))
  }

  /** 你点了“重试”：失败次数清零、马上再试。 */
  retry(kind: EffectKind, key: string): boolean {
    const found = retryEffect(this.deps.db, kind, key, this.deps.now())
    if (found) afterCommit(this.deps.db, () => this.kick())
    return found
  }

  /** 名额空出来了：往后排着的这一种马上再试。 */
  release(kind: EffectKind): void {
    wakeEffects(this.deps.db, kind, this.deps.now())
    this.kick()
  }

  start(): void {
    this.started = true
    for (const kind of this.handlers.keys()) this.report(kind)
    this.kick()
  }

  /** 不再取新活；正在执行的让它做完，做完的结果不再写库（库马上要关），没做完的下次启动接着做。 */
  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
  }

  kick(): void {
    if (this.scheduled || !this.started || this.stopped) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      this.dispatch()
    })
  }

  /** 没有在跑的、也没有能马上开始的（测试和停机前用）。 */
  async idle(): Promise<void> {
    for (;;) {
      this.dispatch()
      const running = [...this.tasks].map((task) => task.done)
      if (running.length === 0) return
      await Promise.allSettled(running)
    }
  }

  private dispatch(): void {
    if (!this.started || this.stopped) return
    const now = this.deps.now()
    for (const [kind, handler] of this.handlers) {
      try {
        const running = new Set([...this.tasks].filter((task) => task.kind === kind).map((task) => task.key))
        const rows = effectRows(this.deps.db, kind, { ordered: handler.ordered, now, limit: 16 + running.size, ...(handler.order === undefined ? {} : { order: handler.order }) })
        const ready = handler.ordered && running.size > 0 ? [] : rows.filter((row) => row.due <= now && !running.has(row.key))
        let room = ready.length > 0 ? handler.limit() - running.size : 0
        for (const row of ready) {
          if (room <= 0) break
          room -= 1
          this.run(kind, handler, row)
        }
      } catch (error) {
        this.deps.warn(t('副作用队列出错'), error)
      }
    }
    this.arm()
  }

  /** 最早一行到点时再看一遍。 */
  private arm(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (this.stopped) return
    const row = this.deps.db.prepare('SELECT MIN(due) AS due FROM effects').get() as { readonly due: number | null } | undefined
    const due = row?.due ?? null
    if (due === null) return
    const delay = Math.min(60_000, Math.max(50, due - this.deps.now()))
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.kick()
    }, delay)
    this.timer.unref()
  }

  private run(kind: EffectKind, handler: EffectHandler, row: EffectRow): void {
    const task: Task = { kind, key: row.key, done: Promise.resolve() }
    task.done = this.attempt(kind, handler, row)
      .catch((error: unknown) => {
        if (!this.stopped) this.deps.warn(t('副作用队列出错'), error)
      })
      .finally(() => {
        this.tasks.delete(task)
        this.kick()
      })
    this.tasks.add(task)
  }

  private async attempt(kind: EffectKind, handler: EffectHandler, row: EffectRow): Promise<void> {
    let failure: { readonly error: unknown } | undefined
    try {
      await handler.run(row.payload, { key: row.key, attempts: row.attempts, since: row.since })
    } catch (error) {
      failure = { error }
    }
    // 停机时库马上要关：结果不写，这一行下次启动再做一遍（执行函数都能重复做）。
    if (this.stopped) return
    const identity = { kind, key: row.key, seq: row.seq, generation: row.generation }
    if (failure === undefined) finishEffect(this.deps.db, identity)
    else if (failure.error instanceof Later) postponeEffect(this.deps.db, identity, this.deps.now() + handler.retry[0])
    else {
      const delay = Math.min(handler.retry[1], handler.retry[0] * 2 ** Math.min(row.attempts, 16))
      failEffect(this.deps.db, identity, errorText(failure.error), this.deps.now() + delay)
    }
    this.report(kind)
    handler.settled?.(row, failure === undefined ? 'done' : failure.error instanceof Later ? 'later' : 'failed')
  }

  /** 这一种的健康：不安静的行连续失败到门槛就记系统问题，都好了就恢复。 */
  private report(kind: EffectKind): void {
    const handler = this.handlers.get(kind)
    if (handler === undefined) return
    const now = this.deps.now()
    const failing = listEffects(this.deps.db, kind).filter((row) => row.attempts >= FAILURES_BEFORE_PROBLEM && !handler.quiet(row.key))
    const problem = `effect:${kind}`
    const latest = failing.reduce<EffectRow | undefined>((best, row) => (best === undefined || row.seq > best.seq ? row : best), undefined)
    const changed =
      latest === undefined
        ? resolveProblem(this.deps.db, problem, now)
        : raiseProblem(this.deps.db, problem, t('{what}连续失败：{error}', { what: t(PROBLEM_LABELS[kind]), error: latest.error }), Math.max(...failing.map((row) => row.attempts)), now)
    if (changed) this.deps.onHealth()
  }
}
