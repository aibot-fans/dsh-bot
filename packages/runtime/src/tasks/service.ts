import type { DatabaseSync } from 'node:sqlite'
import {
  PRIORITY,
  checkAcceptance,
  fail,
  isTerminal,
  newAcceptance,
  newId,
  ok,
  rootTaskFolder,
  type Bot,
  type PodResult,
  type PodSession,
  type Task,
  type TaskActivity,
  type TaskResult,
  type TaskSnapshot,
  type TaskStatus,
} from 'pod-domain'
import {
  activeTasksForBot,
  appendTaskEvent,
  getTask,
  insertTask,
  listRootTasks,
  listTaskEvents,
  listTaskTree,
  updateTask,
  type TaskEvent,
  type TaskPatch,
} from 'pod-store'
import type { Dispatcher } from '../agents/dispatcher.ts'
import { noticeSource, relaySource } from '../agents/messages.ts'
import type { SessionRegistry } from '../agents/registry.ts'
import type { BotService } from '../bots/service.ts'
import type { RoomService } from '../chat/rooms.ts'
import type { Auditor } from '../core/audit.ts'
import type { PodBus } from '../core/bus.ts'
import type { AgentRegistry } from '../dsh.ts'
import type { UsageMeter } from '../usage/meter.ts'
import { composeBrief, nudgeText, resumeText } from './brief.ts'
import { snapshotText } from './snapshot.ts'

/** 一轮结束却没提交，最多提醒几次；还没进展就交回给派活的人。 */
const MAX_NUDGES = 3

export interface TaskServiceDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly bots: BotService
  readonly registry: SessionRegistry
  readonly dispatcher: Dispatcher
  readonly rooms: RoomService
  readonly agents: AgentRegistry
  readonly meter: UsageMeter
  readonly audit: Auditor
  readonly workspaceRoot: string
  readonly now: () => number
  readonly activity: (sessionId: string) => TaskActivity | undefined
  readonly openWaits: (rootId: string) => number
  /** 根任务停止、继续、取消、交付时，等你事项跟着变；交付时返回要写进“前提和待确认”的已绕过事项。 */
  readonly onRootStateChange: (rootId: string, change: 'stopped' | 'resumed' | 'cancelled' | 'delivered') => readonly string[]
  /** 任务完成、失败时发通知。 */
  readonly notify: (task: Task, event: 'done' | 'failed' | 'stalled') => void
  /** 团队子任务提交后交给组长验收，返回进入待验收的子任务。 */
  readonly onSubtaskSubmitted: (task: Task, result: TaskResult) => Task
  /** 团队子任务停滞或失败，交给组长处理。 */
  readonly onSubtaskStalled: (task: Task, reason: string) => void
  /** 任务会话上下文太长时换段；换了就不再提醒。 */
  readonly shouldRotate: (session: PodSession) => boolean
  readonly rotateTask: (session: PodSession, task: Task) => Promise<void>
  /** 每条任务事件（验收、复盘经验……）写下后通知，自我优化从这里取反馈。 */
  readonly onEvent?: (task: Task, kind: string, actor: string, data: Readonly<Record<string, unknown>>) => void
}

export interface DelegateInput {
  readonly requester: PodSession
  readonly bot: Bot
  readonly title: string
  readonly brief: string
  readonly deliverable: string
  readonly acceptance: readonly string[]
  readonly assumptions: readonly string[]
  readonly urgent: boolean
  readonly reason: string
}

export type ControlAction = 'pause' | 'resume' | 'stop' | 'cancel'

interface NudgeState {
  readonly count: number
  readonly fingerprint: string
}

function progressFingerprint(task: Task): string {
  return `${task.acceptance.filter((item) => item.done).length}|${task.note}|${task.status}`
}

/**
 * 任务：委派（L1，也包括主管交给自己的后台活）、进度、提交、提醒，以及暂停、停止、继续、取消。
 * 团队任务（L2、L3）的拆分和调度在 M4 的编排器里，复用这里的子任务执行部分。
 */
