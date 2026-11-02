import type { DatabaseSync } from 'node:sqlite'
import { checkAcceptance, endsRun, newAcceptance, newId, type ReportStatus, type RunOutcome, type RunReason, type Task, type TaskReport, type TaskRun } from 'pod-domain'
import { endRun, getRun, insertReport, insertRun, isStanding, mergeRunDetail, openRun, runsByStatus, startRun, transaction, updateTask } from 'pod-store'
import { isTicket } from './facts.ts'
import type { Tickets } from './tickets.ts'

export interface RunDeps {
  readonly db: DatabaseSync
  readonly now: () => number
  readonly tickets: Tickets
  /** 登记开工（副作用），提交后才起会话、送开工说明。 */
  readonly launch: (task: Task, run: TaskRun) => void
  /** 一次执行结束了：名额空出来。 */
  readonly released: () => void
}

export interface ReportInput {
  readonly task: Task
  readonly author: string
  readonly status: ReportStatus
  readonly summary: string
  readonly report: string
  readonly question: string
  readonly aboutMessage: string | null
  readonly replyMessage: string | null
  /** 勾的验收项，下标从 0 开始。 */
  readonly checks: readonly number[]
  /** 第一次汇报时按你的原话列出的验收项（任务还没有验收项时才用）。 */
  readonly acceptance: readonly string[]
  readonly data: Readonly<Record<string, unknown>>
}

export interface ReportOutcome {
  readonly report: TaskReport
  readonly task: Task
  /** 就绪而且验收项都过了、没有没核实的：任务完成。 */
  readonly completed: boolean
  /** 常开任务（挂着会一直触发的触发器）：做完这一次也不结束。 */
  readonly standing: boolean
}

/** 排着的执行合并开工原因：新来的消息、子任务的消息接在后面。 */
function mergeDetail(current: Readonly<Record<string, unknown>>, next: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const joined = (key: string): readonly unknown[] => [...(Array.isArray(current[key]) ? current[key] : []), ...(Array.isArray(next[key]) ? next[key] : [])]
  const messages = joined('messages')
  const notices = joined('notices')
  return { ...current, ...next, ...(messages.length === 0 ? {} : { messages }), ...(notices.length === 0 ? {} : { notices }) }
}

/**
 * 引擎的执行部分：每次开工一条执行（排队、进行中、已结束），汇报只增。
 * 同一个任务同时最多一次没结束的执行：进行中的不再排新的（消息直接送进会话），排着的把新原因合并进去。
 */
export class Runs {
  private readonly deps: RunDeps

