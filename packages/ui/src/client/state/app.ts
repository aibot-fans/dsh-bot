import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react'
import { TEMPORARY_TOPIC, isTemporaryRoom, t, type MemoryScopeKind, type PodEvent, type PodNotification, type PodSettings, type RoomSummary, type TurnProgress } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { PodEvents } from '../api/events.ts'
import { ResourceCache } from './resource.ts'

export type BotTab = 'details' | 'pages' | 'library' | 'automations' | 'browser'
export type GroupTab = 'details' | 'pages' | 'library' | 'automations' | 'tasks' | 'browser'
export type SettingsTab = 'general' | 'usage' | 'automations' | 'models' | 'browser' | 'archive' | 'recycle' | 'advanced'

/**
 * 右侧面板：bot 详情、群聊详情、bot 的浏览器、页面库，同一时间只开一个。
 * 在群里点成员时 bot 详情带着 from（群的 id）：显示成员卡片，可以返回群聊详情；
 * 从成员卡片点“完整资料”时带着 back（群的 id）：完整资料左上角能返回那张成员卡片。
 */
export type PanelState =
  | { readonly kind: 'bot'; readonly botId: string; readonly tab: BotTab; readonly from?: string; readonly back?: string }
  | { readonly kind: 'group'; readonly roomId: string; readonly tab: GroupTab }
  | { readonly kind: 'browser'; readonly tabId: string | null; readonly botId: string | null; readonly roomId?: string }
  | { readonly kind: 'pages' }
  | null

/** 中间换成页面查看器时看的页面；version 是正在预览的旧版本，不给是最新版。 */
export interface PageNav {
  readonly id: string
  readonly version?: number
}

/** 盖在面板上的抽屉：记忆、技能、成长记录、历史版本、新建 bot、新建群聊。 */
export type DrawerState =
  | { readonly kind: 'memory'; readonly scope: MemoryScopeKind; readonly scopeId: string; readonly label: string }
  | { readonly kind: 'skills'; readonly botId: string }
  | { readonly kind: 'growth'; readonly botId: string }
  | { readonly kind: 'versions'; readonly botId: string }
  | { readonly kind: 'new-bot' }
  | { readonly kind: 'new-group' }
  | null

export interface NavState {
  readonly roomId: string | null
  readonly panel: PanelState
  readonly drawer: DrawerState
  /** 打开的设置分页；null 表示设置关着。 */
  readonly settings: SettingsTab | null
  /** 搜索框里的词；null 表示搜索关着。 */
  readonly search: string | null
  /** 打开的任务详情。 */
  readonly taskId: string | null
  /** 从搜索结果跳过来时要定位的消息。 */
  readonly focus: { readonly roomId: string; readonly seq: number; readonly messageId: string } | null
  /** 打开的页面：中间的对话换成页面查看器。 */
  readonly page: PageNav | null
  /** 更新弹窗开着吗。 */
  readonly update: boolean
  readonly sidebarCollapsed: boolean
}

export interface LiveStream {
  readonly botId: string
  readonly sessionId: string
  readonly text: string
}

/** 一个 bot 在某个对话里正在做的事。 */
export interface LiveStatus {
  readonly botId: string
  readonly sessionId: string
  /** 正在做的事；空串表示在想。 */
  readonly label: string
  /** 这一轮的执行进度：每一步、计划、正在想什么。 */
  readonly progress: TurnProgress | null
}

/**
 * 你的话还没交到 bot 手上时的“正在……”（挑人、开会话、换段）：服务端用这两个前缀当会话 id，bot 这一轮开始后由真的那段替下。
 * 这时还没有能停的回答，输入框照常是发送。
 */
export function isPreparing(sessionId: string): boolean {
  return sessionId.startsWith('pending:') || sessionId.startsWith('route:')
}

export interface HostActions {
  /** 在 dsh 自己的会话视图里打开某条会话（“查看过程”）。 */
  readonly openSession: (sessionId: string) => void
}

const NAV_KEY = 'pod-ui.nav.v2'

const CLOSED: Omit<NavState, 'roomId' | 'sidebarCollapsed'> = { panel: null, drawer: null, settings: null, search: null, taskId: null, focus: null, page: null, update: false }