export class TaskService {
  private readonly waiters = new Map<string, Set<(task: Task) => void>>()
  private readonly nudges = new Map<string, NudgeState>()
  private readonly emitTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly deps: TaskServiceDeps

  constructor(deps: TaskServiceDeps) {
    this.deps = deps
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  get(id: string): Task | undefined {
    return getTask(this.db, id)
  }

  tree(rootId: string): readonly Task[] {
    return listTaskTree(this.db, rootId)
  }

  rootOf(taskId: string): string | undefined {
    return this.get(taskId)?.rootId
  }

  /** 最近的根任务，新的在前。 */
  roots(limit: number, statuses?: readonly TaskStatus[]): readonly Task[] {
    return listRootTasks(this.db, { limit, ...(statuses === undefined ? {} : { status: statuses }) })
  }

  /** 某个 bot 手上和排队的任务数，分配打分和名片上用。 */
  activeLoad(botId: string): number {
    return activeTasksForBot(this.db, botId).length
  }

  events(rootId: string): readonly TaskEvent[] {
    return listTaskEvents(this.db, rootId)
  }

  /** 等你事项让任务进入或离开“等你”。 */
  setWaiting(task: Task, waiting: boolean): void {
    if (waiting && (task.status === 'running' || task.status === 'review')) this.write(task, { status: 'waiting' })
    if (!waiting && task.status === 'waiting') this.write(task, { status: 'running' })
  }

  /** 任务变化通知页面；同一个任务一秒内最多推一次。 */
  touched(task: Pick<Task, 'id' | 'rootId'>): void {
    const key = task.rootId
    if (this.emitTimers.has(key)) return
    this.deps.bus.emit({ type: 'task', taskId: task.id, rootId: task.rootId })
    const timer = setTimeout(() => {
      this.emitTimers.delete(key)
      this.deps.bus.emit({ type: 'task', taskId: task.id, rootId: task.rootId })
    }, 1000)
    timer.unref()
    this.emitTimers.set(key, timer)
  }

  private write(task: Task, patch: TaskPatch): Task {
    const updated = updateTask(this.db, task.id, patch, this.deps.now()) ?? task
    this.touched(updated)
    return updated
  }

  event(task: Task, kind: string, actor: string, data: Readonly<Record<string, unknown>> = {}): void {
    appendTaskEvent(this.db, { taskId: task.id, rootId: task.rootId, kind, actor, data, now: this.deps.now() })
    this.deps.onEvent?.(task, kind, actor, data)
  }

  /** 把一件事交给一个 bot：建任务、开任务会话、在对话里放任务卡、投出任务说明。 */
  async delegate(input: DelegateInput): Promise<PodResult<Task>> {
    const { requester, bot } = input
    const now = this.deps.now()
    const id = newId('task')
    const task = insertTask(this.db, {
      id,
      rootId: id,
      parentId: null,
      roomId: requester.roomId,
      teamId: null,
      title: input.title,
      brief: input.brief,
      kind: '',
      deliverable: input.deliverable,
      acceptance: newAcceptance(input.acceptance),
      dependsOn: [],
      needs: { browser: false, shell: false },
      ownerBotId: bot.id,
      level: bot.role === 'lead' ? 'L0' : 'L1',
      status: 'running',
      stage: 'execute',
      folder: rootTaskFolder({ id, title: input.title }),
      urgent: input.urgent,
      tainted: requester.tainted,
      createdBy: requester.id,
      requesterSession: requester.id,
      now,
    })
    const updated = this.write(task, { startedAt: now })
    this.event(updated, 'delegated', requester.botId, { to: bot.id, reason: input.reason })
    this.deps.audit.record('task.delegate', requester.botId, id, { to: bot.id, title: input.title, reason: input.reason })
    let session: PodSession
    try {
      session = await this.deps.registry.open({
        bot,
        kind: 'task',
        roomId: null,
        taskId: id,
        folder: updated.folder,
        title: `Pod · 任务 · ${input.title}`,
        tainted: requester.tainted,
      })
    } catch (error) {
      const failed = this.write(updated, { status: 'failed', note: `开任务会话失败：${error instanceof Error ? error.message : String(error)}` })
      return fail('session-unavailable', failed.note)
    }
    if (updated.roomId !== null) {
      this.deps.rooms.post(updated.roomId, {
        author: requester.botId,
        kind: 'task-card',
        body: input.title,
        data: { taskId: id, rootId: id },
        sessionId: session.id,
      })
    }
    const fromName = this.deps.bots.get(requester.botId)?.name ?? '主管'
    this.deps.dispatcher.enqueue({
      sessionId: session.id,
      mode: 'followup',
      priority: input.urgent ? PRIORITY.urgent : PRIORITY.task,
      text: composeBrief(updated, {
        fromName,
        assumptions: input.assumptions,
        conventions: [],
        upstream: [],
        workspaceRoot: this.deps.workspaceRoot,
      }),
      source: relaySource(requester.id),
    })
    return ok(updated)
  }

  /** 等任务结束，最多等 ms；超时返回 undefined（任务照常在后台进行）。 */
  awaitResult(taskId: string, ms: number, signal: AbortSignal): Promise<Task | undefined> {
    const current = this.get(taskId)
    if (current !== undefined && isTerminal(current.status)) return Promise.resolve(current)
    return new Promise((resolve) => {
      const listeners = this.waiters.get(taskId) ?? new Set()
      const done = (task: Task | undefined): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        listeners.delete(onFinish)
        if (listeners.size === 0) this.waiters.delete(taskId)
        resolve(task)
      }
      const onFinish = (task: Task): void => done(task)
      const abort = (): void => done(undefined)
      const timer = setTimeout(() => done(undefined), ms)
      timer.unref()
      signal.addEventListener('abort', abort)
      listeners.add(onFinish)
      this.waiters.set(taskId, listeners)
    })
  }

