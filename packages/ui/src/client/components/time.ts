import { intlLocale, t } from 'pod-domain'

/**
 * 界面上显示的时刻都从这里出，按浏览器的时区：今天的只写几点几分（14:05）；别的天带上日期，
 * 今年的写「11月8日 14:05」，不是今年的写「2025年11月8日 14:05」（英文是 Nov 8 14:05、Nov 8, 2025 14:05）。
 * 「3 分钟前」这类相对时间见 common.tsx 的 RelativeTime，对话里居中的日子见 chat/bubbles.ts。
 */

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 几点几分，24 小时制：14:05。 */
export function clock(time: number): string {
  const date = new Date(time)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 那一天零点的时刻。 */
export function startOfDay(time: number): number {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** 两个时刻在不在同一天。 */
export function sameDay(time: number, other: number): boolean {
  return startOfDay(time) === startOfDay(other)
}

/** 日期：今年的写「11月8日」（Nov 8），不是今年的带上年份「2025年11月8日」（Nov 8, 2025）。 */
function dateOf(time: number, now: number): string {
  const date = new Date(time)
  const year = date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric'
  return date.toLocaleDateString(intlLocale(), { year, month: 'short', day: 'numeric' })
}

export interface TimeTextOptions {
  /** 拿来比是不是今天的“现在”，默认取调用时；跟着 useNow 刷新的地方传进来，过了零点跟着变。 */
  readonly now?: number
  /** 侧栏这类窄的地方：不是今天的只写日期。 */
  readonly short?: boolean
  /** 带不带日期，默认不是今天的才带；动态这类一行行往下排的，和上一行不是同一天才带。 */
  readonly date?: boolean
}

/** 显示一个时刻：今天的写「14:05」，别的天写「11月8日 14:05」「2025年11月8日 14:05」；short 时不是今天的只写日期。 */
export function timeText(time: number, options: TimeTextOptions = {}): string {
  const now = options.now ?? Date.now()
  if (!(options.date ?? !sameDay(time, now))) return clock(time)
  const date = dateOf(time, now)
  return options.short === true ? date : t('{date} {time}', { date, time: clock(time) })
}