  constructor(deps: RunDeps) {
    this.deps = deps
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  get(id: string): TaskRun | undefined {
    return getRun(this.db, id)
  }

  current(taskId: string): TaskRun | undefined {
    return openRun(this.db, taskId)
  }

  /**
   * 排一次执行。任务结束了不排（要先重新打开）；已经有进行中的返回 undefined，调用方把消息直接送进会话。
   */
  queue(taskId: string, reason: RunReason, detail: Readonly<Record<string, unknown>> = {}): TaskRun | undefined {
    return transaction(this.db, () => {
      const task = this.deps.tickets.get(taskId)
      if (task === undefined || task.endedAt !== null) return undefined
      const open = openRun(this.db, taskId)
      if (open?.status === 'running') return undefined
      if (open !== undefined) {
        const merged = mergeDetail(open.detail, detail)
        mergeRunDetail(this.db, open.id, merged)
        return { ...open, detail: merged }
      }
      const run = insertRun(this.db, { id: newId('run'), taskId, reason, detail, now: this.deps.now() })
      this.deps.tickets.event(task, 'run_queued', 'pod', { runId: run.id, reason })
      this.deps.launch(task, run)
      this.deps.tickets.refresh(taskId)
      return run
    })
  }

  /** 开工：会话开好、开工说明登记好了。 */
  start(runId: string, sessionId: string): TaskRun | undefined {
    return transaction(this.db, () => {
      const run = getRun(this.db, runId)
      if (run === undefined || run.status !== 'queued') return undefined
      const now = this.deps.now()
      startRun(this.db, runId, sessionId, now)
      const task = this.deps.tickets.get(run.taskId)
      if (task !== undefined) {
        updateTask(this.db, task.id, { nudges: 0, ...(task.startedAt === null ? { startedAt: now } : {}) }, now)
        this.deps.tickets.event(task, 'run_started', 'pod', { runId, sessionId, reason: run.reason })
        this.deps.tickets.refresh(task.id)
      }
      return getRun(this.db, runId)
    })
  }

  /** 结束这次执行；已经结束的不再改。 */
  end(runId: string, outcome: RunOutcome, error: string | null = null): boolean {
    return transaction(this.db, () => {
      const run = getRun(this.db, runId)
      if (run === undefined) return false
      const wasRunning = run.status === 'running'
      if (!endRun(this.db, runId, outcome, error, this.deps.now())) return false
      const task = this.deps.tickets.get(run.taskId)
      if (task !== undefined) {
        this.deps.tickets.event(task, 'run_ended', 'pod', { runId, outcome, ...(error === null ? {} : { error }) })
        this.deps.tickets.refresh(task.id)
      }
      if (wasRunning) this.deps.released()
      return true
    })
  }

  /**
   * 重启恢复：重启前没结束的执行都记成被打断，按任务从旧到新各开一次新的执行（开工原因是重启恢复）。
   * 团队任务还由编排器自己恢复。返回恢复了几个任务。
   */
  recoverInterrupted(): number {
    return transaction(this.db, () => {
      const now = this.deps.now()
      const tasks: Task[] = []
      for (const run of runsByStatus(this.db, 'running')) {
        const task = this.deps.tickets.get(run.taskId)
        if (task === undefined || !isTicket(task)) continue
        endRun(this.db, run.id, 'interrupted', null, now)
        this.deps.tickets.event(task, 'run_ended', 'pod', { runId: run.id, outcome: 'interrupted' })
        if (task.endedAt === null) tasks.push(task)
      }
      const ordered = [...tasks].sort((a, b) => a.createdAt - b.createdAt)
      for (const task of ordered) this.queue(task.id, 'recover', {})
      return ordered.length
    })
  }

  /** 一轮结束没汇报：记一次催促，返回这是第几次。 */
  nudged(task: Task): number {
    const count = task.nudges + 1
    this.deps.tickets.patch(task, { nudges: count })
    return count
  }

  /**
   * 记一次汇报。进展只更新任务卡（进度说明、勾验收项）；别的结束这次执行。
   * 就绪时验收项都过了、也没有没核实的就完成；无需处理直接结束任务。
   */
  report(input: ReportInput): ReportOutcome {
    return transaction(this.db, () => {
      const { task } = input
      const now = this.deps.now()
      const run = openRun(this.db, task.id)
      const report = insertReport(this.db, {
        id: newId('rep'),
        runId: run?.id ?? null,
        taskId: task.id,
        status: input.status,
        summary: input.summary,
        report: input.report,
        question: input.question,
        aboutMessage: input.aboutMessage,
        replyMessage: input.replyMessage,
        checks: input.checks,
        data: input.data,
        author: input.author,
        createdAt: now,
      })
      const listed = task.acceptance.length === 0 && input.acceptance.length > 0 ? newAcceptance(input.acceptance) : task.acceptance
      // 就绪却没写勾哪几项：当作都过了（没核实的另外列出来，有就等你验收）。
      const passed = input.status === 'ready' && input.checks.length === 0 ? listed.map((_, index) => index) : input.checks
      const acceptance = checkAcceptance(listed, passed.filter((index) => index >= 0 && index < listed.length), now)
      updateTask(this.db, task.id, { acceptance, nudges: 0, ...(input.summary === '' ? {} : { note: input.summary }) }, now)
      this.deps.tickets.event(task, 'report_recorded', input.author, { reportId: report.id, status: input.status, summary: input.summary })
      if (run !== undefined && endsRun(input.status)) {
        const wasRunning = run.status === 'running'
        endRun(this.db, run.id, 'reported', null, now)
        if (wasRunning) this.deps.released()
      }
      const unverified = Array.isArray(input.data.unverified) ? input.data.unverified.length : 0
      // 子任务就绪由组长验收，不自己完成。
      // 常开任务（例程、简报）就绪或无需处理只是这一次做完，任务留着等下次到点。
      const standing = isStanding(this.db, task.id)
      const completed = input.status === 'ready' && task.parentId === null && acceptance.every((item) => item.done) && unverified === 0 && !standing
      if (completed) this.deps.tickets.end(task.id, 'done', input.author)
      if (input.status === 'dismissed' && !standing) this.deps.tickets.end(task.id, 'dismissed', input.author)
      const updated = this.deps.tickets.refresh(task.id) ?? task
      return { report, task: updated, completed, standing }
    })
  }
}
