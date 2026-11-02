import { POD, PRIORITY, t, type PodSession, type Task } from 'pod-domain'
import { noticeSource } from '../agents/messages.ts'
import type { TurnFailure } from '../agents/observer.ts'
import type { SessionRegistry } from '../agents/registry.ts'
import { failureKind, failureReason } from '../chat/turn-errors.ts'
import type { Dispatcher } from '../effects/delivery.ts'
import { isTicket, type Engine } from '../engine/index.ts'
import { nudgeText } from './brief.ts'
import type { TaskReplies } from './replies.ts'
import { ModelRetries, RETRY_DELAYS_MS } from './retries.ts'
import type { TaskService } from './service.ts'

/** 一轮结束却没汇报，最多提醒几次；还没有就记成失败。 */
const MAX_NUDGES = 3

export interface TaskTurnsDeps {
  readonly tasks: TaskService
  readonly engine: Engine
  readonly registry: SessionRegistry
  readonly dispatcher: Dispatcher
  /** 等你：替任务回复任务卡（受阻、停下的原因）。 */
  readonly replies: TaskReplies
  /** 会话还有几个命令在后台跑。 */
  readonly backgroundJobs: (sessionId: string) => number
  /** 任务会话上下文太长时换段；换了就不再提醒。 */
  readonly shouldRotate: (session: PodSession) => boolean
  readonly rotateTask: (session: PodSession, task: Task) => Promise<void>
  readonly notify: (task: Task, event: 'done' | 'failed' | 'stalled') => void
  /** 团队子任务停滞或失败，交给组长处理。 */
  readonly onSubtaskStalled: (task: Task, reason: string) => void
}

interface NudgeState {
  readonly count: number
  readonly fingerprint: string
}

function progressFingerprint(task: Task): string {
  return `${task.acceptance.filter((item) => item.done).length}|${task.note}|${task.status}`
}

/**
 * 任务会话一轮结束后：这次执行还在进行、却没汇报，就催它；催 3 次还没有就记成失败。
 * 模型出错结束的不催：临时的等一会儿自己重试（不算催促），要你处理的（认证、额度、没配模型）记受阻等你。
 * 团队子任务还按旧的做法（按进度有没有变化催，停滞交给组长）。
 */
export class TaskTurns {
  private readonly retries = new ModelRetries()
  private readonly legacyNudges = new Map<string, NudgeState>()
  private readonly deps: TaskTurnsDeps

  constructor(deps: TaskTurnsDeps) {
    this.deps = deps
  }

  /** Pod 停止时取消还没到点的重试。 */
  dispose(): void {
    this.retries.dispose()
  }

  /** 汇报过了、任务结束或停下：不用再重试和催。 */
  clear(taskId: string): void {
    this.retries.clear(taskId)
    this.legacyNudges.delete(taskId)
  }

  onTurnEnd(session: PodSession, reason: string, failure?: TurnFailure): void {
    if (session.kind !== 'task' || reason === 'aborted' || reason === 'blocked') return
    const task = this.deps.tasks.taskOf(session)
    if (task === undefined) return
    if (!isTicket(task)) {
      this.legacyTurnEnd(session, task, failure)
      return
    }
    const run = this.deps.engine.runs.current(task.id)
    if (run?.status !== 'running' || run.sessionId !== session.id) return
    const kind = failure === undefined ? undefined : failureKind(failure)
    if (failure !== undefined && kind === 'transient') {
      this.retryLater(session, task, failure)
      return
    }
    this.retries.clear(task.id)
    if (failure !== undefined && kind === 'owner') {
      this.block(task, t('{reason}。处理好以后点重试', { reason: failureReason(failure) }))
      return
    }
    // 命令转到后台接着跑：跑完 dsh 会叫醒这条会话，这时不催，也不换段（换段会关掉会话，命令跟着停）。
    if (this.deps.backgroundJobs(session.id) > 0) return
    if (this.deps.shouldRotate(session)) {
      void this.deps.rotateTask(session, task)
      return
    }
    const count = this.deps.engine.runs.nudged(task)
    if (count > MAX_NUDGES) {
      this.silent(task, run.id)
      return
    }
    this.deps.dispatcher.enqueue({
      sessionId: session.id,
      mode: 'followup',
      priority: task.urgent ? PRIORITY.urgent : PRIORITY.task,
      text: nudgeText(task, count),
      source: noticeSource(t('提醒汇报任务（第 {count} 次）', { count })),
    })
  }

