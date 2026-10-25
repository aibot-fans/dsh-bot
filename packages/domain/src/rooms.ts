/** 房间和消息：单聊是你和一个 bot；任务记录按时间记下团队怎么完成任务。都以 SQLite 为准。 */

export type RoomKind = 'direct' | 'task' | 'team'

/** 通知级别：全部、只有等你处理、关闭。 */
export type NotifyLevel = 'all' | 'waits' | 'off'

export interface Room {
  readonly id: string
  readonly kind: RoomKind
  readonly title: string
  /** 单聊的对象；任务记录和团队记录为 null。 */
  readonly botId: string | null
  readonly teamId: string | null
  /** 任务记录对应的根任务。 */
  readonly taskId: string | null
  /** 同一个 bot 可以按话题开多个单聊。 */
  readonly topic: string
  readonly pinned: boolean
  /** 无痕单聊：不提取记忆。 */
  readonly incognito: boolean
  readonly notifyLevel: NotifyLevel
  readonly lastSeq: number
  readonly readSeq: number
  readonly lastMessageAt: number | null
  readonly createdAt: number
  readonly archivedAt: number | null
}

/** owner 是你，pod 是 Pod 自己生成的记录（里程碑、回执），其余是 bot id。 */
export type MessageAuthor = string

export const OWNER = 'owner'
export const POD = 'pod'

/**
 * 消息种类：
 * text 普通发言；milestone 一行里程碑；task-card 原地刷新的任务卡（完成后变成交付卡）；
 * kickoff 开工说明；wait 等你卡；receipt 回执；notice 一行说明；folded 折叠内容（咨询、评审原文）；weekly “本周变化”卡；
 * browser bot 打开网页时放进对话的浏览器卡片（点开看实时画面、可以接管）。
 */
export type MessageKind = 'text' | 'milestone' | 'task-card' | 'kickoff' | 'wait' | 'receipt' | 'notice' | 'folded' | 'weekly' | 'browser' | 'page'

export interface RoomMessage {
  readonly id: string
  readonly roomId: string
  readonly seq: number
  readonly author: MessageAuthor
  readonly kind: MessageKind
  readonly body: string
  readonly data: Readonly<Record<string, unknown>>
  readonly replyTo: string | null
  readonly pinned: boolean
  /** bot 的发言来自哪条会话，“查看过程”用它打开 dsh 的会话视图。 */
  readonly sessionId: string | null
  /** 卡片原地更新时递增。 */
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly deletedAt: number | null
}

export interface RoomSummary extends Room {
  readonly unread: number
  readonly preview: string
  /** 有任务在跑时显示状态点。 */
  readonly busy: boolean
  readonly waits: number
  /** 房间成员（bot id），群聊详情和 bot 的“所在群聊”用。 */
  readonly memberIds: readonly string[]
  /** 单聊：你在这段对话里说的第一句话，对话记录里当标题；还没说过话或群聊是空串。 */
  readonly subject: string
}

export const ROOM_TITLE_MAX = 40

/** 群名最多几个字：侧栏里一眼能看完。 */
export const GROUP_NAME_MAX = 8

const GROUP_NAME_LEAD = /^(请你?|帮我|帮忙|麻烦|给我|我想|我要|需要|一起)+/

/** 从任务目标里取一个短群名：第一个分句，去掉“帮我”这类开头，截到 8 个字。 */
export function shortGroupName(text: string): string {
  const first = text.trim().split(/[，。,.;；:：！!？?\n、]/)[0] ?? ''
  const cleaned = first.replace(GROUP_NAME_LEAD, '').replace(/\s+/g, '').trim()
  const chars = [...(cleaned === '' ? text.replace(/\s+/g, '') : cleaned)]
  return chars.slice(0, GROUP_NAME_MAX).join('') || '新群聊'
}

/** 没起群名时按成员起一个：名字连起来不超过 8 个字就直接用，否则写成「第一个成员等 N 位」。 */
export function autoGroupName(names: readonly string[]): string {
  const clean = names.map((name) => name.trim()).filter((name) => name !== '')
  if (clean.length === 0) return '新群聊'
  const joined = clean.join('、')
  if ([...joined].length <= GROUP_NAME_MAX) return joined
  const suffix = `等${clean.length}位`
  return `${[...(clean[0] ?? '')].slice(0, GROUP_NAME_MAX - [...suffix].length).join('')}${suffix}`
}

/** 群里不认得主管现在的名字时，这些叫法也指主管。 */
export const LEAD_ALIASES: readonly string[] = ['主管', '管理员']

/** 用户说一句话以后，bot 之间在群里最多互相点名几次；到了就先把结论回给用户。 */
export const BOT_CALL_LIMIT = 6

/** 最近一条用户消息之后，bot 在群里点名了几个成员（每条带 calls 的 bot 消息按点名人数算）。 */
export function botCallsSinceOwner(messages: readonly Pick<RoomMessage, 'author' | 'data'>[]): number {
  let count = 0
  for (const message of [...messages].reverse()) {
    if (message.author === OWNER) break
    const calls = message.data.calls
    if (message.author !== POD && Array.isArray(calls)) count += calls.length
  }
  return count
}

/** 临时对话的话题名：这种单聊不进侧栏、不提取记忆，离开就删。 */
export const TEMPORARY_TOPIC = '临时对话'

export function isTemporaryRoom(room: Pick<Room, 'kind' | 'incognito' | 'topic'>): boolean {
  return room.kind === 'direct' && room.incognito && room.topic === TEMPORARY_TOPIC
}

export const MESSAGE_MAX = 20_000
