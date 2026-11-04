import { OWNER, intlLocale, t, type RoomMessage } from 'pod-domain'
import { clock } from '../../components/common.tsx'

/** 和上一条隔了这么久，中间才写一次时间。 */
const STAMP_GAP_MS = 3 * 60_000

/** 画成气泡的是哪一边：你的在右边，bot 的在左边。 */
export type BubbleSide = 'owner' | 'bot'

/** 一条消息在时间线上怎么摆：前面居中写不写时间，是不是一组的第一条（写名字）、最后一条（带尾巴和头像）。 */
export interface BubbleLayout {
  readonly stamp: string | null
  readonly first: boolean
  readonly last: boolean
}

/** 画成气泡的消息在哪一边；提示行、分隔线、任务卡、页面卡片这些不是气泡。任务群里派活的那句话算组长说的话。 */
export function bubbleSide(message: RoomMessage, quiet: boolean): BubbleSide | undefined {
  switch (message.kind) {
    case 'notice':
    case 'folded':
    case 'weekly':
    case 'page':
      return undefined
    case 'task-card':
      return quiet && typeof message.data.parentId === 'string' ? 'bot' : undefined
    default:
      return message.author === OWNER ? 'owner' : 'bot'
  }
}

export function startOfDay(time: number): number {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** 日子：今天、昨天，再早的写几月几日周几（跨年带年份）。 */
export function dayLabel(time: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(time)) / 86_400_000)
  if (days === 0) return t('今天')
  if (days === 1) return t('昨天')
  const date = new Date(time)
  const year = date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric'
  return date.toLocaleDateString(intlLocale(), { year, month: 'long', day: 'numeric', weekday: 'short' })
}

/** 鼠标停在气泡上时显示的具体时间。 */
export function fullTime(time: number): string {
  return new Date(time).toLocaleString(intlLocale(), { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

/** 居中的时间：一天里第一条写“今天 10:02”，之后隔了一段时间才写一次“10:05”。 */
function stampOf(message: RoomMessage, previous: RoomMessage | undefined, now: number): string | null {
  if (previous === undefined || startOfDay(previous.createdAt) !== startOfDay(message.createdAt)) {
    return t('{day} {clock}', { day: dayLabel(message.createdAt, now), clock: clock(message.createdAt) })
  }
  return message.createdAt - previous.createdAt >= STAMP_GAP_MS ? clock(message.createdAt) : null
}

/**
 * 排好的消息怎么摆：同一个人连着说、中间没隔出时间、后一条上面也没有引用的，算一组。
 * 一组只在第一条上面写名字，只给最后一条尾巴和头像（头像和这一条的底边对齐）。
 */
export function layoutOf(messages: readonly RoomMessage[], quoted: (message: RoomMessage) => boolean, quiet: boolean, now: number): ReadonlyMap<string, BubbleLayout> {
  const stamps = messages.map((message, index) => stampOf(message, messages[index - 1], now))
  const joinsPrevious = (index: number): boolean => {
    const message = messages[index]
    const previous = messages[index - 1]
    if (message === undefined || previous === undefined || stamps[index] !== null || quoted(message)) return false
    const side = bubbleSide(message, quiet)
    return side !== undefined && side === bubbleSide(previous, quiet) && message.author === previous.author
  }
  return new Map(messages.map((message, index): [string, BubbleLayout] => [message.id, { stamp: stamps[index] ?? null, first: !joinsPrevious(index), last: !joinsPrevious(index + 1) }]))
}

/**
 * 气泡上面要不要写回的是哪句。你点“回复”引的：原话不在紧上面（中间隔了别人的话）就写。
 * bot 回的：回的是那个人最近说的一句（比如你刚说的，中间只隔着别的 bot 的话），看得出来，不写；
 * 那个人后来又说了话、分不清回的是哪句时才写。
 */
export function needsReplyRef(messages: readonly RoomMessage[], index: number): boolean {
  const message = messages[index]
  if (message === undefined || message.replyTo === null) return false
  const before = messages.slice(0, index)
  if (message.author === OWNER) {
    const stop = before.findLast((previous) => previous.id === message.replyTo || previous.author !== message.author)
    return stop?.id !== message.replyTo
  }
  const target = before.find((previous) => previous.id === message.replyTo)
  if (target === undefined) return true
  return before.findLast((previous) => previous.author === target.author)?.id !== target.id
}
