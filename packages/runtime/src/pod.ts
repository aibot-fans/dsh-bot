import type { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { OWNER, POD, POD_VERSION, PRIORITY, botFolder, composePersona, roomFolder, fail, sessionBrowses, sessionMakesPages, worthSummary, type Bot, type BotStats, type PodEvent, type PodResult, type PodSession, type Room, type Task, type TeamTemplate } from 'pod-domain'
import { deliveryByMessageId, pinnedMessages, teamsOfBot } from 'pod-store'
import { SegmentManager } from './agents/segments.ts'
import { AibotService } from './aibot/service.ts'
import { MemoryExtractor } from './memory/extract.ts'
import { MemoryService } from './memory/service.ts'
import { SearchIndex } from './search/index.ts'
import { SearchService } from './search/service.ts'
import { composeBrief } from './tasks/brief.ts'
import { SleepGuard } from './core/sleep.ts'
import { NotificationService } from './notify/service.ts'
import { DailyBrief, type BriefData } from './routines/brief.ts'
import { readPageOverHttp } from './routines/page.ts'
import { RoutineService, type PageContent } from './routines/service.ts'
import { AgentBinder } from './agents/binder.ts'
import { Dispatcher } from './agents/dispatcher.ts'
import { noticeSource } from './agents/messages.ts'
import { SessionObserver } from './agents/observer.ts'
import { SessionRegistry } from './agents/registry.ts'
import { Watchdog } from './agents/watchdog.ts'
import { BotService } from './bots/service.ts'
import { ChatExtras } from './chat/extras.ts'
import { RoomService } from './chat/rooms.ts'
import { liteRoute } from './chat/router.ts'
import { TextConverter } from './convert/index.ts'
import { Auditor } from './core/audit.ts'
import { PodBus } from './core/bus.ts'
import type { CompatReport } from './core/compat.ts'
import { LiteLlm } from './core/lite.ts'
import { Maintenance } from './core/maintenance.ts'
import { SettingsService } from './core/settings.ts'
import type { HostContext, LlmService } from './dsh.ts'
import { SessionFactory } from './sessions/factory.ts'
import { TaskService } from './tasks/service.ts'
import { equipSession, type ExtraTool } from './tools/index.ts'
import { ConsultService } from './orchestrator/consults.ts'
import { Coordinator } from './orchestrator/coordinator.ts'
import { TeamService } from './teams/service.ts'
import { UsageMeter } from './usage/meter.ts'
import { WaitService } from './waits/service.ts'
import { createBrowserKit, type BrowserKit } from './browser/index.ts'
import { createEvolutionKit, type EvolutionKit } from './evolution/index.ts'
import { ModelResolver } from './core/models.ts'
import { resolveConfig } from './config.ts'
import { dataGuard } from './core/data-guard.ts'
import { SHELL_TOOLS, detectExposure, type Exposure } from './core/exposure.ts'
import { startRuntime } from './lifecycle.ts'
import { PageLibrary } from './pages/library.ts'
import { PageService } from './pages/service.ts'

/** 同一条会话的实时动态最快多久推一次。 */
const ACTIVITY_THROTTLE_MS = 1000

export interface PodRuntimeOptions {
  readonly ctx: HostContext
  readonly db: DatabaseSync
  readonly dataRoot: string
  readonly workspaceRoot: string
  /** dsh 自己的目录：bot 不能直接读写这里和 dataRoot 里的文件。不给就按 $DSH_HOME（默认 ~/.dsh）。 */
  readonly dshHome?: string
  readonly compat: CompatReport
  readonly now?: () => number
}

export interface PodStatus {
  readonly version: string
  readonly dshVersion: string
  readonly readOnly: boolean
  readonly problems: readonly string[]
  readonly degraded: readonly string[]
  readonly lastBackupAt: number | null
  readonly dataRoot: string
  readonly workspaceRoot: string
  /** dsh web 对外开放时 shell 和浏览器写操作默认禁用。 */
  readonly exposure: Exposure
}

/**
 * Pod 的组合根：建好各个服务并把它们连起来，作为 ctx.pod 提供给 agent 预设和其他插件。
 * 服务之间只通过这里拿到彼此；互相引用的回调都是箭头函数，构造完成之后才会被调用。
 */
export class PodRuntime {
  readonly bus: PodBus
  readonly audit: Auditor
  readonly settings: SettingsService
  readonly bots: BotService
  readonly sessions: SessionFactory
  readonly registry: SessionRegistry
  readonly dispatcher: Dispatcher
  readonly observer: SessionObserver
  readonly watchdog: Watchdog
  readonly binder: AgentBinder
  readonly rooms: RoomService
  readonly teams: TeamService
  readonly tasks: TaskService
  readonly coordinator: Coordinator
  readonly consults: ConsultService
  readonly waits: WaitService
  readonly meter: UsageMeter
  readonly searchIndex: SearchIndex
  readonly search: SearchService
  readonly memory: MemoryService
  readonly extractor: MemoryExtractor
  readonly segments: SegmentManager
  readonly notifications: NotificationService
  readonly routines: RoutineService
  readonly brief: DailyBrief
  readonly sleep: SleepGuard
  readonly maintenance: Maintenance
  readonly lite: LiteLlm
  readonly browser: BrowserKit
  readonly evolutionKit: EvolutionKit
  readonly models: ModelResolver
  readonly chat: ChatExtras
  readonly pages: PageService
  readonly pageLibrary: PageLibrary
  readonly aibot: AibotService
  readonly now: () => number
  private exposureState: Exposure = detectExposure()
  private readonly extras: ExtraTool[] = []
  private readonly activityTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** 每条会话这一轮最后说的那段话：跑完以后执行摘要记在它上面。 */
  private readonly lastReplies = new Map<string, { readonly id: string; readonly at: number }>()
  private readonly options: PodRuntimeOptions
  private readonly protectData: ReturnType<typeof dataGuard>

  constructor(options: PodRuntimeOptions) {
    this.options = options
    this.protectData = dataGuard({ dshHome: options.dshHome ?? resolveConfig(undefined).dshHome, dataRoot: options.dataRoot })
    const { ctx, db } = options
    const now = options.now ?? Date.now
    this.now = now
    const warn = (message: string): void => {
      ctx.logger.warn(message)
      // 开发时（POD_DEBUG=1）在终端里也能看到 Pod 的警告。
      if (process.env.POD_DEBUG === '1') console.error(`[pod] ${message}`)
    }
    this.bus = new PodBus(now)
    this.audit = new Auditor(db, now, warn)
    this.settings = new SettingsService(db, this.bus, now)
    this.models = new ModelResolver({ ctx, settings: () => this.settings.get(), effortFor: (botId) => this.evolutionKit.tuner.effortFor(botId) })
    this.bots = new BotService({ db, bus: this.bus, audit: this.audit, now })
    this.teams = new TeamService({ db, bus: this.bus, bots: this.bots, audit: this.audit, now })
    this.notifications = new NotificationService({ db, bus: this.bus, settings: () => this.settings.get(), room: (roomId) => this.rooms.get(roomId), now })
    this.sessions = new SessionFactory({
      workspaceRoot: options.workspaceRoot,
      sessions: ctx.sessionController,
      workspaces: ctx.workspaceRegistry,
      warn,
    })
    this.registry = new SessionRegistry({
      db,
      factory: this.sessions,
      now,
      modelFor: (bot) => this.models.session(bot),
      compose: (session) => this.compose(session),
      onRegistered: (session) => this.binder.attachIfLive(session),
    })
    this.dispatcher = new Dispatcher({
      db,
      agents: ctx.agents,
      sessions: ctx.sessionController,
      registry: this.registry,
      settings: () => this.settings.get(),
      now,
      warn,
    })
    this.meter = new UsageMeter(db, this.registry, (taskId) => this.tasks.rootOf(taskId), now)
    this.lite = new LiteLlm({
      llm: () => ctx.get('llm') as LlmService | undefined,
      resolveModel: () => this.models.lite(),
      onUsage: (purpose, result) =>
        this.meter.recordLite(purpose, { ...result.usage, provider: result.provider, model: result.model }),
    })
    this.searchIndex = new SearchIndex(join(options.dataRoot, 'search.db'), new URL('./search-worker.js', import.meta.url), warn)
    this.search = new SearchService({
      db,
      index: this.searchIndex,
      workspaceRoot: options.workspaceRoot,
      bot: (id) => this.bots.get(id),
      room: (id) => this.rooms.get(id),
      roomsOfBot: (botId) => this.roomsOfBot(botId),
      isLead: (botId) => this.bots.get(botId)?.role === 'lead',
      warn,
    })
    this.memory = new MemoryService({
      db,
      bus: this.bus,
      search: this.search,
      registry: this.registry,
      dispatcher: this.dispatcher,
      audit: this.audit,
      now,
      isLead: (botId) => this.bots.get(botId)?.role === 'lead',
      teamsOf: (botId) => teamsOfBot(db, botId),
      roomsOf: (botId) => this.roomsOfBot(botId),
      rootOf: (taskId) => this.tasks.rootOf(taskId),
    })
    this.rooms = new RoomService({
      db,
      bus: this.bus,
      bots: this.bots,
      registry: this.registry,
      dispatcher: this.dispatcher,
      audit: this.audit,
      now,
      busy: (room) =>
        this.registry.active().some((session) => (session.roomId === room.id || (room.taskId !== null && session.taskId === room.taskId)) && this.dispatcher.isRunning(session.id)),
      openWaits: (roomId) => this.waits.openCountInRoom(roomId),
      snapshotFor: (room) => (room.taskId === null ? undefined : this.tasks.snapshotTextFor(room.taskId)),
      enrich: async (session, text) => {
        const hints = await this.memory.hintsFor(session, text).catch(() => undefined)
        return hints === undefined ? text : `${text}\n\n${hints}`
      },
      rotate: async (room, bot, session) => (this.segments.needsRotation(session) ? this.segments.rotateChat(room, bot, session, '上下文接近软上限或空闲太久') : undefined),
      indexed: (message) => this.search.indexMessage(message),
      leaderFor: (room) => this.leaderForRoom(room),
      onOwnerText: (message) => this.evolutionKit.feedback.observeOwner(message),
      stopSession: (sessionId) => {
        this.dispatcher.cancelPending(sessionId)
        ctx.agents.get(sessionId)?.cancel({ kind: 'user' })
      },
      hideSession: (sessionId) => {
        void Promise.resolve()
          .then(() => ctx.workspaceRegistry.archiveSession?.(sessionId, { stopActivity: true }))
          .catch(() => undefined)
      },
      route: liteRoute(this.lite, warn),
    })
    this.pages = new PageService({
      db,
      bus: this.bus,
      bots: this.bots,
      rooms: this.rooms,
      audit: this.audit,
      workspaceRoot: options.workspaceRoot,
      now,
      timezone: () => this.settings.get().timezone,
      folderOf: (session) => this.folderOf(session),
      roomOf: (session) => this.cardRoomOf(session),
      roomsOfBot: (botId) => this.roomsOfBot(botId),
    })
    this.pageLibrary = new PageLibrary({ db, pages: this.pages, bots: this.bots, rooms: this.rooms, now })
    this.tasks = new TaskService({
      db,
      bus: this.bus,
      bots: this.bots,
      registry: this.registry,
      dispatcher: this.dispatcher,
      rooms: this.rooms,
      agents: ctx.agents,
      meter: this.meter,
      audit: this.audit,
      workspaceRoot: options.workspaceRoot,
      now,
      activity: (sessionId) => this.observer.activityOf(sessionId),
      openWaits: (rootId) => this.waits.openCountFor(rootId),
      onRootStateChange: (rootId, change) => {
        const moved = this.waits.onRootChange(rootId, change).map((wait) => WaitService.describe(wait))
        if (change === 'resumed') void this.coordinator.schedule(rootId)
        return moved
      },
      notify: (task, event) => this.onTaskNotify(task, event),
      onSubtaskSubmitted: (task, result) => this.coordinator.onSubmitted(task, result),
      onSubtaskStalled: (task, reason) => this.coordinator.onStalled(task, reason),
      shouldRotate: (session) => session.contextTokens >= this.settings.get().softContextTokens,
      rotateTask: (session, task) => this.rotateTaskSession(session, task),
      onEvent: (task, kind, _actor, data) => {
        if (kind === 'reviewed') this.evolutionKit.feedback.onReview(task, data.pass === true, typeof data.feedback === 'string' ? data.feedback : '')
      },
    })
    this.coordinator = new Coordinator({
      db,
      bots: this.bots,
      teams: this.teams,
      registry: this.registry,
      dispatcher: this.dispatcher,
      agents: ctx.agents,
      rooms: this.rooms,
      tasks: this.tasks,
      settings: this.settings,
      audit: this.audit,
      workspaceRoot: options.workspaceRoot,
      now,
      onDelivered: (root) => this.waits.onRootChange(root.id, 'delivered').map((wait) => WaitService.describe(wait)),
      notify: (task, event) => this.onTaskNotify(task, event),
      promote: (botId, rootId) => this.evolutionKit.evolution.promote(botId, rootId),
    })
    this.consults = new ConsultService({
      db,
      bots: this.bots,
      registry: this.registry,
      dispatcher: this.dispatcher,
      rooms: this.rooms,
      task: (taskId) => this.tasks.get(taskId),
      now,
    })
    this.waits = new WaitService({
      db,
      bus: this.bus,
      rooms: this.rooms,
      dispatcher: this.dispatcher,
      audit: this.audit,
      now,
      task: (taskId) => this.tasks.get(taskId),
      setTaskWaiting: (task, waiting) => this.tasks.setWaiting(task, waiting),
      notify: (wait) => {
        this.notifications.wait(wait)
        this.evolutionKit.feedback.onWait(wait)
      },
    })
    this.observer = new SessionObserver(
      ctx,
      this.registry,
      {
        onAssistantText: (session, text) => {
          // 在回页面修改要求的这一轮，说的话归到那个页面下面（页面旁边的修改对话里看得到）。
          const pageId = this.pages.threadOf(session.id)
          if (session.kind === 'chat' || session.kind === 'routine') {
            const posted = this.rooms.postBotText(session, text, pageId === undefined ? undefined : { pageId })
            if (posted !== undefined) this.lastReplies.set(session.id, { id: posted.id, at: posted.createdAt })
          }
          if (session.kind === 'chat' && session.roomId !== null) {
            this.bus.emit({ type: 'stream', roomId: session.roomId, botId: session.botId, sessionId: session.id, text: '', done: true })
          }
          if (session.kind === 'routine' && session.roomId !== null) {
            this.notifications.notify({ kind: 'routine', title: `例程结果：${this.rooms.get(session.roomId)?.title ?? ''}`, body: text.slice(0, 200), roomId: session.roomId })
          }
          this.consults.onText(session, text)
        },
        onOwnerTyped: (session, text) => this.rooms.mirrorOwner(session, text),
        onTurnEnd: (session, reason) => {
          this.dispatcher.setRunning(session.id, false)
          this.pages.onTurnEnd(session.id)
          this.tasks.onTurnEnd(session, reason)
          this.consults.onTurnEnd(session)
        },
        onToolCall: (session, name, action, args) => {
          this.audit.record('tool.call', session.botId, session.id, { name, action })
          this.watchdog.onToolCall(session, name, args)
        },
        onUsage: (session, usage) => this.meter.recordAgent(session, usage),
        onRunEnd: (session, run) => {
          const reply = this.lastReplies.get(session.id)
          this.lastReplies.delete(session.id)
          if (reply !== undefined && reply.at >= run.startedAt && worthSummary(run)) this.rooms.attachRun(reply.id, run)
        },
        onPlanMissing: (session) => {
          this.dispatcher.enqueue({
            sessionId: session.id,
            mode: 'inject',
            priority: PRIORITY.task,
            text: '[dsh-bot 提醒] 这件事要走好几步：用 todo_write 列一个简短的计划（一步一行），做完一步就勾掉。用户在页面上看得到你的计划和进度。',
            source: noticeSource('提醒列计划'),
          })
        },
        onStream: (session, text, done) => {
          if (session.roomId === null || session.kind !== 'chat') return
          this.bus.emit({ type: 'stream', roomId: session.roomId, botId: session.botId, sessionId: session.id, text, done })
        },
        onActivity: (session, activity) => {
          this.dispatcher.setRunning(session.id, activity.running)
          this.watchdog.onStep(session, activity.steps)
          this.emitActivity(session)
        },
        isPodDelivery: (messageId) => deliveryByMessageId(db, messageId) !== undefined,
        onDelivered: (session, messageId) => this.pages.onDelivered(session, messageId),
      },
      now,
    )
    this.watchdog = new Watchdog({
      registry: this.registry,
      observer: this.observer,
      dispatcher: this.dispatcher,
      agents: ctx.agents,
      task: (taskId) => this.tasks.get(taskId),
      now,
      onStall: (session, task, reason) => {
        this.audit.record('task.stall', 'pod', session.id, { reason, taskId: task?.id ?? null })
        if (task !== undefined) {
          this.rooms.milestone(task.roomId, `「${task.title}」${reason}`, { taskId: task.id })
          this.tasks.touched(task)
        }
      },
    })
    this.binder = new AgentBinder({
      ctx,
      registry: this.registry,
      equip: (session, agent) => equipSession(this, this.extras, session, agent),
      warn,
      onAttach: () => void this.dispatcher.pump(),
    })
    this.extractor = new MemoryExtractor({
      db,
      memory: this.memory,
      lite: this.lite,
      enabled: () => this.settings.get().memoryExtraction,
      name: (author) => (author === OWNER ? '用户' : author === POD ? 'dsh-bot' : (this.bots.get(author)?.name ?? 'bot')),
      now,
      warn,
    })
    this.segments = new SegmentManager({
      db,
      registry: this.registry,
      lite: this.lite,
      softLimit: () => this.settings.get().softContextTokens,
      name: (author) => (author === OWNER ? '用户' : author === POD ? 'dsh-bot' : (this.bots.get(author)?.name ?? 'bot')),
      pinned: (roomId) => pinnedMessages(db, roomId).map((message) => message.body),
      now,
      warn,
      beforeRotate: async (room) => {
        await this.extractor.extract(room)
      },
    })
    this.routines = new RoutineService({
      db,
      bus: this.bus,
      bots: this.bots,
      rooms: this.rooms,
      registry: this.registry,
      dispatcher: this.dispatcher,
      audit: this.audit,
      settings: () => this.settings.get(),
      now,
      warn,
      readPage: (url, selector) => this.readPage(url, selector),
      usesDeepSeek: (botId) => this.models.isDeepSeek(this.bots.get(botId)?.model ?? null),
      describePage: (pageId) => {
        const page = this.pages.get(pageId)
        return page === undefined ? undefined : { title: page.title, kind: page.kind, version: page.version, deleted: page.deletedAt !== null }
      },
    })
    this.brief = new DailyBrief({
      db,
      dispatcher: this.dispatcher,
      settings: () => this.settings.get(),
      now,
      data: () => this.briefData(),
      leadSession: async () => {
        const room = this.rooms.ensureLeadRoom()
        return this.rooms.chatSession(room, this.bots.lead())
      },
      notified: () => this.notifications.notify({ kind: 'brief', title: '每日简报已发到主管单聊', body: '', roomId: this.rooms.ensureLeadRoom().id }),
    })
    this.browser = createBrowserKit({
      db,
      dataRoot: options.dataRoot,
      workspaceRoot: options.workspaceRoot,
      bus: this.bus,
      settings: () => this.settings.get(),
      registry: this.registry,
      dispatcher: this.dispatcher,
      waits: this.waits,
      search: this.search,
      audit: this.audit,
      lite: this.lite,
      now,
      warn: (message, error) => ctx.logger.warn(message, error),
      rootOf: (taskId) => (taskId === null ? undefined : this.tasks.rootOf(taskId)),
      folderOf: (session) => this.folderOf(session),
      folderOfTask: (taskId) => {
        const task = taskId === null ? undefined : this.tasks.get(taskId)
        return task === undefined ? undefined : join(options.workspaceRoot, task.folder)
      },
      brief: (session) => {
        const task = this.tasks.taskOf(session)
        return task === undefined ? '（单聊里用户让你做的事，没有书面的任务说明）' : `${task.title}\n${task.brief}`
      },
      privateTexts: () => [this.memory.core('owner', '').text, ...this.memory.list({ scopeKind: 'owner', statuses: ['active'] }).map((entry) => entry.content)],
      exposed: () => (this.exposureState.exposed ? this.exposureState.reasons.join('；') : undefined),
      // 对话里的浏览器卡片：点开从右侧看实时画面，默认 AI 操作，可以接管。
      onOpened: (session, tab) => {
        const roomId = this.cardRoomOf(session)
        if (roomId === null) return
        let host = tab.url
        try {
          host = new URL(tab.url).hostname
        } catch {
          // 地址不合法时就显示原样。
        }
        this.rooms.post(roomId, { author: session.botId, kind: 'browser', body: `打开了 ${host}`, data: { tabId: tab.id, url: tab.url }, sessionId: session.id })
      },
    })
    this.evolutionKit = createEvolutionKit({
      db,
      bus: this.bus,
      audit: this.audit,
      bots: this.bots,
      memory: this.memory,
      rooms: this.rooms,
      notifications: this.notifications,
      tasks: () => this.tasks,
      meter: this.meter,
      lite: this.lite,
      settings: () => this.settings.get(),
      workspaceRoot: options.workspaceRoot,
      now,
      warn: (message, error) => ctx.logger.warn(message, error),
      teamsOf: (botId) => this.teamsOfBot(botId),
      efforts: (bot) => this.models.efforts(bot),
      liteIsDeepSeek: async () => this.models.isDeepSeek(await this.models.lite()),
    })
    const textConverter = new TextConverter(new URL('./convert-worker.js', import.meta.url))
    this.chat = new ChatExtras({
      db,
      rooms: this.rooms,
      attachmentsFolder: (room, bot) => {
        const task = room.taskId === null ? undefined : this.tasks.get(room.taskId)
        return join(options.workspaceRoot, task?.folder ?? (room.kind === 'direct' ? botFolder(bot) : roomFolder(room)))
      },
      toText: (path) => textConverter.convert(path),
      onRegenerate: (message) => this.evolutionKit.feedback.onRegenerate(message),
    })
    this.waits.setResolver('approval', (wait, answer) => this.evolutionKit.skills.resolveApproval(wait, answer))
    this.evolutionKit.skills.onChange((botIds) => this.binder.refreshSkills(botIds))
    this.sleep = new SleepGuard(warn)
    this.aibot = new AibotService({
      db,
      bus: this.bus,
      settings: () => this.settings.get(),
      bots: this.bots,
      rooms: this.rooms,
      notifications: this.notifications,
      version: POD_VERSION,
      now,
      warn,
      toolsChanged: () => this.reinstallXTools(),
    })
    this.settings.onChange((next, previous) => {
      if (next.dailyBrief.time !== previous.dailyBrief.time || next.timezone !== previous.timezone || next.dailyBrief.enabled !== previous.dailyBrief.enabled) this.brief.reschedule()
      this.aibot.settingsChanged(next, previous)
    })
    this.maintenance = new Maintenance(db, options.dataRoot, () => this.settings.get().timezone, warn)
    this.maintenance.addDaily({ name: '整理记忆', run: () => this.extractor.consolidate().then(() => undefined) })
    this.maintenance.addDaily({
      name: '自我优化',
      run: async () => {
        await this.evolutionKit.feedback.checkEdits()
        this.evolutionKit.evolution.autoRevert()
        await this.evolutionKit.tuner.nightly()
      },
    })
    this.maintenance.addDaily({
      name: '清理回收站',
      run: (time) => {
        this.bots.purgeExpired(time)
        this.teams.purgeExpired(time)
        this.pages.purgeExpired(time)
      },
    })
  }

  /** 插件启动：开始观察会话、安装工具、拦暂停的任务、补投没投出去的消息，以及各种定时器。 */
  start(): () => void {
    return startRuntime(this)
  }

  /** 停止时清掉实时动态的节流定时器。 */
  clearActivityTimers(): void {
    for (const timer of this.activityTimers.values()) clearTimeout(timer)
    this.activityTimers.clear()
  }

  get db(): DatabaseSync {
    return this.options.db
  }

  /** dsh 的插件上下文：取可选服务（附件、模型）用。 */
  get ctx(): HostContext {
    return this.options.ctx
  }

  get workspaceRoot(): string {
    return this.options.workspaceRoot
  }

  get dataRoot(): string {
    return this.options.dataRoot
  }

  /** 实时动态事件：聊天会话带上房间、是否在跑和正在做的事，页面直接显示“正在……”。 */
  private activityEvent(session: PodSession): PodEvent {
    const current = this.registry.get(session.id) ?? session
    const activity = this.observer.activityOf(current.id)
    return {
      type: 'activity',
      sessionId: current.id,
      taskId: current.taskId,
      roomId: current.kind === 'chat' ? current.roomId : null,
      botId: current.botId,
      running: activity?.running === true,
      label: activity?.current ?? '',
      ...(current.kind === 'chat' ? { progress: activity?.progress ?? null } : {}),
    }
  }

  private emitActivity(session: PodSession): void {
    if (this.activityTimers.has(session.id)) return
    this.bus.emit(this.activityEvent(session))
    const timer = setTimeout(() => {
      this.activityTimers.delete(session.id)
      this.bus.emit(this.activityEvent(session))
    }, ACTIVITY_THROTTLE_MS)
    timer.unref()
    this.activityTimers.set(session.id, timer)
  }

  get readOnlyReason(): string | undefined {
    const { compat } = this.options
    return compat.readOnly ? `当前 dsh（${compat.dshVersion}）缺少 dsh-bot 需要的接口：${compat.problems.join('、')}。dsh-bot 进入只读模式。` : undefined
  }

  status(): PodStatus {
    const { compat } = this.options
    return {
      version: POD_VERSION,
      dshVersion: compat.dshVersion,
      readOnly: compat.readOnly,
      problems: compat.problems,
      degraded: [
        ...compat.degraded,
        ...(this.browser.browser.executable === undefined ? ['共用浏览器（没找到本机的 Chrome）'] : []),
        ...(this.exposureState.exposed ? ['shell 和浏览器写操作（dsh web 对外开放中）'] : []),
      ],
      lastBackupAt: this.maintenance.lastBackupAt(),
      exposure: this.exposureState,
      dataRoot: this.options.dataRoot,
      workspaceRoot: this.options.workspaceRoot,
    }
  }

  /** 一段会话冻结的人设。 */
  compose(session: PodSession): string {
    const bot = this.bots.get(session.botId) ?? this.bots.lead()
    const room = session.roomId === null ? undefined : this.rooms.get(session.roomId)
    const settings = this.settings.get()
    return composePersona({
      bot,
      kind: session.kind,
      roster: this.bots.active(),
      workspaceRoot: this.options.workspaceRoot,
      folder: session.folder === '' ? '.' : session.folder,
      timezone: settings.timezone,
      autonomy: settings.autonomy,
      ...(room === undefined ? {} : { roomTitle: room.title }),
      // 群聊里的聊天会话知道自己在群里、群里有谁，才会用 mention_member 点名别人。
      ...(room === undefined || room.kind === 'direct' || session.kind !== 'chat' ? {} : { group: { title: room.title, members: this.rooms.memberBots(room) } }),
      memory: this.memory.coreBlocks(session),
      browser: sessionBrowses(session),
      pages: sessionMakesPages(session),
      tuning: this.evolutionKit.tuner.personaFor(bot.id),
    })
  }

  /** agent 预设读人设用；每次组装提示词都会调用，所以是同步的，只查内存。不是 Pod 建的会话按主管处理。 */
  personaForSession(sessionId: string | undefined): string {
    const persona = sessionId === undefined ? undefined : this.registry.persona(sessionId)
    if (persona !== undefined) return persona
    const lead: Bot = this.bots.lead()
    const settings = this.settings.get()
    return composePersona({
      bot: lead,
      kind: 'chat',
      roster: this.bots.active(),
      workspaceRoot: this.options.workspaceRoot,
      folder: '.',
      timezone: settings.timezone,
      autonomy: settings.autonomy,
    })
  }

  /** 任务记录里谁来回答：正式团队的任务交给组长，其余交给主管。 */
  leaderForRoom(room: Room): Bot | undefined {
    if (room.teamId === null) return undefined
    const team = this.teams.get(room.teamId)
    return team === undefined ? undefined : this.bots.activeBot(team.leaderBotId)
  }

  /** 评分卡给分配打分的数据：一次验收通过率。 */
  scorecardStats(botId: string): Partial<BotStats> {
    return this.evolutionKit.feedback.stats(botId)
  }

  /** 任务完成或失败：发通知，记下产物（之后看你有没有改），根任务排进复盘。 */
  private onTaskNotify(task: Task, event: 'done' | 'failed' | 'stalled'): void {
    this.notifications.task(task, event)
    if (event === 'done') void this.evolutionKit.feedback.onDelivered(task).catch(() => undefined)
    if (event === 'failed') this.evolutionKit.feedback.onFailure(task, task.note)
    if (task.parentId === null && event !== 'stalled') this.evolutionKit.retro.enqueue(task)
  }

  teamsOfBot(botId: string): readonly string[] {
    return teamsOfBot(this.db, botId)
  }


  /** 会话的工具拒绝规则；M9 接对外开放时的降级。 */
  /** 现在对外开放吗（启动时查一次，之后定时刷新）。 */
  get exposure(): Exposure {
    return this.exposureState
  }

  refreshExposure(): void {
    const next = detectExposure()
    if (next.exposed !== this.exposureState.exposed) this.bus.emit({ type: 'status' })
    this.exposureState = next
  }

  /**
   * 会话的工具拒绝规则：dsh web 对外开放时禁用 shell（浏览器写操作在审批那一步拦）；
   * bot 不能直接读写 Pod 和 dsh 的数据（改例程用 update_routine）。
   */
  guardFor(session: PodSession): (call: { readonly name: string; readonly arguments?: unknown }) => string | undefined {
    const cwd = join(this.options.workspaceRoot, session.folder)
    return (call) => {
      if (this.exposureState.exposed && SHELL_TOOLS.has(call.name)) return `dsh web 现在对外开放（${this.exposureState.reasons.join('；')}），为了安全 dsh-bot 禁用了 shell。需要时请用户在本机使用。`
      return this.protectData(call, cwd)
    }
  }

  /** 任务复盘：做法和教训写进执行者的个人记忆，任务的结果写进任务记录。 */
  learnFromTask(session: PodSession, task: Task, lessons: string): void {
    this.tasks.event(task, 'lesson', session.botId, { lessons })
    this.memory.add({ scopeKind: 'bot', scopeId: session.botId, type: 'experience', content: lessons, source: 'task', sourceRef: task.id }, session.botId, `任务「${task.title}」的复盘`)
    if (task.result !== null) {
      this.memory.add(
        { scopeKind: 'task', scopeId: task.rootId, type: 'project', content: `任务「${task.title}」：${task.result.summary.split('\n')[0] ?? ''}`, source: 'task', sourceRef: task.id },
        'pod',
        '任务记录',
      )
    }
  }

  /** 读网页正文：有本机 Chrome 时用共用浏览器（能按选择器取、能读要登录的页面），否则直接请求网页。 */
  async readPage(url: string, selector: string): Promise<PageContent> {
    if (this.browser.browser.executable !== undefined) {
      try {
        return await this.browser.actions.readPage(url, selector)
      } catch (error) {
        if (error instanceof Error && /禁止清单|没有匹配|不能访问|格式不对/.test(error.message)) throw error
      }
    }
    return readPageOverHttp(url, this.settings.get().allowedHosts)
  }

  /** 会话发卡片（浏览器、页面）的对话：任务会话没有自己的房间，卡片放进任务的群聊，L1 任务放进发起任务的那个对话。 */
  cardRoomOf(session: PodSession): string | null {
    const task = session.taskId === null ? undefined : this.tasks.get(this.tasks.rootOf(session.taskId) ?? session.taskId)
    const requester = task?.requesterSession == null ? undefined : this.registry.get(task.requesterSession)
    return session.roomId ?? task?.roomId ?? requester?.roomId ?? null
  }

  /** 会话产出文件的文件夹（绝对路径）：任务会话是任务文件夹，其他是会话自己的文件夹。 */
  folderOf(session: PodSession): string {
    const task = session.taskId === null ? undefined : this.tasks.get(session.taskId)
    return join(this.options.workspaceRoot, task?.folder ?? session.folder)
  }

  /** 每日简报用的数据：过去一天完成的、正在进行的、等你处理的、花费。 */
  private briefData(): BriefData {
    const now = this.now()
    const day = 86_400_000
    const roots = this.tasks.roots(200)
    return {
      finished: roots.filter((task) => task.status === 'done' && (task.finishedAt ?? 0) > now - day),
      running: roots.filter((task) => task.status === 'running' || task.status === 'waiting' || task.status === 'paused'),
      waits: this.waits.open(),
      cost: { today: this.meter.since(now - day).cost, yesterday: this.meter.since(now - 2 * day).cost - this.meter.since(now - day).cost },
    }
  }

  /** bot 能看到的房间：它是成员的房间（主管看全部）。 */
  roomsOfBot(botId: string): readonly string[] {
    const rows = this.db.prepare('SELECT room_id FROM room_members WHERE bot_id = ?').all(botId) as unknown as readonly { readonly room_id: string }[]
    return rows.map((row) => row.room_id)
  }

  /** 任务树变化时更新索引；交付或待验收时扫一遍任务文件夹。 */
  indexTaskTree(rootId: string): void {
    for (const task of this.tasks.tree(rootId)) {
      this.search.indexTask(task)
      if (task.status === 'done' || task.status === 'review') {
        void this.search.indexFolder(task.folder, { taskId: task.rootId, roomId: task.roomId, teamId: task.teamId, botId: task.ownerBotId })
      }
    }
  }

  /** 任务会话换段：写交接笔记、开新一段，把任务说明和交接笔记投进去接着做。 */
  private async rotateTaskSession(session: PodSession, task: Task): Promise<void> {
    const bot = this.bots.get(session.botId)
    if (bot === undefined) return
    try {
      const rotation = await this.segments.rotateTask(task, bot, session)
      const brief = composeBrief(task, { fromName: 'dsh-bot', assumptions: [], conventions: [], upstream: [], workspaceRoot: this.options.workspaceRoot })
      this.dispatcher.enqueue({
        sessionId: rotation.session.id,
        mode: 'followup',
        priority: task.urgent ? PRIORITY.urgent : PRIORITY.task,
        text: `${rotation.preface}\n\n${brief}`,
        source: noticeSource('换段后接着做'),
      })
    } catch (error) {
      this.options.ctx.logger.warn('任务会话换段失败', error)
    }
  }

  /** 其他插件给 bot 增加工具（浏览器、记忆、检索都走这里）。 */
  /** 给其他插件（ctx.pod）：注册团队模板，出现在“按模板新建”里。 */
  registerTemplate(template: TeamTemplate): () => void {
    return this.teams.registerTemplate(template)
  }

  /** 给其他插件（ctx.pod）：以主管的名义把一件事交给某个 bot；结果用 pod/task-updated 事件跟踪。 */
  async createTask(input: { readonly bot: string; readonly title: string; readonly brief: string; readonly acceptance?: readonly string[]; readonly deliverable?: string }): Promise<PodResult<Task>> {
    const bot = this.bots.resolve(input.bot)
    if (bot === undefined) return fail('not-found', `找不到 bot「${input.bot}」`)
    if (input.title.trim() === '' || input.brief.trim() === '') return fail('invalid-input', '任务要有标题和说明')
    const requester = await this.rooms.chatSession(this.rooms.ensureLeadRoom(), this.bots.lead())
    return this.tasks.delegate({
      requester,
      bot,
      title: input.title,
      brief: input.brief,
      deliverable: input.deliverable ?? '',
      acceptance: input.acceptance ?? [],
      assumptions: [],
      urgent: false,
      reason: '其他插件派的任务',
    })
  }

  /** X 工具装好、换了或停了：会用到它们的在线会话重新装一遍工具，下一步就生效。 */
  private reinstallXTools(): void {
    const room = this.aibot.status().roomId
    for (const session of this.registry.active()) {
      if (this.aibot.wantsTools(session.botId) || (room !== null && session.roomId === room)) this.binder.reinstall(session.id)
    }
  }

  registerTool(extra: ExtraTool): () => void {
    this.extras.push(extra)
    return () => {
      const index = this.extras.indexOf(extra)
      if (index >= 0) this.extras.splice(index, 1)
    }
  }
}
