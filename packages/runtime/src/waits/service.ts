import type { DatabaseSync } from 'node:sqlite'
import {
  OWNER,
  POD,
  PRIORITY,
  WAIT_KIND_LABELS,
  fail,
  isOpenWait,
  maskSecrets,
  newId,
  ok,
  readId,
  readString,
  truncate,
  type PodResult,
  type PodSession,
  type Task,
  type Wait,
  type WaitKind,
} from 'pod-domain'
import { getWait, insertWait, listWaits, setRootWaitStatus, setWaitStatus, waitsForRoot } from 'pod-store'
import type { Dispatcher } from '../agents/dispatcher.ts'
import type { RoomService } from '../chat/rooms.ts'
import type { Auditor } from '../core/audit.ts'
import type { PodBus } from '../core/bus.ts'

export interface WaitServiceDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly rooms: RoomService
  readonly dispatcher: Dispatcher
  readonly audit: Auditor
  readonly now: () => number
  readonly task: (taskId: string) => Task | undefined
  /** 没绕过去的等你事项会让任务进入“等你”，处理完再回到进行中。 */
  readonly setTaskWaiting: (task: Task, waiting: boolean) => void
  readonly notify: (wait: Wait) => void
}

export interface AskInput {
  readonly session: PodSession
  readonly kind: WaitKind
  readonly title: string
  readonly detail: string
  /** 已经先绕过去了：任务照常推进，交付时列进“前提和待确认”。 */
  readonly bypassed: boolean
  readonly data?: Readonly<Record<string, unknown>>
}

/**
 * 等你处理：只在必须你出面的情况出现。都是异步的——只有卡住的那个任务在等，其他照常；
 * 能绕过的先绕过。你处理之后，答复转回给原来的会话。
 */
export class WaitService {
  private resolvers: ReadonlyMap<WaitKind, (wait: Wait, answer: string) => boolean> = new Map()
  private readonly deps: WaitServiceDeps

