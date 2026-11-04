import type { DatabaseSync } from 'node:sqlite'
import type { EndReason, ReplyTarget, Task, TaskOrigin, TaskStage, TaskStatus, TicketStage } from 'pod-domain'
import { appendTaskEvent, getTask, insertTask, isStanding, openRun, transaction, updateTask, type NewTask, type TaskPatch } from 'pod-store'
import { currentStage, isTicket } from './facts.ts'

export interface TicketDeps {
  readonly db: DatabaseSync
  readonly now: () => number
  /** 任务变了（推页面，节流在调用方）。 */
  readonly changed: (task: Task) => void
  /** 任务结束时撤掉还排着的开工。 */
  readonly cancelLaunch: (taskId: string) => void
  /** 一次执行结束了：名额空出来。 */
  readonly released: () => void
  /** 任务刚结束（还在这个事务里）。 */
  readonly ended: (task: Task) => void
  /** 阶段变了（还在这个事务里）。 */
  readonly restaged: (task: Task) => void
}

export interface OpenTaskInput extends Omit<NewTask, 'status' | 'stage' | 'now' | 'origin' | 'replyTo'> {
  readonly origin: TaskOrigin
  readonly replyTo: readonly ReplyTarget[]
  readonly status?: TaskStatus
  readonly stage?: TaskStage | null
  readonly actor: string
}

/**
 * 引擎的任务部分：工单本身（来由、回复去处、结束和重新打开）。每个命令一个事务，事务里不调 dsh；
 * 写完重算阶段（存一份缓存），旧的 status 列由阶段推出来写，给还没改成读阶段的代码用。
 */
export class Tickets {
  private readonly deps: TicketDeps

  constructor(deps: TicketDeps) {
    this.deps = deps
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  get(id: string): Task | undefined {
    return getTask(this.db, id)
  }

  /** 开任务：来由写入后不改。开工（排第一次执行）由调用方在同一个事务里接着做。 */
  open(input: OpenTaskInput): Task {
    return transaction(this.db, () => {
      const { actor, status, stage, ...rest } = input
      const task = insertTask(this.db, { ...rest, status: status ?? 'queued', stage: stage ?? 'execute', now: this.deps.now() })
      this.event(task, 'task_opened', actor, { title: task.title, origin: input.origin.kind })
      return this.refresh(task.id) ?? task
    })
  }

  /** 改任务的字段（验收项、进度说明、结果……），改完重算阶段。 */
  patch(task: Task, patch: TaskPatch): Task {
    return transaction(this.db, () => {
      updateTask(this.db, task.id, patch, this.deps.now())
      return this.refresh(task.id) ?? task
    })
  }

  /** 结束：完成、你停掉、无需处理。还没结束的执行跟着结束，排着的开工撤掉。 */
  end(taskId: string, reason: EndReason, actor: string, note?: string): Task | undefined {
    return transaction(this.db, () => {
      const task = this.get(taskId)
      if (task === undefined || task.endedAt !== null) return task
      const now = this.deps.now()
      const run = openRun(this.db, task.id)
      if (run !== undefined) {
        this.db.prepare("UPDATE task_runs SET status = 'ended', outcome = ?, ended_at = ? WHERE id = ?").run(reason === 'stopped' ? 'stopped' : 'reported', now, run.id)
        if (run.status === 'running') this.deps.released()
      }
      this.deps.cancelLaunch(task.id)
      updateTask(this.db, task.id, { endedAt: now, endReason: reason, finishedAt: now, nudges: 0, pausedAt: null, ...(note === undefined ? {} : { note }) }, now)
      this.event(task, 'task_ended', actor, { reason })
      // 还没结束的子任务跟着停掉。
      for (const child of this.openChildren(task.id)) this.end(child.id, 'stopped', actor)
      const ended = this.refresh(task.id)
      if (ended !== undefined) this.deps.ended(ended)
      return ended
    })
  }

  /** 重新打开结束了的任务：你在它的话题里又说了话。你停掉的只有你明说继续才打开。 */
  reopen(taskId: string, actor: string, force = false): Task | undefined {
    return transaction(this.db, () => {
      const task = this.get(taskId)
      if (task === undefined || task.endedAt === null) return task
      if (task.endReason === 'stopped' && !force) return undefined
      updateTask(this.db, task.id, { endedAt: null, endReason: null, finishedAt: null }, this.deps.now())
      this.event(task, 'task_reopened', actor, {})
      return this.refresh(task.id)
    })
  }

  /** 这个任务下面还没结束的子任务（工单）。 */
  openChildren(taskId: string): readonly Task[] {
    const rows = this.db.prepare('SELECT id FROM tasks WHERE parent_id = ? AND ended_at IS NULL AND deleted_at IS NULL ORDER BY created_at').all(taskId) as unknown as readonly { readonly id: string }[]
    return rows.flatMap((row) => {
      const child = this.get(row.id)
      return child !== undefined && isTicket(child) ? [child] : []
    })
  }

  /** 后来在别处问的：结果也回在那条消息下面。 */
  addReplyTarget(task: Task, target: ReplyTarget): Task {
    if (task.replyTo.some((item) => item.roomId === target.roomId && item.messageId === target.messageId)) return task
    return this.patch(task, { replyTo: [...task.replyTo, target] })
  }

  event(task: Pick<Task, 'id' | 'rootId'>, kind: string, actor: string, data: Readonly<Record<string, unknown>> = {}): void {
    appendTaskEvent(this.db, { taskId: task.id, rootId: task.rootId, kind, actor, data, now: this.deps.now() })
  }

  /** 按事实重算阶段，存缓存；工单的旧状态也由阶段推出来。阶段或状态变了才算变化。 */
  refresh(taskId: string): Task | undefined {
    const task = this.get(taskId)
    if (task === undefined) return undefined
    const { stage, status } = currentStage(this.db, task)
    const statusChanged = isTicket(task) && status !== task.status
    if (stage === task.ticketStage && !statusChanged) {
      this.deps.changed(task)
      return task
    }
    const patch: TaskPatch = { ticketStage: stage, ...(statusChanged ? { status } : {}) }
    const updated = updateTask(this.db, task.id, patch, this.deps.now()) ?? task
    this.deps.changed(updated)
    if (stage !== task.ticketStage) this.deps.restaged(updated)
    return updated
  }

  /** 启动时把开着的任务的阶段都重算一遍（迁移写的缓存可能过时）。 */
  refreshOpen(): void {
    const rows = this.db.prepare('SELECT id FROM tasks WHERE ended_at IS NULL AND deleted_at IS NULL').all() as unknown as readonly { readonly id: string }[]
    transaction(this.db, () => {
      for (const row of rows) this.refresh(row.id)
    })
  }

  /** 旧版交上来、停在“等你验收”的根任务：现在交了就算做完，启动时一次收尾（常开任务不算）。返回收尾了几个。 */
  settleReviews(): number {
    const rows = this.db
      .prepare("SELECT id FROM tasks WHERE ended_at IS NULL AND deleted_at IS NULL AND parent_id IS NULL AND stage_cache = 'review'")
      .all() as unknown as readonly { readonly id: string }[]
    return rows.filter((row) => !isStanding(this.db, row.id) && this.end(row.id, 'done', 'pod') !== undefined).length
  }

  stageOf(task: Task): TicketStage {
    return currentStage(this.db, task).stage
  }
}