function loadNav(): NavState {
  const fallback: NavState = { ...CLOSED, roomId: null, sidebarCollapsed: false }
  try {
    const raw = globalThis.localStorage?.getItem(NAV_KEY)
    if (raw === null || raw === undefined) return fallback
    const parsed = JSON.parse(raw) as Partial<NavState>
    return { ...fallback, roomId: parsed.roomId ?? null, sidebarCollapsed: parsed.sidebarCollapsed === true }
  } catch {
    return fallback
  }
}

function without<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  const next = new Map(map)
  next.delete(key)
  return next
}

/**
 * 整个 Pod 页面的状态：导航、数据缓存、实时事件、打字流和“正在做什么”。
 * 事件只说“什么变了”，这里把它翻译成要失效的数据 key。
 */
export class AppState {
  readonly cache = new ResourceCache()
  readonly events = new PodEvents()
  readonly host: HostActions
  private nav: NavState = loadNav()
  private readonly navListeners = new Set<() => void>()
  /** 每个对话里每条会话的打字流：群聊里几个 bot 可以同时在说。 */
  private streams: ReadonlyMap<string, ReadonlyMap<string, LiveStream>> = new Map()
  private statuses: ReadonlyMap<string, ReadonlyMap<string, LiveStatus>> = new Map()
  private readonly liveListeners = new Set<() => void>()
  /** 子任务 id 到根任务 id，实时动态事件只带子任务 id。 */
  private readonly roots = new Map<string, string>()
  private readonly stopEvents: () => void

  constructor(host: HostActions) {
    this.host = host
    this.stopEvents = this.events.subscribe((event) => this.handle(event))
    // 先拉一次设置，弹通知时要看开关。
    void this.cache.load('settings', () => api.settings())
  }

  dispose(): void {
    this.stopEvents()
    this.events.dispose()
  }

  // ---------- 导航 ----------

  getNav = (): NavState => this.nav

  subscribeNav = (listener: () => void): (() => void) => {
    this.navListeners.add(listener)
    return () => {
      this.navListeners.delete(listener)
    }
  }

  navigate(patch: Partial<NavState>): void {
    const previous = this.nav.roomId
    this.nav = { ...this.nav, ...patch }
    try {
      globalThis.localStorage?.setItem(NAV_KEY, JSON.stringify({ roomId: this.nav.roomId, sidebarCollapsed: this.nav.sidebarCollapsed }))
    } catch {
      // 隐私模式下 localStorage 不可用，忽略。
    }
    for (const listener of this.navListeners) listener()
    if (previous !== null && previous !== this.nav.roomId) this.leftRoom(previous)
  }

  /** 打开一个对话；换了对话，右侧的详情就关掉。开着的页面查看器也关掉。 */
  openRoom(roomId: string): void {
    const same = this.nav.roomId === roomId
    const panel = same ? this.nav.panel : null
    this.navigate({ roomId, focus: null, search: null, settings: null, panel, page: null })
    // 点的就是开着的这个对话：输入框没换，叫它拿焦点；换了对话，新的输入框装上时自己拿。
    if (same) for (const listener of this.focusListeners) listener(roomId)
  }

  /** 手机上回到列表：不在任何对话里（临时对话就此删掉），列表上的未读照常算。宽屏上中间会回到主管的单聊。 */
  showList(): void {
    this.navigate({ roomId: null, panel: null, page: null, focus: null })
  }

  /** 打开和某个 bot 的单聊（没有就建一个）。 */
  openBot(botId: string): void {
    void api.openDirect(botId).then((room) => {
      this.cache.invalidate('rooms')
      this.openRoom(room.id)
    })
  }

  /** 和某个 bot 开一段临时对话：不进侧栏、不提取记忆，离开就删。 */
  startTemporary(botId: string): void {
    void api.openDirect(botId, { fresh: true, incognito: true, topic: TEMPORARY_TOPIC }).then((room) => {
      this.cache.invalidate('rooms')
      this.openRoom(room.id)
    })
  }

  /** 离开临时对话：清掉消息、删掉这个对话。 */
  private leftRoom(roomId: string): void {
    const room = this.cache.snapshot<readonly RoomSummary[]>('rooms').data?.find((item) => item.id === roomId)
    if (room !== undefined && isTemporaryRoom(room)) this.discard(roomId)
  }