  constructor(deps: WaitServiceDeps) {
    this.deps = deps
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  ask(input: AskInput): Wait {
    const task = input.session.taskId === null ? undefined : this.deps.task(input.session.taskId)
    const roomId = task?.roomId ?? input.session.roomId
    const wait = insertWait(this.db, {
      id: newId('wait'),
      kind: input.kind,
      status: input.bypassed ? 'bypassed' : 'open',
      title: truncate(input.title, 120),
      detail: input.detail,
      data: input.data ?? {},
      taskId: task?.id ?? null,
      rootId: task?.rootId ?? null,
      sessionId: input.session.id,
      botId: input.session.botId,
      roomId,
      now: this.deps.now(),
    })
    if (roomId !== null) {
      this.deps.rooms.post(roomId, { author: input.session.botId, kind: 'wait', body: wait.title, data: { waitId: wait.id, taskId: wait.taskId } })
    }
    if (task !== undefined && !input.bypassed) this.deps.setTaskWaiting(task, true)
    this.deps.audit.record('wait.create', input.session.botId, wait.id, { kind: wait.kind, title: wait.title, bypassed: input.bypassed })
    this.deps.bus.emit({ type: 'waits' })
    this.deps.notify(wait)
    return wait
  }

  get(id: string): Wait | undefined {
    return getWait(this.db, id)
  }

  /** “等你处理”列表：还卡着的和已先绕过的。 */
  open(): readonly Wait[] {
    return listWaits(this.db, ['open', 'bypassed'])
  }

  openCountFor(rootId: string): number {
    return waitsForRoot(this.db, rootId).filter(isOpenWait).length
  }

  openCountInRoom(roomId: string): number {
    return this.open().filter((wait) => wait.roomId === roomId).length
  }

  /** 某类事项由别的模块自己处理答复（比如浏览器写操作批准后执行），返回 true 就不再按默认方式转回。 */
  setResolver(kind: WaitKind, resolver: (wait: Wait, answer: string) => boolean): void {
    this.resolvers = new Map([...this.resolvers, [kind, resolver]])
  }

  /** 你处理了一件事：写下答复，转回给原来的会话。 */
  answer(input: unknown): PodResult<Wait> {
    const id = readId(input, 'waitId')
    if (id === undefined) return fail('invalid-input', '缺少等你事项的 id')
    const wait = this.get(id)
    if (wait === undefined) return fail('not-found', '找不到这件事')
    if (!isOpenWait(wait) && wait.status !== 'suspended') return fail('conflict', '这件事已经处理过了')
    const raw = readString(input, 'answer')
    const answer = maskSecrets(raw).text
    const resolved = setWaitStatus(this.db, id, 'resolved', answer === '' ? '已处理' : answer, this.deps.now()) ?? wait
    const handled = this.resolvers.get(resolved.kind)?.(resolved, answer) ?? false
    if (!handled) this.forward(resolved, answer)
    this.afterChange(resolved)
    this.deps.audit.record('wait.answer', OWNER, id, { answer })
    return ok(resolved)
  }

  /** 你说不用管：关闭这件事，告诉原会话按已有的做法继续。 */
  dismiss(input: unknown): PodResult<Wait> {
    const id = readId(input, 'waitId')
    if (id === undefined) return fail('invalid-input', '缺少等你事项的 id')
    const wait = this.get(id)
    if (wait === undefined) return fail('not-found', '找不到这件事')
    const closed = setWaitStatus(this.db, id, 'closed', '不用处理', this.deps.now()) ?? wait
    if (wait.status === 'open') this.forward(closed, '这件事不用管了，按你能做到的继续，并在交付里注明。')
    this.afterChange(closed)
    return ok(closed)
  }

  private forward(wait: Wait, answer: string): void {
    if (wait.sessionId === null) return
    const task = wait.taskId === null ? undefined : this.deps.task(wait.taskId)
    if (task !== undefined && (task.status === 'cancelled' || task.status === 'done')) return
    const text = `[用户对「${wait.title}」的答复]\n[用户原话] ${answer === '' ? '已处理（比如已经登录好了）' : answer}`
    this.deps.dispatcher.enqueue({
      sessionId: wait.sessionId,
      mode: this.deps.dispatcher.isRunning(wait.sessionId) ? 'steer' : 'followup',
      priority: PRIORITY.owner,
      text,
      source: { kind: 'user' },
    })
  }

  private afterChange(wait: Wait): void {
    if (wait.taskId !== null) {
      const task = this.deps.task(wait.taskId)
      const stillBlocked = task !== undefined && this.blockingFor(task.id) > 0
      if (task !== undefined && task.status === 'waiting' && !stillBlocked) this.deps.setTaskWaiting(task, false)
    }
    if (wait.roomId !== null) this.deps.rooms.milestone(wait.roomId, `已处理：${wait.title}`, { waitId: wait.id })
    this.deps.bus.emit({ type: 'waits' })
  }

  private blockingFor(taskId: string): number {
    return this.open().filter((wait) => wait.taskId === taskId && wait.status === 'open').length
  }

  /**
   * 根任务状态变化时，等你事项跟着变：停止时挂起、继续时恢复、取消时关闭；
   * 交付时已绕过的移到交付卡的“前提和待确认”，返回这些事项，由调用方写进结果。
   */
  onRootChange(rootId: string, change: 'stopped' | 'resumed' | 'cancelled' | 'delivered'): readonly Wait[] {
    const now = this.deps.now()
    let moved: readonly Wait[] = []
    if (change === 'stopped') setRootWaitStatus(this.db, rootId, ['open', 'bypassed'], 'suspended', now)
    if (change === 'resumed') setRootWaitStatus(this.db, rootId, ['suspended'], 'open', now)
    if (change === 'cancelled') setRootWaitStatus(this.db, rootId, ['open', 'bypassed', 'suspended'], 'closed', now)
    if (change === 'delivered') {
      moved = waitsForRoot(this.db, rootId).filter((wait) => wait.status === 'bypassed')
      for (const wait of moved) setWaitStatus(this.db, wait.id, 'closed', '已绕过，写进交付的前提和待确认', now)
    }
    this.deps.bus.emit({ type: 'waits' })
    return moved
  }

  /** 交付卡上的一行：已绕过的事项。 */
  static describe(wait: Wait): string {
    return `${WAIT_KIND_LABELS[wait.kind]}：${wait.title}（已先绕过）`
  }

  /** Pod 自己的说明行，比如“写操作执行到一半进程退出，状态未知”。 */
  podNotice(roomId: string | null, body: string): void {
    if (roomId !== null) this.deps.rooms.post(roomId, { author: POD, kind: 'notice', body })
  }
}
