/** 房间和消息：单聊是你和一个 bot；任务记录按时间记下团队怎么完成任务。都以 SQLite 为准。 */

import { currentLanguage, t, translate, type Language } from './i18n.ts'

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

/** 群名建议不超过几个字：侧栏里一眼能看完。只是建议，起好的名字不截断，侧栏里放不下时悬停看全名。 */
export const GROUP_NAME_MAX = 12

/** 按语言的建议长度：英文单词长，放宽到 32 个字符。 */
export function groupNameMax(language: Language = currentLanguage()): number {
  return language === 'en' ? 32 : GROUP_NAME_MAX
}

/** 从目标里取群名时，第一个分句在这个长度以内就整句用，不把词截成半截。 */
function clauseMax(language: Language = currentLanguage()): number {
  return language === 'en' ? 48 : 20
}

const GROUP_NAME_LEAD = /^(请你?|帮我|帮忙|麻烦|给我|我想|我要|需要|一起)+/
const GROUP_NAME_LEAD_EN = /^((please|pls|help me( to)?|can you|could you|i want to|i need to|let's|lets)\s+)+/i

/** 截到上限；有空格的（英文）尽量在词边上断。 */
function clipName(text: string, max: number): string {
  const chars = [...text]
  if (chars.length <= max) return text
  const cut = chars.slice(0, max).join('')
  const space = cut.lastIndexOf(' ')
  return space >= max / 2 ? cut.slice(0, space) : cut
}

/** 从任务目标里取一个短群名：第一个分句，去掉“帮我”这类开头；分句不太长就整句用，太长才截到建议长度。 */
export function shortGroupName(text: string): string {
  const first = text.trim().split(/[，。,.;；:：！!？?\n、]/)[0] ?? ''
  const latin = /[A-Za-z]/.test(first)
  const spaces = (value: string): string => (latin ? value.replace(/\s+/g, ' ').trim() : value.replace(/\s+/g, ''))
  const cleaned = spaces(first.replace(GROUP_NAME_LEAD, '').replace(GROUP_NAME_LEAD_EN, ''))
  const source = cleaned === '' ? spaces(text) : cleaned
  const name = [...source].length <= clauseMax() ? source : clipName(source, groupNameMax())
  return name === '' ? t('新群聊') : latin ? `${name.charAt(0).toUpperCase()}${name.slice(1)}` : name
}

/** 没起群名时按成员起一个：名字连起来不超过建议长度就直接用，否则写成「第一个成员等 N 位」。 */
export function autoGroupName(names: readonly string[]): string {
  const clean = names.map((name) => name.trim()).filter((name) => name !== '')
  if (clean.length === 0) return t('新群聊')
  const joined = clean.join(t('、'))
  const max = groupNameMax()
  if ([...joined].length <= max) return joined
  const suffix = t('等{length}位', { length: clean.length })
  return `${[...(clean[0] ?? '')].slice(0, max - [...suffix].length).join('')}${suffix}`
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

const UPLOAD_NOTE = '上传了文件「{name}」'

/** 只传文件、没写话时消息的正文。 */
export function uploadNote(name: string): string {
  return t(UPLOAD_NOTE, { name })
}

/** 是不是自动写的“上传了文件”（两种语言都认）：页面上有附件卡片时就不再显示这句。 */
export function isUploadNote(body: string, name: string): boolean {
  return body === translate('zh', UPLOAD_NOTE, { name }) || body === translate('en', UPLOAD_NOTE, { name })
}