  private discard(roomId: string): void {
    void api
      .clearRoom(roomId)
      .catch(() => undefined)
      .then(() => api.updateRoom(roomId, { archived: true }))
      .catch(() => undefined)
      .then(() => this.cache.invalidate('rooms'))
  }

  /** 上次没正常离开的临时对话（比如直接关了页面）：现在不在里面的都删掉。 */
  sweepTemporary(rooms: readonly RoomSummary[]): void {
    for (const room of rooms) if (isTemporaryRoom(room) && room.id !== this.nav.roomId) this.discard(room.id)
  }

  /** 跳到某条消息：加载它前后的内容并高亮。 */
  focusMessage(roomId: string, seq: number, messageId: string): void {
    this.navigate({ roomId, focus: { roomId, seq, messageId }, search: null, page: null })
  }

  openTask(taskId: string): void {
    this.navigate({ taskId })
  }

  /** 打开 bot 详情；from 是群聊 id 时显示成员卡片，可以返回那个群的详情。 */
  showBot(botId: string, tab: BotTab = 'details', from?: string): void {
    this.navigate({ panel: from === undefined ? { kind: 'bot', botId, tab } : { kind: 'bot', botId, tab, from } })
  }

  /** 打开 bot 的完整资料；back 是群聊 id 时左上角能返回它在那个群里的成员卡片。 */
  showProfile(botId: string, tab: BotTab = 'details', back?: string): void {
    this.navigate({ panel: back === undefined ? { kind: 'bot', botId, tab } : { kind: 'bot', botId, tab, back } })
  }

  /** 在对话里点了某个 bot：在群里打开它的成员卡片（能返回群聊详情），在单聊里打开它的详情。 */
  showMember(botId: string): void {
    const roomId = this.nav.roomId
    const room = roomId === null ? undefined : this.cache.snapshot<readonly RoomSummary[]>('rooms').data?.find((item) => item.id === roomId)
    this.showBot(botId, 'details', room !== undefined && room.kind !== 'direct' && room.memberIds.includes(botId) ? room.id : undefined)
  }

  showGroup(roomId: string, tab: GroupTab = 'details'): void {
    this.navigate({ panel: { kind: 'group', roomId, tab } })
  }

  /** 打开浏览器：右侧滑出实时画面。给了 botId 只看那个 bot 的标签页，给了 roomId 只看那个群的。 */
  openBrowserTab(tabId: string | null, botId: string | null = null, roomId?: string): void {
    this.navigate({ panel: roomId === undefined ? { kind: 'browser', tabId, botId } : { kind: 'browser', tabId, botId, roomId } })
  }

  closePanel(): void {
    this.navigate({ panel: null })
  }

  /** 右侧打开页面库。 */
  showPages(): void {
    this.navigate({ panel: { kind: 'pages' } })
  }

  /** 中间换成页面查看器；给了 version 是预览那一版。右侧面板和搜索关上：查看器右边有自己的修改对话和版本列表。 */
  openPage(id: string, version?: number): void {
    this.navigate({ page: version === undefined ? { id } : { id, version }, panel: null, search: null, settings: null })
  }

  closePage(): void {
    this.navigate({ page: null })
  }

  openSettings(tab: SettingsTab = 'general'): void {
    this.navigate({ settings: tab })
  }

  /** 打开更新弹窗：新版本的更新内容和一键更新。 */
  openUpdate(): void {
    this.navigate({ update: true })
  }

  openSearch(query = ''): void {
    this.navigate({ search: query })
  }

  openDrawer(drawer: DrawerState): void {
    this.navigate({ drawer })
  }

  // ---------- 打字流和“正在做什么” ----------

  streamMap(roomId: string): ReadonlyMap<string, LiveStream> | undefined {
    return this.streams.get(roomId)
  }

  statusMap(roomId: string): ReadonlyMap<string, LiveStatus> | undefined {
    return this.statuses.get(roomId)
  }

  /** 侧栏的状态点：有 bot 正在回答的对话。 */
  liveRooms(): ReadonlyMap<string, ReadonlyMap<string, LiveStatus>> {
    return this.statuses
  }