  private hasWaiter(taskId: string): boolean {
    return (this.waiters.get(taskId)?.size ?? 0) > 0
  }

  private finish(task: Task): void {
    for (const listener of [...(this.waiters.get(task.id) ?? [])]) listener(task)
  }

  /** 任务会话所属的任务。 */
  taskOf(session: PodSession): Task | undefined {
    return session.taskId === null ? undefined : this.get(session.taskId)
  }

  /** update_task：勾验收项（编号从 1 开始）、写进度说明。 */
  progress(session: PodSession, check: readonly number[], note: string): PodResult<Task> {
    const task = this.taskOf(session)
    if (task === undefined || session.kind !== 'task') return fail('not-found', '这条会话没有对应的任务')
    if (isTerminal(task.status)) return fail('conflict', `任务已经${task.status === 'done' ? '完成' : '结束'}`)
    const indexes = check.map((index) => index - 1).filter((index) => index >= 0 && index < task.acceptance.length)
    const acceptance = checkAcceptance(task.acceptance, indexes, this.deps.now())
    const updated = this.write(task, { acceptance, ...(note === '' ? {} : { note }) })
    if (indexes.length > 0) this.event(updated, 'checked', session.botId, { items: indexes.map((index) => task.acceptance[index]?.text ?? '') })
    return ok(updated)
  }