  /** 模型临时出错：等一会儿叫它从停下的地方接着做，不算催促；重试几次都不行就记受阻。 */
  private retryLater(session: PodSession, task: Task, failure: TurnFailure): void {
    const count = this.retries.schedule(task.id, (attempt) => {
      const run = this.deps.engine.runs.current(task.id)
      if (run?.status !== 'running' || run.sessionId !== session.id) return
      // 这期间它已经动起来了（比如你说了话），不用再叫。
      if (this.deps.dispatcher.isRunning(session.id)) return
      this.deps.dispatcher.enqueue({
        sessionId: session.id,
        mode: 'followup',
        priority: task.urgent ? PRIORITY.urgent : PRIORITY.task,
        text: '[dsh-bot] 刚才模型服务出错，上一轮没做完。从停下的地方接着做。',
        source: noticeSource(t('模型服务出错，第 {attempt} 次重试', { attempt })),
      })
    })
    if (count !== undefined) return
    this.block(task, t('模型服务连着出错，自动重试了 {count} 次都没成（{code}）。服务恢复后点重试', { count: RETRY_DELAYS_MS.length, code: failure.code }))
  }

  /** 要你处理的故障：替任务记一条受阻的汇报（这次执行结束、名额让出），原因以干活的 bot 的名义回复任务卡。 */
  private block(task: Task, reason: string): void {
    const outcome = this.deps.engine.runs.report({
      task,
      author: 'pod',
      status: 'blocked',
      summary: reason,
      report: reason,
      question: '',
      aboutMessage: null,
      replyMessage: null,
      checks: [],
      acceptance: [],
      data: {},
    })
    this.deps.replies.wait(outcome.task, task.ownerBotId ?? POD, { body: reason })
    this.deps.notify({ ...outcome.task, note: reason }, 'stalled')
  }

  /** 催了几次还没汇报：这次执行记成没汇报，替它记一条失败，等你决定重试还是结束。 */
  private silent(task: Task, runId: string): void {
    const reason = t('连续 {MAX_NUDGES} 次提醒都没有汇报，已停下等处理', { MAX_NUDGES })
    this.deps.engine.runs.end(runId, 'silent')
    const outcome = this.deps.engine.runs.report({
      task,
      author: 'pod',
      status: 'failed',
      summary: reason,
      report: reason,
      question: '',
      aboutMessage: null,
      replyMessage: null,
      checks: [],
      acceptance: [],
      data: {},
    })
    this.deps.replies.wait(outcome.task, task.ownerBotId ?? POD, { body: t('连续 {MAX_NUDGES} 次提醒都没有汇报，已停下。要接着做就点任务卡上的“重试”，不要了点“停止”。', { MAX_NUDGES }) })
    this.deps.tasks.tellRequester(outcome.task, `[任务停滞] 「${task.title}」连续 ${MAX_NUDGES} 次提醒都没有汇报，已经停下。可以重试、换人、拆小或者自己来做。`)
    this.deps.notify(outcome.task, 'stalled')
  }

  /** 团队子任务：一轮结束没提交就催，进度连续几次没变化交给组长。 */
  private legacyTurnEnd(session: PodSession, task: Task, failure: TurnFailure | undefined): void {
    if (task.status !== 'running') return
    if (this.deps.registry.activeForTask(task.id, 'task')?.id !== session.id) return
    if (failure !== undefined && failureKind(failure) === 'transient') return
    if (this.deps.backgroundJobs(session.id) > 0) return
    if (this.deps.shouldRotate(session)) {
      void this.deps.rotateTask(session, task)
      return
    }
    const fingerprint = progressFingerprint(task)
    const previous = this.legacyNudges.get(task.id)
    const count = previous === undefined || previous.fingerprint !== fingerprint ? 1 : previous.count + 1
    this.legacyNudges.set(task.id, { count, fingerprint })
    if (count > MAX_NUDGES) {
      this.legacyNudges.delete(task.id)
      const stalled = this.deps.tasks.write(task, { status: 'failed', note: t('连续 {MAX_NUDGES} 次提醒都没有进展，已停下等处理', { MAX_NUDGES }) })
      this.deps.tasks.event(stalled, 'stalled', 'pod', {})
      this.deps.onSubtaskStalled(stalled, stalled.note)
      return
    }
    this.deps.dispatcher.enqueue({
      sessionId: session.id,
      mode: 'followup',
      priority: task.urgent ? PRIORITY.urgent : PRIORITY.task,
      text: nudgeText(task, count),
      source: noticeSource(t('提醒汇报任务（第 {count} 次）', { count })),
    })
  }
}
