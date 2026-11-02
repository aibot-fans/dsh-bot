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
  t,
  type Bot,
  type OriginQuote,
  type PodResult,
  type PodSession,
  type Task,
  type TaskActivity,
  type TaskOrigin,
  type TaskResult,
  type TaskSnapshot,
  type TaskStatus,
} from 'pod-domain'
import {
  activeTasksForBot,
  appendTaskEvent,
  findDelegated,
  getTask,
  latestReport,
  latestRun,
  listRootTasks,
  listTaskEvents,
  listTaskTree,
  stuckDelivery,
  transaction,
  unansweredOwnerMessages,
  updateTask,
  type TaskEvent,
  type TaskPatch,
} from 'pod-store'
import { noticeSource, ownerSource, relaySource } from '../agents/messages.ts'
import type { SessionRegistry } from '../agents/registry.ts'
import type { BotService } from '../bots/service.ts'
import type { RoomService } from '../chat/rooms.ts'
import type { Auditor } from '../core/audit.ts'
import type { PodBus } from '../core/bus.ts'
import type { AgentRegistry, MessageSource } from '../dsh.ts'
import type { Dispatcher } from '../effects/delivery.ts'
import { isTicket, type Engine } from '../engine/index.ts'
import type { UsageMeter } from '../usage/meter.ts'
import { snapshotText } from './snapshot.ts'

/** 给任务的消息连续交不出去几次，任务卡上显示“消息没送到”。 */
const UNDELIVERED_AFTER = 3

/** 派活时最多把你的几句原话放进来由。 */
const ORIGIN_QUOTES = 5

export interface TaskServiceDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly engine: Engine
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
  /** 团队子任务提交后交给组长验收，返回进入待验收的子任务。 */
  readonly onSubtaskSubmitted: (task: Task, result: TaskResult) => Task
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
  /** 来由里的原话；不给就取派活的聊天室里你还没得到回复的话。 */
  readonly quotes?: readonly OriginQuote[]
}

/** 暂停是停下这次执行；继续开一次新的；停止、取消结束任务；重试再做一次；收下是你验收通过。 */
export type ControlAction = 'pause' | 'resume' | 'stop' | 'cancel' | 'retry' | 'accept'

const CONTROL_NOTES: Readonly<Record<ControlAction, string>> = {
  pause: '「{title}」已暂停',
  resume: '「{title}」已继续',
  stop: '「{title}」已停止',
  cancel: '「{title}」已取消',
  retry: '「{title}」重新做一次',
  accept: '「{title}」你收下了',
}

/**
 * 任务：派活、你的话转给任务、暂停继续停止重试收下、任务卡上的快照。
 * 单个 bot 的任务是工单（引擎按执行和汇报管，阶段由事实推出）；团队任务的拆分和调度还在编排器里，状态照旧。
 */
export class TaskService {
  private readonly waiters = new Map<string, Set<(task: Task) => void>>()
  private readonly emitTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly deps: TaskServiceDeps

