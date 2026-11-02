import type { DatabaseSync } from 'node:sqlite'
import { OWNER, fail, ok, t, type PodResult, type PodSession } from 'pod-domain'
import { latestDecisiveReport, openProblem, raiseProblem, resolveProblem } from 'pod-store'
import type { TurnFailure } from '../agents/observer.ts'
import { failureKind, failureReason } from '../chat/turn-errors.ts'
import { isTicket, type Engine } from '../engine/index.ts'
import type { FrontDesk } from '../front/desk.ts'
import type { TaskService } from '../tasks/service.ts'
import type { Effects } from './queue.ts'

/** 模型服务要你处理的错按模型记：model: 后面接模型（没单独设模型的 bot 用默认的，记成 default）。 */
const MODEL_PREFIX = 'model:'

export interface SystemProblemsDeps {
  readonly db: DatabaseSync
  readonly effects: Effects
  readonly engine: Engine
  readonly tasks: TaskService
  readonly front: FrontDesk
  readonly now: () => number
  /** bot 用的模型；没单独设返回 null。 */
  readonly modelOf: (botId: string | null) => string | null
  readonly botName: (botId: string) => string
  /** 系统问题出现、变化或恢复。 */
  readonly changed: () => void
}

/**
 * 系统问题里副作用队列以外的来源和“重试”：
 * - 模型服务要你处理的错（认证失败、额度用完、找不到模型）按模型记一条，这个模型之后有一轮正常结束就算恢复；
 * - 重试：副作用失败过的马上再试；模型的问题标成恢复并重试被它挡住的任务；前台漏掉的消息重新交给前台。
 */
export class SystemProblems {
  private readonly deps: SystemProblemsDeps

  constructor(deps: SystemProblemsDeps) {
    this.deps = deps
  }

  private modelKind(botId: string | null): string {
    return `${MODEL_PREFIX}${this.deps.modelOf(botId) ?? 'default'}`
  }

  /** 一轮结束：看模型服务有没有要你处理的错。 */
  turnEnded(session: PodSession, reason: string, failure: TurnFailure | undefined): void {
    const kind = this.modelKind(session.botId)
    const now = this.deps.now()
    if (failure !== undefined && failureKind(failure) === 'owner') {
      const current = openProblem(this.deps.db, kind)
      const detail = t('{bot}：{reason}（{code}）。处理好以后点重试', { bot: this.deps.botName(session.botId), reason: failureReason(failure), code: failure.code })
      raiseProblem(this.deps.db, kind, detail, (current?.failures ?? 0) + 1, now)
      this.deps.changed()
      return
    }
    if (failure === undefined && reason !== 'aborted' && resolveProblem(this.deps.db, kind, now)) this.deps.changed()
  }

  /** 你点了“重试”：返回重试了几样（几行副作用、几个任务或几条消息）。 */
  retry(kind: string): PodResult<{ readonly retried: number }> {
    const problem = openProblem(this.deps.db, kind)
    if (problem === undefined) return fail('not-found', t('这个问题已经恢复了'))
    let retried: number | undefined
    if (kind.startsWith('effect:')) retried = this.deps.effects.retryAll(kind.slice('effect:'.length))
    else if (kind.startsWith(MODEL_PREFIX)) {
      resolveProblem(this.deps.db, kind, this.deps.now())
      retried = this.retryBlocked(kind)
    } else if (kind === 'front:missed') {
      resolveProblem(this.deps.db, kind, this.deps.now())
      retried = this.deps.front.retryMissed(problem.startedAt)
    }
    if (retried === undefined) return fail('conflict', t('这个问题没法重试'))
    this.deps.changed()
    return ok({ retried })
  }

  /** 被这个模型的故障挡住的工单（受阻汇报是替它记的、带 fault）各重试一次。 */
  private retryBlocked(kind: string): number {
    const rows = this.deps.db.prepare('SELECT id FROM tasks WHERE ended_at IS NULL AND deleted_at IS NULL').all() as unknown as readonly { readonly id: string }[]
    let count = 0
    for (const row of rows) {
      const task = this.deps.engine.tickets.get(row.id)
      if (task === undefined || !isTicket(task) || this.deps.engine.runs.current(task.id) !== undefined || this.modelKind(task.ownerBotId) !== kind) continue
      const report = latestDecisiveReport(this.deps.db, task.id)
      if (report?.status !== 'blocked' || report.data.fault !== 'owner') continue
      if (this.deps.tasks.control(task.id, 'retry', OWNER).ok) count += 1
    }
    return count
  }
}