  /** complete_task：提交结果。单个 bot 的任务提交即交付；团队子任务交给组长验收（M4）。 */
  complete(session: PodSession, result: TaskResult): PodResult<Task> {
    const task = this.taskOf(session)
    if (task === undefined || session.kind !== 'task') return fail('not-found', '这条会话没有对应的任务')
    if (isTerminal(task.status)) return fail('conflict', '任务已经结束')
    if (task.status === 'review') return fail('conflict', '已经提交过了，正在等组长验收')
    if (task.parentId !== null) {
      const submitted = this.deps.onSubtaskSubmitted(task, result)
      this.event(submitted, 'submitted', session.botId, { summary: result.summary, files: result.files })
      this.nudges.delete(task.id)
      return ok(submitted)
    }
    const now = this.deps.now()
    const acceptance = task.acceptance.map((item) => (item.done ? item : { ...item, done: true, at: now }))
    const bypassed = this.deps.onRootStateChange(task.rootId, 'delivered')
    const merged: TaskResult = { ...result, unverified: [...result.unverified, ...bypassed] }
    const delivered = this.write(task, { status: 'done', stage: 'done', result: merged, acceptance, finishedAt: now })
    this.event(delivered, 'completed', session.botId, { summary: result.summary, files: result.files })
    const bot = this.deps.bots.get(session.botId)
    this.deps.rooms.milestone(delivered.roomId, `${bot?.name ?? 'bot'} 交付了「${delivered.title}」`, { taskId: delivered.id })
    this.nudges.delete(delivered.id)
    const awaited = this.hasWaiter(delivered.id)
    this.finish(delivered)
    if (!awaited) this.tellRequester(delivered, `[任务交付] 「${delivered.title}」已完成，任务卡已经变成交付卡发给用户。摘要：${result.summary}`)
    this.deps.notify(delivered, 'done')
    if (bot !== undefined && bot.temporary && bot.role === 'member') this.retireTemporary(bot)
    return ok(this.get(delivered.id) ?? delivered)
  }

  /** 后台任务结束后告诉派活的会话：用 inject，不唤醒它，下一轮自然带上。 */
  private tellRequester(task: Task, text: string): void {
    if (task.requesterSession === null) return
    this.deps.dispatcher.enqueue({
      sessionId: task.requesterSession,
      mode: 'inject',
      priority: PRIORITY.task,
      text,
      source: noticeSource(text),
    })
  }

  /** 临时 bot 手上没活了就归档（30 天内可恢复）。 */
  private retireTemporary(bot: Bot): void {
    const busy = this.deps.registry
      .active()
      .some((session) => session.botId === bot.id && session.taskId !== null && !isTerminal(this.get(session.taskId)?.status ?? 'done'))
    if (!busy) this.deps.bots.archiveById(bot.id, 'pod')
  }

  /** 一轮结束：任务会话还没提交，就提醒它继续；连续几次没进展，交回给派活的人。 */
  onTurnEnd(session: PodSession, reason: string): void {
    if (session.kind !== 'task') return
    const task = this.taskOf(session)
    if (task === undefined || task.status !== 'running') return
    if (reason === 'aborted' || reason === 'blocked') return
    const active = this.deps.registry.activeForTask(task.id, 'task')
    if (active?.id !== session.id) return
    if (this.deps.shouldRotate(session)) {
      void this.deps.rotateTask(session, task)
      return
    }
    const fingerprint = progressFingerprint(task)
    const previous = this.nudges.get(task.id)
    const count = previous === undefined || previous.fingerprint !== fingerprint ? 1 : previous.count + 1
    this.nudges.set(task.id, { count, fingerprint })
    if (count > MAX_NUDGES) {
      this.stall(task)
      return
    }
    const text = nudgeText(task, count)
    this.deps.dispatcher.enqueue({
      sessionId: session.id,
      mode: 'followup',
      priority: task.urgent ? PRIORITY.urgent : PRIORITY.task,
      text,
      source: noticeSource(`提醒提交任务（第 ${count} 次）`),
    })
  }

  private stall(task: Task): void {
    const updated = this.write(task, { status: 'failed', note: `连续 ${MAX_NUDGES} 次提醒都没有进展，已停下等处理` })
    this.event(updated, 'stalled', 'pod', {})
    if (updated.parentId !== null) {
      this.deps.onSubtaskStalled(updated, updated.note)
      return
    }
    this.deps.rooms.milestone(updated.roomId, `「${updated.title}」多次提醒仍没有进展，已停下`, { taskId: updated.id })
    this.finish(updated)
    this.tellRequester(updated, `[任务停滞] 「${updated.title}」连续 ${MAX_NUDGES} 次提醒都没有进展，已经停下。可以换人、拆小或者自己来做。`)
    this.deps.notify(updated, 'stalled')
  }

