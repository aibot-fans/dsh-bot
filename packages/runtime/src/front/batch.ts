import { OWNER, POD, oneLine, truncate, type Room, type RoomMessage } from 'pod-domain'
import { CARD_LIMITS, clipCard } from '../core/cards.ts'

/** 新消息每条最多带多少字；截断的留 id，用 read 读全文。 */
export const BATCH_MESSAGE_LIMIT = CARD_LIMITS.message

/** 最近几条（上下文）每条最多多少字。 */
const RECENT_LIMIT = 160

/** 一批里的一条新消息：交给前台时附的说明（交还的原因、没读退回）放在 note。 */
export interface BatchItem {
  readonly message: RoomMessage
  readonly note: string
}

export interface BatchRoom {
  readonly room: Room
  /** 群里的成员（名字）；单聊是空的。 */
  readonly members: readonly string[]
  /** 这批新消息之前、前台还没看过的几条（包括 bot 说的）。 */
  readonly recent: readonly RoomMessage[]
  readonly items: readonly BatchItem[]
}

export interface BatchInput {
  readonly rooms: readonly BatchRoom[]
  /** 在忙的任务，每个一行。 */
  readonly tasks: readonly string[]
  /** 攒下的任务动静，每件一行。 */
  readonly activity: readonly string[]
  /** 较早的动静没列出来的条数。 */
  readonly omitted: number
  readonly speaker: (author: string) => string
  /** 被回复的那条（给一句它说了什么）。 */
  readonly quoted: (id: string) => RoomMessage | undefined
}

function roomHeader(group: BatchRoom): string {
  const { room } = group
  if (room.kind === 'direct') return `== 单聊「${room.title}」（${room.id}）==`
  const members = group.members.length === 0 ? '' : ` 成员：${group.members.join('、')}`
  if (room.taskId !== null) return `== 任务群「${room.title}」（${room.id}，任务 ${room.taskId}）${members} ==`
  return `== 群聊「${room.title}」（${room.id}）${members} ==`
}

/** 说的是哪个任务（结果、转告、确认这些话带着任务 id）。 */
function taskOf(message: RoomMessage): string {
  return typeof message.data.taskId === 'string' ? `，任务 ${message.data.taskId}` : ''
}

/** 你在等你卡片上点的答复：已经转给问的任务了，这里只是记录。 */
function answerOf(message: RoomMessage): string {
  return typeof message.data.answerOf === 'string' ? '，在卡片上答的，已转给任务' : ''
}

function recentLine(message: RoomMessage, speaker: (author: string) => string): string {
  if (message.kind === 'task-card') return `  [任务卡 ${String(message.data.taskId ?? '')}「${message.body}」] ${message.id}`
  return `  ${speaker(message.author)}（${message.id}${taskOf(message)}${answerOf(message)}）：${truncate(oneLine(message.body), RECENT_LIMIT)}`
}

function itemLine(item: BatchItem, input: BatchInput): string {
  const { message } = item
  const quoted = message.replyTo === null ? undefined : input.quoted(message.replyTo)
  const reply =
    message.replyTo === null
      ? ''
      : quoted === undefined
        ? `（回复 ${message.replyTo}）`
        : quoted.kind === 'task-card'
          ? `（回复任务卡 ${String(quoted.data.taskId ?? '')}「${quoted.body}」）`
          : `（回复 ${input.speaker(quoted.author)} 的 ${quoted.id}${taskOf(quoted)}：「${truncate(oneLine(quoted.body), 40)}」）`
  const note = item.note === '' ? '' : `\n  ${item.note}`
  return `- ${message.id} ${input.speaker(message.author)}${reply}：${clipCard(message.body, BATCH_MESSAGE_LIMIT, message.id)}${note}`
}

/** 送进前台的一批：开头是在忙的任务和攒下的动静，后面按聊天室分组，每组带最近几条和新消息。 */
export function batchText(input: BatchInput): string {
  const count = input.rooms.reduce((sum, room) => sum + room.items.length, 0)
  const head = `[新消息] ${input.rooms.length} 个聊天室，${count} 条。每条用 dispatch 记去向；对用户说话用 reply。`
  const tasks = input.tasks.length === 0 ? '在忙：没有开着的任务。' : `在忙：\n${input.tasks.join('\n')}`
  const activity =
    input.activity.length === 0 ? undefined : `任务动静（只看，不用处理）：\n${input.activity.join('\n')}${input.omitted > 0 ? `\n（更早的 ${input.omitted} 条没列出）` : ''}`
  const groups = input.rooms.map((group) =>
    [
      roomHeader(group),
      group.recent.length === 0 ? undefined : `最近：\n${group.recent.map((message) => recentLine(message, input.speaker)).join('\n')}`,
      `新消息：\n${group.items.map((item) => itemLine(item, input)).join('\n')}`,
    ]
      .filter((part): part is string => part !== undefined)
      .join('\n'),
  )
  return [head, tasks, activity, ...groups].filter((part): part is string => part !== undefined).join('\n\n')
}

/** 给前台看的说话人：你叫“用户”，dsh-bot 自己的话标出来，其余用名字。 */
export function speakerOf(author: string, name: (botId: string) => string | undefined): string {
  if (author === OWNER) return '用户'
  if (author === POD) return 'dsh-bot'
  return name(author) ?? 'bot'
}
