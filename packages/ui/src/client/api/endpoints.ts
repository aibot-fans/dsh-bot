import type {
  Activity,
  Bot,
  CoreMemory,
  DreamDetail,
  Language,
  PodNotification,
  Routine,
  MemoryDream,
  MemoryEntry,
  MemoryNote,
  MemoryScopeKind,
  SearchHit,
  Team,
  TeamTemplate,
  PodSession,
  PodSettings,
  Room,
  RoomActivity,
  RoomMessage,
  RoomSummary,
  TaskActivity,
  TaskReport,
  TaskSnapshot,
  TabInfo,
  Wait,
  EvolutionEntry,
  Scorecard,
  SeedUpdate,
  SidebarPrefs,
  Skill,
} from 'pod-domain'
import { apiGet, apiPost } from './http.ts'

/** 页面用到的全部接口；类型和宿主共用 pod-domain。 */

export interface PodStatus {
  readonly version: string
  readonly dshVersion: string
  readonly readOnly: boolean
  readonly problems: readonly string[]
  readonly degraded: readonly string[]
  readonly lastBackupAt: number | null
  readonly dataRoot: string
  readonly workspaceRoot: string
  readonly exposure: { readonly exposed: boolean; readonly reasons: readonly string[]; readonly note: string | null }
}

/** 系统问题：种类、最后一次错误（已打码）、连续失败几次、从什么时候开始。 */
export interface SystemProblem {
  readonly id: number
  readonly kind: string
  readonly detail: string
  readonly failures: number
  readonly startedAt: number
  readonly updatedAt: number
  readonly resolvedAt: number | null
}

export interface HealthReport {
  readonly problems: readonly SystemProblem[]
  readonly recent: readonly SystemProblem[]
  readonly queues: readonly { readonly kind: string; readonly waiting: number; readonly failing: number; readonly since: number | null }[]
  readonly exactlyOnce: boolean
  readonly paused: boolean
}

export interface BotVersion {
  readonly id: string
  readonly botId: string
  readonly version: number
  readonly source: string
  readonly reason: string
  readonly createdAt: number
  readonly config: Readonly<Record<string, unknown>>
}

export interface ModelCatalog {
  readonly default: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
  readonly groups: readonly {
    readonly id: string
    readonly name: string
    readonly models: readonly {
      readonly id: string
      readonly name: string
      readonly reasoning?: { readonly efforts: readonly { readonly id: string; readonly label?: string; readonly name?: string }[] }
    }[]
  }[]
}

export interface AuditEntry {
  readonly id: number
  readonly kind: string
  readonly actor: string
  readonly subject: string
  readonly detail: Readonly<Record<string, unknown>>
  readonly createdAt: number
}

export interface MemoryChange {
  readonly id: number
  readonly memoryId: string
  readonly action: string
  readonly before: MemoryEntry | null
  readonly after: MemoryEntry | null
  readonly actor: string
  readonly reason: string
  readonly createdAt: number
  readonly revertedAt: number | null
}