  /** 暂停、继续、停止、取消；作用于整棵任务树。 */
  control(taskId: string, action: ControlAction, actor: string): PodResult<Task> {
    const root = this.get(this.rootOf(taskId) ?? taskId)
    if (root === undefined) return fail('not-found', '找不到这个任务')
    const tree = this.tree(root.id)
    const now = this.deps.now()
    const sessions = tree.flatMap((task) => this.deps.registry.forTask(task.id)).filter((session) => session.status === 'active')
    const target = (task: Task): TaskStatus | undefined => {
      switch (action) {
        case 'pause':
          return task.status === 'running' || task.status === 'waiting' ? 'paused' : undefined
        case 'resume':
          // 从没开工过的子任务回到排队，由调度按依赖派出；开过工的接着做。
          if (task.status !== 'paused' && task.status !== 'stopped') return undefined
          return task.startedAt === null && task.parentId !== null ? 'queued' : 'running'
        case 'stop':
          return isTerminal(task.status) || task.status === 'stopped' ? undefined : 'stopped'
        case 'cancel':
          return isTerminal(task.status) ? undefined : 'cancelled'
      }
    }
    const changed = tree.filter((task) => target(task) !== undefined)
    if (changed.length === 0) return fail('conflict', '任务现在的状态不能这样操作')
    for (const task of changed) {
      const status = target(task)
      if (status === undefined) continue
      const previous = task.status
      const updated = this.write(task, { status, ...(status === 'cancelled' ? { finishedAt: now } : {}) })
      if (action === 'resume' && status === 'running') this.resumeSession(updated, previous === 'stopped' ? 'stopped' : 'paused')
    }
    if (action === 'stop' || action === 'cancel') {
      for (const session of sessions) {
        this.deps.dispatcher.cancelPending(session.id)
        this.deps.agents.get(session.id)?.cancel({ kind: 'user' })
      }
    }
    this.deps.onRootStateChange(root.id, action === 'cancel' ? 'cancelled' : action === 'stop' ? 'stopped' : 'resumed')
    const labels: Readonly<Record<ControlAction, string>> = { pause: '暂停', resume: '继续', stop: '停止', cancel: '取消' }
    this.event(root, `control.${action}`, actor, {})
    this.deps.audit.record(`task.${action}`, actor, root.id, { title: root.title })
    this.deps.rooms.milestone(root.roomId, `「${root.title}」已${labels[action]}`, { taskId: root.id })
    const after = this.get(root.id) ?? root
    if (action === 'cancel') this.finish(after)
    return ok(after)
  }

  private resumeSession(task: Task, after: 'paused' | 'stopped'): void {
    const session = this.deps.registry.activeForTask(task.id, 'task')
    if (session === undefined) return
    this.nudges.delete(task.id)
    this.deps.dispatcher.enqueue({
      sessionId: session.id,
      mode: 'followup',
      priority: task.urgent ? PRIORITY.urgent : PRIORITY.task,
      text: resumeText(task, after),
      source: noticeSource('任务继续'),
    })
  }

  /**
   * 任务暂停、停止或取消后，在下一步开始前拦住干这个任务的会话（执行、组长协调、咨询），正在进行的工具调用照常做完。
   * 群里和你聊天的会话不拦：它们也带着群所属任务的 id，但任务停了你在群里说话、@ 成员照样要有人回。
   */
  shouldBlockStep(sessionId: string): boolean {
    const session = this.deps.registry.get(sessionId)
    if (session === undefined || session.taskId === null || session.kind === 'chat') return false
    const task = this.get(session.taskId)
    return task !== undefined && (task.status === 'paused' || task.status === 'stopped' || task.status === 'cancelled')
  }