  subscribeLive = (listener: () => void): (() => void) => {
    this.liveListeners.add(listener)
    return () => {
      this.liveListeners.delete(listener)
    }
  }

  private changedLive(): void {
    for (const listener of this.liveListeners) listener()
  }

  private setStream(roomId: string, stream: LiveStream, done: boolean): void {
    const current = this.streams.get(roomId) ?? new Map<string, LiveStream>()
    const next = done || stream.text === '' ? without(current, stream.sessionId) : new Map([...current, [stream.sessionId, stream]])
    this.streams = next.size === 0 ? without(this.streams, roomId) : new Map([...this.streams, [roomId, next]])
    this.changedLive()
  }

  private setStatus(roomId: string, status: LiveStatus, running: boolean): void {
    const current = this.statuses.get(roomId) ?? new Map<string, LiveStatus>()
    const next = running ? new Map([...current, [status.sessionId, status]]) : without(current, status.sessionId)
    this.statuses = next.size === 0 ? without(this.statuses, roomId) : new Map([...this.statuses, [roomId, next]])
    if (!running) {
      const streams = this.streams.get(roomId)
      if (streams?.has(status.sessionId) === true) this.streams = new Map([...this.streams, [roomId, without(streams, status.sessionId)]])
    }
    this.changedLive()
  }

  // ---------- 任务树 ----------

  rememberTree(rootId: string, ids: readonly string[]): void {
    for (const id of ids) this.roots.set(id, rootId)
  }

  rootOf(taskId: string): string {
    return this.roots.get(taskId) ?? taskId
  }

  // ---------- 浏览器系统通知 ----------

  /** 设置里开了浏览器通知、浏览器也允许时弹一条；点一下回到对应的对话。 */
  private popup(notification: PodNotification): void {
    const settings = this.cache.snapshot<PodSettings>('settings').data
    if (settings === undefined || !settings.browserNotifications) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()) return
    try {
      const popup = new Notification(notification.title, { body: notification.body, tag: notification.id })
      popup.onclick = () => {
        window.focus()
        if (notification.roomId !== null) this.openRoom(notification.roomId)
        else if (notification.taskId !== null) this.openTask(notification.taskId)
        popup.close()
      }
    } catch {
      // 某些浏览器在非安全上下文里不允许弹通知。
    }
  }

  // ---------- 事件 ----------

  private handle(event: PodEvent): void {
    const { cache } = this
    switch (event.type) {
      case 'resync':
        cache.invalidateAll()
        return
      case 'status':
        cache.invalidate('status')
        return
      case 'settings':
        cache.invalidate('settings')
        return
      case 'bots':
        cache.invalidate('bots')
        cache.invalidate('recycle')
        return
      case 'teams':
        cache.invalidate('teams')
        cache.invalidate('recycle')
        return
      case 'rooms':
        cache.invalidate('rooms')
        return
      case 'room':
        cache.invalidate(`members:${event.roomId}`)
        cache.invalidate('rooms')
        return
      case 'message':
        cache.invalidate(`messages:${event.roomId}`)
        cache.invalidate(`ratings:${event.roomId}`)
        cache.invalidate((key) => key.startsWith('page-thread:'))
        return
      case 'pages':
        cache.invalidate('pages')
        if (event.pageId === undefined) cache.invalidate((key) => key.startsWith('page:'))
        else cache.invalidate(`page:${event.pageId}`)
        return
      case 'stream':
        this.setStream(event.roomId, { botId: event.botId, sessionId: event.sessionId, text: event.text }, event.done)
        return
      case 'task': {
        const root = this.rootOf(event.rootId)
        cache.invalidate(`snapshot:${root}`)
        cache.invalidate(`snapshot:${event.taskId}`)
        cache.invalidate(`detail:${root}`)
        cache.invalidate(`plan:${root}`)
        cache.invalidate('tasks')
        return
      }
      case 'activity':
        cache.invalidate(`activity:${event.sessionId}`)
        if (typeof event.roomId === 'string' && event.botId !== undefined) {
          this.setStatus(event.roomId, { botId: event.botId, sessionId: event.sessionId, label: event.label ?? '', progress: event.progress ?? null }, event.running === true)
        }
        if (event.taskId !== null) {
          const root = this.rootOf(event.taskId)
          cache.invalidate(`snapshot:${root}`)
          cache.invalidate(`snapshot:${event.taskId}`)
          cache.invalidate(`detail:${root}`)
        }
        return
      case 'waits':
        cache.invalidate('waits')
        cache.invalidate('rooms')
        return
      case 'notifications':
        cache.invalidate('notifications')
        return
      case 'notify':
        this.popup(event.notification)
        return
      case 'memory':
        cache.invalidate('memory')
        return
      case 'routines':
        cache.invalidate('routines')
        return
      case 'skills':
        cache.invalidate('skills')
        return
      case 'aibot':
        cache.invalidate('aibot')
        return
      case 'update':
        cache.invalidate('update')
        return
      case 'evolution':
        cache.invalidate('evolution')
        cache.invalidate('scorecards')
        cache.invalidate((key) => key.startsWith('weekly:'))
        return
      case 'browser':
        cache.invalidate('browser')
        if (event.pointer !== undefined && event.tabId !== null) for (const listener of this.pointerListeners) listener(event.tabId, event.pointer)
        return
      default:
        return
    }
  }

  // ---------- 往输入框里插字（成员卡片上的“@ 它”） ----------

  private readonly insertListeners = new Set<(roomId: string, text: string) => void>()

  insertText(roomId: string, text: string): void {
    for (const listener of this.insertListeners) listener(roomId, text)
  }

  onInsert(listener: (roomId: string, text: string) => void): () => void {
    this.insertListeners.add(listener)
    return () => {
      this.insertListeners.delete(listener)
    }
  }

  // ---------- 叫输入框拿焦点（侧栏里点正开着的那个对话） ----------

  private readonly focusListeners = new Set<(roomId: string) => void>()

  onFocusComposer(listener: (roomId: string) => void): () => void {
    this.focusListeners.add(listener)
    return () => {
      this.focusListeners.delete(listener)
    }
  }

  // ---------- bot 正要点击的位置 ----------

  private readonly pointerListeners = new Set<(tabId: string, pointer: { readonly x: number; readonly y: number; readonly label: string }) => void>()

  onPointer(listener: (tabId: string, pointer: { readonly x: number; readonly y: number; readonly label: string }) => void): () => void {
    this.pointerListeners.add(listener)
    return () => {
      this.pointerListeners.delete(listener)
    }
  }
}

