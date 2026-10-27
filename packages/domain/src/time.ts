import { intlLocale, t } from './i18n.ts'
/** 时区和钟表时间：例程、勿扰、错峰都按用户的时区算。只用 Intl，不依赖第三方库。 */

export interface WallClock {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  /** ISO 星期：周一 1 … 周日 7。 */
  readonly weekday: number
}

const WEEKDAYS: Readonly<Record<string, number>> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached !== undefined) return cached
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  })
  formatters.set(timeZone, created)
  return created
}

/** 某个时刻在指定时区的钟表时间。 */
export function wallClock(time: number, timeZone: string): WallClock {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(time)).map((part) => [part.type, part.value]))
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday ?? 'Mon'] ?? 1,
  }
}

/** 该时区相对 UTC 的偏移（毫秒），在给定时刻。 */
function offsetAt(time: number, timeZone: string): number {
  const clock = wallClock(time, timeZone)
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute)
  const truncated = time - (time % 60_000)
  return asUtc - truncated
}

/**
 * 把某时区的钟表时间换成时刻。夏令时缺口里的时间往后顺延，重叠时取较早的那次。
 * @returns 毫秒时间戳。
 */
export function zonedTime(clock: Omit<WallClock, 'weekday'>, timeZone: string): number {
  const guess = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute)
  const first = guess - offsetAt(guess, timeZone)
  const second = guess - offsetAt(first, timeZone)
  return Math.min(first, second)
}

export function parseClock(value: string): { readonly hour: number; readonly minute: number } {
  const [hour, minute] = value.split(':').map(Number)
  return { hour: hour ?? 0, minute: minute ?? 0 }
}

function minutesOf(clock: { readonly hour: number; readonly minute: number }): number {
  return clock.hour * 60 + clock.minute
}

/** 现在是否落在 [start, end) 这个每天重复的时段里；跨午夜的时段（23:00–08:00）也算对。 */
export function inDailyRange(time: number, timeZone: string, start: string, end: string): boolean {
  const now = minutesOf(wallClock(time, timeZone))
  const from = minutesOf(parseClock(start))
  const to = minutesOf(parseClock(end))
  if (from === to) return false
  return from < to ? now >= from && now < to : now >= from || now < to
}

/** DeepSeek 的高峰时段：北京时间工作日 09:00–12:00 和 14:00–18:00。 */
export function isDeepSeekPeak(time: number): boolean {
  const clock = wallClock(time, 'Asia/Shanghai')
  if (clock.weekday > 5) return false
  const minutes = minutesOf(clock)
  return (minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080)
}

/** 从 time 起下一个非高峰的时刻（按分钟推进，最多看一周）。 */
export function nextOffPeak(time: number): number {
  let cursor = time
  for (let step = 0; step < 7 * 24 * 60 && isDeepSeekPeak(cursor); step += 1) cursor += 60_000
  return cursor
}

/** 下一次到达某个每天的钟表时间的时刻（严格晚于 time）。 */
export function nextDailyAt(time: number, timeZone: string, at: string): number {
  const { hour, minute } = parseClock(at)
  const today = wallClock(time, timeZone)
  const candidate = zonedTime({ year: today.year, month: today.month, day: today.day, hour, minute }, timeZone)
  if (candidate > time) return candidate
  const tomorrow = wallClock(time + 24 * 3_600_000, timeZone)
  return zonedTime({ year: tomorrow.year, month: tomorrow.month, day: tomorrow.day, hour, minute }, timeZone)
}

const LOCAL_TIME = /^(?:(\d{4})-(\d{1,2})-(\d{1,2})[ T])?([01]?\d|2[0-3]):([0-5]\d)$/

/**
 * 用户写的时间换成时刻，按 timeZone：「HH:MM」是下一次到这个钟点（今天过了就是明天），「YYYY-MM-DD HH:MM」是那一天的那个钟点。
 * 写法不对或者没有这一天时返回说明。
 */
export function parseLocalTime(value: string, timeZone: string, now: number): number | string {
  const match = LOCAL_TIME.exec(value.trim())
  if (match === null) return t('时间写成 HH:MM 或 YYYY-MM-DD HH:MM')
  const [, year, month, day, hour = '0', minute = '0'] = match
  if (year === undefined || month === undefined || day === undefined) return nextDailyAt(now, timeZone, `${hour}:${minute}`)
  const clock = { year: Number(year), month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute) }
  const time = zonedTime(clock, timeZone)
  const check = wallClock(time, timeZone)
  return check.year === clock.year && check.month === clock.month && check.day === clock.day ? time : t('没有这一天：{value}', { value: value.trim() })
}

/** 时刻写成用户时区的「10月26日 11:30」。 */
export function formatLocal(time: number, timeZone: string): string {
  const clock = wallClock(time, timeZone)
  const day = new Date(time).toLocaleDateString(intlLocale(), { timeZone, month: 'short', day: 'numeric' })
  return `${day} ${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`
}

/** 某时刻所在的本地日期，写成 YYYY-MM-DD。 */
export function localDate(time: number, timeZone: string): string {
  const clock = wallClock(time, timeZone)
  return `${clock.year}-${String(clock.month).padStart(2, '0')}-${String(clock.day).padStart(2, '0')}`
}