  /** 把你的纠正或补充转达给任务：必须带着你的原话。 */
  relay(taskId: string, ownerQuote: string, message: string, from: PodSession): PodResult<Task> {
    const task = this.get(taskId)
    if (task === undefined) return fail('not-found', '找不到这个任务')
    if (isTerminal(task.status)) return fail('conflict', '任务已经结束，新的要求请建新任务')
    if (ownerQuote === '') return fail('invalid-input', '转达必须原样引用用户的话')
    const session = this.deps.registry.activeForTask(task.id, 'task') ?? this.deps.registry.activeForTask(task.id, 'coord')
    if (session === undefined) return fail('not-found', '这个任务现在没有在执行的会话')
    const text = `[用户补充，经${this.deps.bots.get(from.botId)?.name ?? '主管'}转达]\n[用户原话] ${ownerQuote}${message === '' ? '' : `\n说明：${message}`}`
    this.deps.dispatcher.enqueue({
      sessionId: session.id,
      mode: this.deps.dispatcher.isRunning(session.id) ? 'steer' : 'followup',
      priority: PRIORITY.owner,
      text,
      source: relaySource(from.id),
    })
    this.event(task, 'relayed', from.botId, { quote: ownerQuote, message })
    this.deps.rooms.post(task.roomId ?? from.roomId ?? '', {
      author: 'pod',
      kind: 'receipt',
      body: `已转达给「${task.title}」，下一步生效`,
      data: { taskId: task.id },
    })
    return ok(task)
  }

  /** “直接对任务说”：你的话直接进任务会话。 */
  talk(taskId: string, text: string): PodResult<Task> {
    const task = this.get(taskId)
    if (task === undefined) return fail('not-found', '找不到这个任务')
    const session = this.deps.registry.activeForTask(task.id, 'task') ?? this.deps.registry.activeForTask(task.id, 'coord')
    if (session === undefined) return fail('not-found', '这个任务现在没有在执行的会话')
    this.deps.dispatcher.enqueue({
      sessionId: session.id,
      mode: this.deps.dispatcher.isRunning(session.id) ? 'steer' : 'followup',
      priority: PRIORITY.owner,
      text: `[用户原话，直接对任务说] ${text}`,
      source: { kind: 'user' },
    })
    this.event(task, 'owner-talk', 'owner', { text })
    return ok(task)
  }

  snapshot(taskId: string): TaskSnapshot | undefined {
    const task = this.get(taskId)
    if (task === undefined) return undefined
    const tree = this.tree(task.rootId)
    const children = task.parentId === null ? tree.filter((item) => item.parentId === task.id) : []
    const activityFor = (id: string): TaskActivity | undefined => {
      const session = this.deps.registry.activeForTask(id, 'task') ?? this.deps.registry.activeForTask(id, 'coord')
      return session === undefined ? undefined : this.deps.activity(session.id)
    }
    const childActivity = Object.fromEntries(
      children.map((child) => [child.id, activityFor(child.id)]).filter((entry): entry is [string, TaskActivity] => entry[1] !== undefined),
    )
    const usage = this.deps.meter.forRoot(task.rootId)
    const own = this.deps.registry.activeForTask(task.id, 'task') ?? this.deps.registry.activeForTask(task.id, 'coord')
    return {
      task,
      children,
      sessionId: own?.id ?? null,
      activity: activityFor(task.id) ?? null,
      childActivity,
      ownerName: task.ownerBotId === null ? null : (this.deps.bots.get(task.ownerBotId)?.name ?? null),
      cost: usage.cost,
      tokens: usage.tokens,
      waits: this.deps.openWaits(task.rootId),
    }
  }

  snapshotTextFor(taskId: string): string | undefined {
    const snapshot = this.snapshot(taskId)
    if (snapshot === undefined) return undefined
    return snapshotText(snapshot, (botId) => (botId === null ? undefined : this.deps.bots.get(botId)?.name), this.deps.now())
  }
}