export const AppContext = createContext<AppState | null>(null)

export function useApp(): AppState {
  const app = useContext(AppContext)
  if (app === null) throw new Error(t('dsh-bot 页面缺少 AppContext'))
  return app
}

export function useNav(): NavState {
  const app = useApp()
  return useSyncExternalStore(app.subscribeNav, app.getNav, app.getNav)
}

/** 某个对话里正在输入的几段文字和正在做的事；没有变化时返回同一个数组，不重复渲染。 */
export function useLive(roomId: string | null): { readonly streams: readonly LiveStream[]; readonly statuses: readonly LiveStatus[] } {
  const app = useApp()
  const getStreams = useCallback(() => (roomId === null ? undefined : app.streamMap(roomId)), [app, roomId])
  const getStatuses = useCallback(() => (roomId === null ? undefined : app.statusMap(roomId)), [app, roomId])
  const streams = useSyncExternalStore(app.subscribeLive, getStreams, getStreams)
  const statuses = useSyncExternalStore(app.subscribeLive, getStatuses, getStatuses)
  return { streams: [...(streams?.values() ?? [])], statuses: [...(statuses?.values() ?? [])] }
}

/** 侧栏用：有 bot 正在回答的对话。 */
export function useLiveRooms(): ReadonlySet<string> {
  const app = useApp()
  const get = useCallback(() => app.liveRooms(), [app])
  const statuses = useSyncExternalStore(app.subscribeLive, get, get)
  return new Set(statuses.keys())
}

/** 订阅原始事件（比如时间线要按消息增量合并）。 */
export function usePodEvent(listener: (event: PodEvent) => void, deps: readonly unknown[]): void {
  const app = useApp()
  useEffect(() => app.events.subscribe(listener), [app, ...deps])
}