export interface HandoverNote {
  readonly id: string
  readonly fromSession: string
  readonly toSession: string | null
  readonly botId: string
  readonly note: Readonly<Record<string, unknown>>
  readonly reason: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface TabView extends TabInfo {
  readonly ownerName: string
  readonly botId: string | null
  readonly taskId: string | null
  readonly taskTitle: string
  /** 属于哪个对话：bot 在那里打开的，或者你在那个群的浏览器页里开的。 */
  readonly roomId: string | null
}

export interface BrowserState {
  /** saved：上次（dsh web 重启前）你自己开着、还没恢复的网页有几个。 */
  readonly status: { readonly available: boolean; readonly running: boolean; readonly version: string; readonly tabs: number; readonly saved: number; readonly error: string }
  readonly tabs: readonly TabView[]
}

export type BrowserOverlay =
  | { readonly kind: 'select'; readonly ref: string; readonly multiple: boolean; readonly options: readonly { readonly value: string; readonly text: string; readonly selected: boolean }[] }
  | { readonly kind: 'dialog'; readonly type: string; readonly message: string; readonly defaultPrompt: string }
  | null

export type BrowserInput =
  | { readonly type: 'mouse'; readonly action: 'move' | 'down' | 'up'; readonly x: number; readonly y: number; readonly button?: string; readonly clickCount?: number; readonly modifiers?: number }
  | { readonly type: 'wheel'; readonly x: number; readonly y: number; readonly deltaX: number; readonly deltaY: number }
  | { readonly type: 'key'; readonly action: 'down' | 'up'; readonly key: string; readonly code: string; readonly keyCode: number; readonly modifiers?: number; readonly text?: string }
  | { readonly type: 'text'; readonly text: string }

export interface SkillView extends Skill {
  readonly scopeName: string
}

export interface SkillVersion {
  readonly version: number
  readonly title: string
  readonly description: string
  readonly content: string
  readonly reason: string
  readonly createdAt: number
}

export interface WeeklyData {
  readonly entries: readonly EvolutionEntry[]
  readonly owner: readonly string[]
  readonly autonomy: { readonly asked: number; readonly bypassed: number; readonly edited: number; readonly tasks: number }
}

export type UsageRange = 'today' | '7d' | '30d'

export interface UsageShare {
  /** bot 或对话的 id；null 是后台的轻量调用，或者不属于任何对话。 */
  readonly id: string | null
  readonly cost: number
  readonly tokens: number
}

export interface UsageReport {
  readonly range: UsageRange
  readonly since: number
  readonly cost: number
  readonly tokens: number
  readonly cacheHit: number
  readonly saved: number
  readonly series: readonly { readonly label: string; readonly start: number; readonly cost: number; readonly tokens: number }[]
  readonly byBot: readonly UsageShare[]
  readonly byRoom: readonly UsageShare[]
}

export interface LibraryItem {
  readonly name: string
  readonly path: string
  readonly size: number
  readonly modifiedAt: number
  readonly kind: 'image' | 'doc' | 'web' | 'file'
}

export const api = {
  taskFiles: (id: string) => apiGet<readonly LibraryItem[]>('/task/files', { id }),
  status: () => apiGet<PodStatus>('/status'),
  health: () => apiGet<HealthReport>('/health'),
  retryProblem: (kind: string) => apiPost<{ readonly retried: number }>('/health/retry', { kind }),
  settings: () => apiGet<PodSettings>('/settings'),
  updateSettings: (patch: Partial<PodSettings>) => apiPost<PodSettings>('/settings/update', patch),
  reportLocale: (locale: string) => apiPost<{ readonly language: Language; readonly changed: boolean }>('/locale', { locale }),
  models: () => apiGet<ModelCatalog>('/models'),

  bots: () => apiGet<readonly Bot[]>('/bots'),
  createBot: (draft: unknown) => apiPost<Bot>('/bot/create', draft),
  updateBot: (id: string, patch: unknown) => apiPost<Bot>('/bot/update', { id, patch }),
  archiveBot: (id: string) => apiPost<Bot>('/bot/archive', { id }),
  restoreBot: (id: string) => apiPost<Bot>('/bot/restore', { id }),
  rollbackBot: (id: string, version: number) => apiPost<Bot>('/bot/rollback', { id, version }),
  botVersions: (id: string) => apiGet<readonly BotVersion[]>('/bot/versions', { id }),
  /** 你改过的默认人设、默认在那之后出了新版：两版默认的原文；没有是 null。 */
  botSeed: (id: string) => apiGet<SeedUpdate | null>('/bot/seed', { id }),
  keepSeed: (id: string) => apiPost<null>('/bot/seed/keep', { id }),
  adoptSeed: (id: string) => apiPost<Bot>('/bot/seed/adopt', { id }),
  recycle: () => apiGet<{ readonly bots: readonly Bot[]; readonly teams: readonly Team[] }>('/recycle'),

  teams: () => apiGet<readonly Team[]>('/teams'),
  teamTemplates: () => apiGet<readonly TeamTemplate[]>('/team/templates'),
  createTeam: (input: unknown) => apiPost<Team>('/team/create', input),
  updateTeam: (id: string, patch: unknown) => apiPost<Team>('/team/update', { id, patch }),
  archiveTeam: (id: string) => apiPost<Team>('/team/archive', { id }),
  restoreTeam: (id: string) => apiPost<Team>('/team/restore', { id }),
  teamFromTemplate: (templateId: string, name?: string) => apiPost<Team>('/team/from-template', { templateId, name }),

  rooms: (archived = false) => apiGet<readonly RoomSummary[]>('/rooms', { archived: archived ? 'true' : undefined }),
  openDirect: (botId: string, options: { readonly fresh?: boolean; readonly incognito?: boolean; readonly topic?: string } = {}) =>
    apiPost<Room>('/room/open', { botId, ...options }),
  messages: (roomId: string, page: { readonly before?: number; readonly after?: number; readonly limit?: number } = {}) =>
    apiGet<{ readonly room: Room; readonly messages: readonly RoomMessage[] }>('/room/messages', { roomId, ...page }),
  roomInfo: (roomId: string) =>
    apiGet<{ readonly room: Room; readonly members: readonly { readonly botId: string; readonly muted: boolean }[]; readonly sessions: readonly PodSession[] }>(
      '/room/info',
      { roomId },
    ),
  members: (roomId: string) => apiGet<readonly { readonly botId: string; readonly muted: boolean }[]>('/room/members', { roomId }),
  send: (roomId: string, text: string, replyTo?: string) => apiPost<RoomMessage>('/room/send', { roomId, text, replyTo }),
  markRead: (roomId: string, seq: number) => apiPost<null>('/room/read', { roomId, seq }),
  updateRoom: (roomId: string, patch: unknown) => apiPost<Room>('/room/update', { roomId, patch }),
  pinMessage: (messageId: string, pinned: boolean) => apiPost<RoomMessage>('/message/pin', { messageId, pinned }),
  pinnedMessages: (roomId: string) => apiGet<readonly RoomMessage[]>('/room/pins', { roomId }),
  /** 群、单聊的动态：建群，之后每句交代、每一轮一组，组里是做成的几步，先的在前；默认只列最近的几十组，all 全读。 */
  roomActivity: (id: string, all = false) => apiGet<RoomActivity>('/room/activity', { id, all: all ? 1 : undefined }),

  tasks: (status?: string) => apiGet<readonly TaskSnapshot[]>('/tasks', { status }),
  taskSnapshot: (id: string) => apiGet<TaskSnapshot>('/task/snapshot', { id }),
  /** 任务详情里的动态：创建了任务，之后每次接着说、每一轮一组。默认只列最近的几十组，all 全读。 */
  taskActivity: (id: string, all = false) => apiGet<Activity>('/task/activity', { id, all: all ? 1 : undefined }),
  /** 没有自己对话的任务放结果的那条消息；一条有关的消息都没有是 null。 */
  taskMessage: (id: string) => apiGet<RoomMessage | null>('/task/message', { id }),
  controlTask: (taskId: string, action: 'pause' | 'resume' | 'stop' | 'cancel' | 'retry' | 'accept') => apiPost('/task/control', { taskId, action }),
  redeliverTask: (taskId: string) => apiPost('/task/redeliver', { taskId }),
  approvePlan: (taskId: string) => apiPost('/task/approve', { taskId }),
  stopAll: () => apiPost<{ readonly stopped: number }>('/tasks/stop-all'),

  waits: () => apiGet<readonly Wait[]>('/waits'),
  /** 一件等你处理的事，处理过的也取得到（卡片上要画出选了哪个）。 */
  wait: (id: string) => apiGet<Wait>('/wait', { id }),
  /** 带着这件事卡片的那条消息，卡片已经不在了是 null。 */
  waitCard: (id: string) => apiGet<RoomMessage | null>('/wait/card', { id }),
  /** 答复；在对话里的问题卡片上答的带上卡片在哪段对话、哪条消息上，回答也作为你的一句话留在那里。 */
  answerWait: (waitId: string, answer: string, card?: { readonly roomId: string; readonly messageId: string }) => apiPost<Wait>('/wait/answer', { waitId, answer, ...card }),
  dismissWait: (waitId: string) => apiPost<Wait>('/wait/dismiss', { waitId }),

  activity: (id: string) => apiGet<TaskActivity | null>('/session/activity', { id }),
  message: (id: string) => apiGet<RoomMessage>('/message', { id }),
  messagesAround: (roomId: string, seq: number) =>
    apiGet<{ readonly room: Room; readonly messages: readonly RoomMessage[] }>('/room/messages', { roomId, around: seq, limit: 50 }),

  memories: (scope: MemoryScopeKind, scopeId = '', status?: string) => apiGet<readonly MemoryEntry[]>('/memory', { scope, scopeId, status }),
  core: (scope: MemoryScopeKind, scopeId = '') => apiGet<CoreMemory>('/memory/core', { scope, scopeId }),
  setCore: (scope: MemoryScopeKind, scopeId: string, text: string) => apiPost<CoreMemory>('/memory/core', { scope, scopeId, text }),
  addMemory: (input: unknown) => apiPost<MemoryEntry>('/memory/add', input),
  updateMemory: (id: string, patch: unknown) => apiPost<MemoryEntry>('/memory/update', { id, patch }),
  deleteMemory: (id: string) => apiPost<MemoryEntry>('/memory/delete', { id }),
  memoryChanges: () => apiGet<readonly MemoryChange[]>('/memory/changes'),
  revertMemory: (logId: number) => apiPost<MemoryEntry>('/memory/revert', { logId }),
  /** 一个范围的主题笔记、并进笔记的条目（每句话的出处）和你写的“整理时留意什么”。 */
  notes: (scope: MemoryScopeKind, scopeId = '') => apiGet<{ readonly notes: readonly MemoryNote[]; readonly merged: readonly MemoryEntry[]; readonly guide: string }>('/memory/notes', { scope, scopeId }),
  updateNote: (id: string, patch: unknown) => apiPost<MemoryNote>('/memory/note/update', { id, patch }),
  setGuide: (scope: MemoryScopeKind, scopeId: string, text: string) => apiPost<string>('/memory/guide', { scope, scopeId, text }),
  dreams: () => apiGet<readonly MemoryDream[]>('/memory/dreams'),
  dream: (id: string) => apiGet<DreamDetail>('/memory/dream', { id }),
  /** 现在整理一次；给了范围就只整理它，并把它没整理进笔记的条目全部重看一遍。 */
  startDream: (scope?: MemoryScopeKind, scopeId?: string) => apiPost<MemoryDream>('/memory/dream/start', { scope, scopeId }),
  applyDream: (id: string, skip: readonly number[]) => apiPost<DreamDetail>('/memory/dream/apply', { id, skip }),
  discardDream: (id: string) => apiPost<MemoryDream>('/memory/dream/discard', { id }),
  /** 下一次整理把最近 30 天的对话和任务重新读一遍。 */
  rereadDreams: () => apiPost<number>('/memory/dream/reread', {}),
  revertDream: (id: string) => apiPost<DreamDetail>('/memory/dream/revert', { id }),
  answerDream: (id: string, questionId: string, label: string) => apiPost<DreamDetail>('/memory/dream/answer', { id, questionId, label }),
  routines: () => apiGet<readonly (Routine & { readonly description: string })[]>('/routines'),
  createRoutine: (input: unknown) => apiPost<Routine>('/routine/create', input),
  updateRoutine: (id: string, patch: unknown) => apiPost<Routine>('/routine/update', { id, patch }),
  deleteRoutine: (id: string) => apiPost<null>('/routine/delete', { id }),
  runRoutine: (id: string) => apiPost<Routine>('/routine/run', { id }),
  notifications: () => apiGet<{ readonly items: readonly PodNotification[]; readonly unread: number }>('/notifications'),
  readNotifications: (ids?: readonly string[]) => apiPost<null>('/notifications/read', { ids }),
  scorecards: () => apiGet<readonly { readonly botId: string; readonly name: string; readonly temporary: boolean; readonly card: Scorecard }[]>('/scorecards'),
  evolution: (since?: number) => apiGet<readonly EvolutionEntry[]>('/evolution', { since }),
  revertEvolution: (id: string) => apiPost<EvolutionEntry>('/evolution/revert', { id }),
  weekly: (since: number) => apiGet<WeeklyData>('/weekly', { since }),
  skills: () => apiGet<readonly SkillView[]>('/skills'),
  skillVersions: (id: string) => apiGet<readonly SkillVersion[]>('/skill/versions', { id }),
  saveSkill: (input: unknown) => apiPost<Skill>('/skill/save', input),
  setSkillStatus: (id: string, status: 'active' | 'archived') => apiPost<Skill>('/skill/status', { id, status }),
  rollbackSkill: (id: string, version: number) => apiPost<Skill>('/skill/rollback', { id, version }),
  regenerate: (messageId: string) => apiPost<null>('/message/regenerate', { messageId }),
  retryTurn: (messageId: string) => apiPost<null>('/message/retry', { messageId }),
  uploadFile: (roomId: string, name: string, data: string, note = '') => apiPost<RoomMessage>('/room/upload', { roomId, name, data, note }),
  rateMessage: (messageId: string, value: number, reason = '') => apiPost<{ readonly messageId: string; readonly value: number }>('/message/rate', { messageId, value, reason }),
  ratings: (roomId: string) => apiGet<Readonly<Record<string, number>>>('/ratings', { roomId }),
  browser: () => apiGet<BrowserState>('/browser/tabs'),
  /** 你开一个标签页；roomId 是在哪个群里开的（那个群的浏览器页里也列出来）。 */
  openTab: (url: string, options: { readonly incognito?: boolean; readonly roomId?: string } = {}) => apiPost<TabInfo>('/browser/open', { url, incognito: options.incognito === true, ...(options.roomId === undefined ? {} : { roomId: options.roomId }) }),
  restoreTabs: () => apiPost<{ readonly restored: number }>('/browser/restore', {}),
  navigateTab: (tabId: string, url: string) => apiPost<TabInfo>('/browser/navigate', { tabId, url }),
  tabHistory: (tabId: string, action: 'back' | 'forward' | 'reload') => apiPost<TabInfo>('/browser/history', { tabId, action }),
  closeTab: (tabId: string) => apiPost<null>('/browser/close', { tabId }),
  takeover: (tabId: string) => apiPost<TabInfo>('/browser/takeover', { tabId }),
  handback: (tabId: string, note: string) => apiPost<TabInfo>('/browser/handback', { tabId, note }),
  browserInput: (tabId: string, events: readonly BrowserInput[]) => apiPost<{ readonly overlay: BrowserOverlay }>('/browser/input', { tabId, events }),
  selectOption: (tabId: string, ref: string, value: string) => apiPost<null>('/browser/select', { tabId, ref, value }),
  answerDialog: (tabId: string, accept: boolean, text: string) => apiPost<null>('/browser/dialog', { tabId, accept, text }),
  tabFiles: (tabId: string) => apiGet<readonly string[]>('/browser/files', { tabId }),
  chooseFile: (tabId: string, path: string) => apiPost<null>('/browser/file', { tabId, path }),
  tabSelection: (tabId: string) => apiGet<string>('/browser/selection', { tabId }),
  search: (q: string, kinds?: string) => apiGet<readonly SearchHit[]>('/search', { q, kinds }),
  handovers: (roomId: string) => apiGet<readonly HandoverNote[]>('/handovers', { roomId }),
  updateHandover: (id: string, note: unknown) => apiPost<HandoverNote>('/handover/update', { id, note }),
  audit: (before?: number) => apiGet<readonly AuditEntry[]>('/audit', { before, limit: 100 }),
  backupNow: () => apiPost<{ readonly file: string }>('/maintenance/backup'),

  /** 用量；给了 roomId 或 botId 时只算那个对话或那个 bot 的。 */
  usage: (range: UsageRange, scope: { readonly roomId?: string; readonly botId?: string } = {}) => apiGet<UsageReport>('/usage', { range, ...scope }),
  library: (target: { readonly botId?: string; readonly roomId?: string }) => apiGet<readonly LibraryItem[]>('/library', target),
  createGroup: (name: string, memberIds: readonly string[], leaderId?: string, topic = '') => apiPost<Room>('/room/create-group', { name, memberIds, ...(leaderId === undefined ? {} : { leaderId }), ...(topic === '' ? {} : { topic }) }),
  addMember: (roomId: string, botId: string) => apiPost<null>('/room/member/add', { roomId, botId }),
  removeMember: (roomId: string, botId: string) => apiPost<null>('/room/member/remove', { roomId, botId }),
  stopReply: (roomId: string) => apiPost<{ readonly stopped: number }>('/room/stop', { roomId }),
  /** 开新对话：给 roomId 在这个 bot 的单聊里另开一段，给 botId 就开和这个 bot 的新对话。 */
  newConversation: (target: { readonly roomId: string } | { readonly botId: string }) => apiPost<Room>('/room/new-conversation', target),
  deleteConversation: (roomId: string) => apiPost<null>('/room/delete-conversation', { roomId }),
  clearRoom: (roomId: string) => apiPost<{ readonly removed: number }>('/room/clear', { roomId }),
  sidebar: () => apiGet<SidebarPrefs>('/sidebar'),
  saveSidebar: (prefs: SidebarPrefs) => apiPost<SidebarPrefs>('/sidebar', prefs),
  uploadAvatar: (botId: string, name: string, data: string) => apiPost<Bot>('/bot/avatar', { id: botId, name, data }),
}