  constructor(deps: TaskServiceDeps) {
    this.deps = deps
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  private get engine(): Engine {
    return this.deps.engine
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

  /** 这条会话这一轮（从 since 起）已经派过同名的任务了吗：模型重复调用 delegate 时不再建第二个。 */
  delegatedSince(requesterSession: string, title: string, since: number): Task | undefined {
    return findDelegated(this.db, requesterSession, title, since)
  }

  /** 等你事项让任务进入或离开“等你”；工单的阶段由开着的等你推出来。 */
  setWaiting(task: Task, waiting: boolean): void {
    if (isTicket(task)) {
      this.engine.tickets.refresh(task.id)
      return
    }
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

  /** 改任务字段：工单经引擎（阶段跟着重算），团队任务照旧直接写。 */
  write(task: Task, patch: TaskPatch): Task {
    if (isTicket(task)) return this.engine.tickets.patch(task, patch)
    const updated = updateTask(this.db, task.id, patch, this.deps.now()) ?? task
    this.touched(updated)
    return updated
  }

  event(task: Task, kind: string, actor: string, data: Readonly<Record<string, unknown>> = {}): void {
    appendTaskEvent(this.db, { taskId: task.id, rootId: task.rootId, kind, actor, data, now: this.deps.now() })
    this.deps.onEvent?.(task, kind, actor, data)
  }

  /** 派活的聊天室里你还没得到回复的话：放进来由。 */
  private ownerQuotes(requester: PodSession): readonly OriginQuote[] {
    if (requester.roomId === null) return []
    return unansweredOwnerMessages(this.db, requester.roomId, requester.botId, ORIGIN_QUOTES).map((message) => ({ messageId: message.id, author: t('用户'), text: message.body }))
  }

  /** 把一件事交给一个 bot：开任务（来由原样放进来）、排第一次执行、在对话里放任务卡；会话由开工副作用去开。 */
  delegate(input: DelegateInput): Promise<PodResult<Task>> {
    const { requester, bot } = input
    const id = newId('task')
    const quotes = input.quotes ?? this.ownerQuotes(requester)
    const origin: TaskOrigin = {
      kind: quotes.length > 0 ? 'owner' : 'bot',
      quotes,
      requester: quotes.length > 0 ? 'owner' : requester.botId,
      roomId: requester.roomId,
      rule: null,
      title: input.title,
      note: input.brief,
    }
    const task = transaction(this.db, () => {
      const opened = this.engine.tickets.open({
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
        folder: rootTaskFolder({ id, title: input.title }),
        urgent: input.urgent,
        tainted: requester.tainted,
        createdBy: requester.id,
        requesterSession: requester.id,
        origin,
        replyTo: requester.roomId === null ? [] : [{ roomId: requester.roomId, messageId: quotes.at(-1)?.messageId ?? null }],
        actor: requester.botId,
      })
      this.event(opened, 'delegated', requester.botId, { to: bot.id, reason: input.reason })
      this.engine.runs.queue(opened.id, 'new', { assumptions: input.assumptions })
      return this.get(id) ?? opened
    })
    this.deps.audit.record('task.delegate', requester.botId, id, { to: bot.id, title: input.title, reason: input.reason })
    if (task.roomId !== null) {
      this.deps.rooms.post(task.roomId, { author: requester.botId, kind: 'task-card', body: input.title, data: { taskId: id, rootId: id } })
    }
    return Promise.resolve(ok(task))
  }

  /** 等任务有结果（结束、就绪、受阻、失败），最多等 ms；超时返回 undefined（任务照常在后台进行）。 */
  awaitResult(taskId: string, ms: number, signal: AbortSignal): Promise<Task | undefined> {
    const current = this.get(taskId)
    if (current !== undefined && (current.endedAt !== null || isTerminal(current.status))) return Promise.resolve(current)
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

  hasWaiter(taskId: string): boolean {
    return (this.waiters.get(taskId)?.size ?? 0) > 0
  }

  /** 有结果了：叫醒等着它的 delegate。 */
  finish(task: Task): void {
    for (const listener of [...(this.waiters.get(task.id) ?? [])]) listener(task)
  }

  /** 任务会话所属的任务。 */
  taskOf(session: PodSession): Task | undefined {
    return session.taskId === null ? undefined : this.get(session.taskId)
  }

  /** 团队子任务的进展：勾验收项（编号从 1 开始）、写进度说明。 */
  progress(session: PodSession, check: readonly number[], note: string): PodResult<Task> {
    const task = this.taskOf(session)
    if (task === undefined || session.kind !== 'task') return fail('not-found', t('这条会话没有对应的任务'))
    if (isTerminal(task.status)) return fail('conflict', task.status === 'done' ? t('任务已经完成') : t('任务已经结束'))
    const indexes = check.map((index) => index - 1).filter((index) => index >= 0 && index < task.acceptance.length)
    const acceptance = checkAcceptance(task.acceptance, indexes, this.deps.now())
    const updated = this.write(task, { acceptance, ...(note === '' ? {} : { note }) })
    if (indexes.length > 0) this.event(updated, 'checked', session.botId, { items: indexes.map((index) => task.acceptance[index]?.text ?? '') })
    return ok(updated)
  }

  /** 团队子任务交上来：交给组长验收。 */
  submit(session: PodSession, result: TaskResult): PodResult<Task> {
    const task = this.taskOf(session)
    if (task === undefined || session.kind !== 'task') return fail('not-found', t('这条会话没有对应的任务'))
    if (isTerminal(task.status)) return fail('conflict', t('任务已经结束'))
    if (task.status === 'review') return fail('conflict', t('已经提交过了，正在等组长验收'))
    const submitted = this.deps.onSubtaskSubmitted(task, result)
    this.event(submitted, 'submitted', session.botId, { summary: result.summary, files: result.files })
    return ok(submitted)
  }

  /** 后台任务有结果后告诉派活的会话：用 inject，不唤醒它，下一轮自然带上。 */
  tellRequester(task: Task, text: string): void {
    if (task.requesterSession === null) return
    this.deps.dispatcher.enqueue({ sessionId: task.requesterSession, mode: 'inject', priority: PRIORITY.task, text, source: noticeSource(text) })
  }

  /** 临时 bot 手上没活了就归档（30 天内可恢复）。 */
  retireTemporary(bot: Bot): void {
    const busy = this.deps.registry
      .active()
      .some((session) => session.botId === bot.id && session.taskId !== null && this.get(session.taskId)?.endedAt === null)
    if (!busy) this.deps.bots.archiveById(bot.id, 'pod')
  }

  /**
   * 你的话（或转达的话）交给任务：在做就直接送进会话（正在跑插进当前这一轮）；没在做就开一次新的执行；
   * 结束了的重新打开再做，你停掉的除外。团队任务照旧送进在执行的会话。
   */
  sendToTask(task: Task, text: string, source: MessageSource, quote: string): PodResult<Task> {
    if (isTicket(task)) {
      if (task.endedAt !== null) {
        if (task.endReason === 'stopped') return fail('conflict', t('任务已经停掉了；要接着做，先点继续'))
        this.engine.tickets.reopen(task.id, source.kind === 'user' ? 'owner' : 'pod')
      }
      const run = this.engine.runs.current(task.id)
      if (run?.status === 'running' && run.sessionId !== null) {
        this.deliver(run.sessionId, text, source)
        return ok(this.get(task.id) ?? task)
      }
      this.engine.runs.queue(task.id, 'message', { messages: [quote] })
      return ok(this.get(task.id) ?? task)
    }
    if (isTerminal(task.status)) return fail('conflict', t('任务已经结束，新的要求请建新任务'))
    const session = this.deps.registry.activeForTask(task.id, 'task') ?? this.deps.registry.activeForTask(task.id, 'coord')
    if (session === undefined) return fail('not-found', t('这个任务现在没有在执行的会话'))
    this.deliver(session.id, text, source)
    return ok(task)
  }

  private deliver(sessionId: string, text: string, source: MessageSource): void {
    this.deps.dispatcher.enqueue({ sessionId, mode: this.deps.dispatcher.isRunning(sessionId) ? 'steer' : 'followup', priority: PRIORITY.owner, text, source })
  }

  /** 暂停、继续、停止、取消、重试、收下；作用于整棵任务树。why 是 dsh-bot 自己暂停时的原因，写进对话里的那一行。 */
  control(taskId: string, action: ControlAction, actor: string, why?: string): PodResult<Task> {
    const root = this.get(this.rootOf(taskId) ?? taskId)
    if (root === undefined) return fail('not-found', t('找不到这个任务'))
    const result = isTicket(root) ? this.controlTicket(root, action, actor) : this.controlTeam(root, action)
    if (!result.ok) return result
    // 停掉，或者停下工单的这次执行：正在跑的一轮也停下，排着的消息撤掉。
    if (action === 'stop' || action === 'cancel' || (action === 'pause' && isTicket(root))) {
      const sessions = this.tree(root.id)
        .flatMap((task) => this.deps.registry.forTask(task.id))
        .filter((session) => session.status === 'active')
      for (const session of sessions) {
        this.deps.dispatcher.cancelPending(session.id)
        this.deps.agents.get(session.id)?.cancel({ kind: 'user' })
      }
    }
    if (action !== 'accept') this.deps.onRootStateChange(root.id, action === 'cancel' ? 'cancelled' : action === 'stop' ? 'stopped' : 'resumed')
    this.event(root, `control.${action}`, actor, why === undefined ? {} : { why })
    this.deps.audit.record(`task.${action}`, actor, root.id, { title: root.title })
    const line = t(CONTROL_NOTES[action], { title: root.title })
    this.deps.rooms.milestone(root.roomId, why === undefined ? line : t('{line}：{why}', { line, why }), { taskId: root.id })
    const after = this.get(root.id) ?? root
    if (action === 'stop' || action === 'cancel' || action === 'accept') this.finish(after)
    return ok(after)
  }

  private controlTicket(task: Task, action: ControlAction, actor: string): PodResult<Task> {
    const run = this.engine.runs.current(task.id)
    switch (action) {
      case 'pause':
        if (run === undefined) return fail('conflict', t('任务现在没有在做'))
        this.engine.runs.end(run.id, 'paused')
        return ok(task)
      case 'resume':
      case 'retry': {
        if (run !== undefined) return fail('conflict', t('任务正在做'))
        if (task.endedAt !== null && this.engine.tickets.reopen(task.id, actor, true) === undefined) return fail('conflict', t('任务现在的状态不能这样操作'))
        const queued = this.engine.runs.queue(task.id, action, {})
        return queued === undefined ? fail('conflict', t('任务现在的状态不能这样操作')) : ok(task)
      }
      case 'stop':
      case 'cancel':
        if (task.endedAt !== null) return fail('conflict', t('任务已经结束'))
        this.engine.tickets.end(task.id, 'stopped', actor)
        return ok(task)
      case 'accept':
        if (task.endedAt !== null) return fail('conflict', t('任务已经结束'))
        this.engine.tickets.end(task.id, 'done', actor)
        return ok(task)
    }
  }

  private controlTeam(root: Task, action: ControlAction): PodResult<Task> {
    const now = this.deps.now()
    const target = (task: Task): TaskStatus | undefined => {
      switch (action) {
        case 'pause':
          return task.status === 'running' || task.status === 'waiting' ? 'paused' : undefined
        case 'resume':
        case 'retry':
          // 从没开工过的子任务回到排队，由调度按依赖派出；开过工的接着做。
          if (task.status !== 'paused' && task.status !== 'stopped') return undefined
          return task.startedAt === null && task.parentId !== null ? 'queued' : 'running'
        case 'stop':
          return isTerminal(task.status) || task.status === 'stopped' ? undefined : 'stopped'
        case 'cancel':
          return isTerminal(task.status) ? undefined : 'cancelled'
        case 'accept':
          return task.id === root.id && task.status === 'review' ? 'done' : undefined
      }
    }
    const changed = this.tree(root.id).filter((task) => target(task) !== undefined)
    if (changed.length === 0) return fail('conflict', t('任务现在的状态不能这样操作'))
    for (const task of changed) {
      const status = target(task)
      if (status === undefined) continue
      const previous = task.status
      const updated = this.write(task, { status, ...(status === 'cancelled' || status === 'done' ? { finishedAt: now } : {}) })
      if ((action === 'resume' || action === 'retry') && status === 'running') this.resumeSession(updated, previous === 'stopped' ? 'stopped' : 'paused')
    }
    return ok(root)
  }

  private resumeSession(task: Task, after: 'paused' | 'stopped'): void {
    const session = this.deps.registry.activeForTask(task.id, 'task')
    if (session === undefined) return
    const why = after === 'paused' ? '任务暂停后继续了' : '任务被停止后，用户让它继续'
    const note = task.note === '' ? '' : `你最近的进度说明是：「${task.note}」。`
    this.deps.dispatcher.enqueue({
      sessionId: session.id,
      mode: 'followup',
      priority: task.urgent ? PRIORITY.urgent : PRIORITY.task,
      text: `[dsh-bot] ${why}。${note}从停下的地方接着做；已完成的部分不用重做。`,
      source: noticeSource(t('任务继续')),
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
    if (task === undefined) return false
    if (isTicket(task)) {
      if (task.endedAt !== null) return task.endReason === 'stopped'
      if (this.engine.runs.current(task.id) !== undefined) return false
      return latestRun(this.db, task.id)?.outcome === 'paused'
    }
    return task.status === 'paused' || task.status === 'stopped' || task.status === 'cancelled'
  }

  /** 把你的纠正或补充转达给任务：必须带着你的原话。 */
  relay(taskId: string, ownerQuote: string, message: string, from: PodSession): PodResult<Task> {
    const task = this.get(taskId)
    if (task === undefined) return fail('not-found', t('找不到这个任务'))
    if (ownerQuote === '') return fail('invalid-input', t('转达必须原样引用用户的话'))
    const text = `[用户补充，经${this.deps.bots.get(from.botId)?.name ?? '主管'}转达]\n[用户原话] ${ownerQuote}${message === '' ? '' : `\n说明：${message}`}`
    const sent = this.sendToTask(task, text, relaySource(from.id), ownerQuote)
    if (!sent.ok) return sent
    this.event(task, 'relayed', from.botId, { quote: ownerQuote, message })
    if (from.roomId !== null && isTicket(task)) this.engine.tickets.addReplyTarget(this.get(task.id) ?? task, { roomId: from.roomId, messageId: null })
    this.deps.rooms.post(task.roomId ?? from.roomId ?? '', {
      author: 'pod',
      kind: 'receipt',
      body: t('已转达给「{title}」，下一步生效', { title: task.title }),
      data: { taskId: task.id },
    })
    return ok(sent.value)
  }

  /** “直接对任务说”：你的话直接进任务；做完了的接着做。 */
  talk(taskId: string, text: string): PodResult<Task> {
    const task = this.get(taskId)
    if (task === undefined) return fail('not-found', t('找不到这个任务'))
    const sent = this.sendToTask(task, `[用户原话，直接对任务说] ${text}`, ownerSource(), text)
    if (!sent.ok) return sent
    this.event(task, 'owner-talk', 'owner', { text })
    return sent
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
      undelivered: this.undelivered(own?.id),
      stage: this.engine.tickets.stageOf(task),
      run: latestRun(this.db, task.id) ?? null,
      lastReport: latestReport(this.db, task.id) ?? null,
    }
  }

  /** 交不出去的消息（连续失败到门槛的那条）。 */
  private undelivered(sessionId: string | undefined): TaskSnapshot['undelivered'] {
    if (sessionId === undefined) return null
    const stuck = stuckDelivery(this.db, sessionId, UNDELIVERED_AFTER)
    return stuck === undefined ? null : { error: stuck.error ?? '', attempts: stuck.attempts, since: stuck.createdAt }
  }

  /** 你点了“重试”：交不出去的消息马上再交一次。 */
  redeliver(taskId: string): PodResult<Task> {
    const task = this.get(taskId)
    if (task === undefined) return fail('not-found', t('找不到这个任务'))
    const session = this.deps.registry.activeForTask(task.id, 'task') ?? this.deps.registry.activeForTask(task.id, 'coord')
    if (session === undefined) return fail('not-found', t('这个任务现在没有在执行的会话'))
    this.deps.dispatcher.retry(session.id)
    return ok(task)
  }

  snapshotTextFor(taskId: string): string | undefined {
    const snapshot = this.snapshot(taskId)
    if (snapshot === undefined) return undefined
    return snapshotText(snapshot, (botId) => (botId === null ? undefined : this.deps.bots.get(botId)?.name), this.deps.now())
  }
}
