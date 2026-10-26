/**
 * 五段式 cron（分 时 日 月 周）：按用户的时区求值。支持 *、单个值、a-b 范围、*\/n 和 a-b/n 步长、逗号列表；
 * 周日写 0 或 7。日和周都不是 * 时，满足任一即可（和 Vixie cron 一致）。
 */

import { wallClock, zonedTime } from './time.ts'

interface Field {
  readonly values: ReadonlySet<number>
  readonly star: boolean
}

export interface CronSchedule {
  readonly minute: Field
  readonly hour: Field
  readonly day: Field
  readonly month: Field
  readonly weekday: Field
  readonly source: string
}

const RANGES: readonly (readonly [number, number])[] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
]

const NAMES = ['分', '时', '日', '月', '周']

function parseField(text: string, index: number): Field | string {
  const [min, max] = RANGES[index] ?? [0, 0]
  const values = new Set<number>()
  for (const part of text.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (!Number.isInteger(step) || step < 1) return `${NAMES[index]}字段的步长不对：${part}`
    let start = min
    let end = max
    if (rangePart !== '*' && rangePart !== undefined) {
      const [from, to] = rangePart.split('-')
      start = Number(from)
      end = to === undefined ? (stepPart === undefined ? start : max) : Number(to)
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
        return `${NAMES[index]}字段超出范围：${part}`
      }
    }
    for (let value = start; value <= end; value += step) values.add(index === 4 && value === 7 ? 0 : value)
  }
  return { values, star: text.startsWith('*') }
}

/** 解析 cron 表达式；格式不对时返回说明文字。 */
export function parseCron(expression: string): CronSchedule | string {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return 'cron 要写五段：分 时 日 月 周'
  const fields: Field[] = []
  for (const [index, part] of parts.entries()) {
    const field = parseField(part, index)
    if (typeof field === 'string') return field
    fields.push(field)
  }
  const [minute, hour, day, month, weekday] = fields as [Field, Field, Field, Field, Field]
  return { minute, hour, day, month, weekday, source: parts.join(' ') }
}

function dayMatches(schedule: CronSchedule, day: number, weekday: number): boolean {
  const isoToCron = weekday % 7
  const dayOk = schedule.day.values.has(day)
  const weekOk = schedule.weekday.values.has(isoToCron)
  if (schedule.day.star || schedule.weekday.star) return dayOk && weekOk
  return dayOk || weekOk
}

/**
 * 下一次运行的时刻（严格晚于 after）。按天跳、在匹配的日子里按分钟找，最多看两年。
 * 夏令时缺口里不存在的时间跳过。
 */
export function nextCronRun(schedule: CronSchedule, after: number, timeZone: string): number | undefined {
  const start = wallClock(after + 60_000, timeZone)
  let cursor = { year: start.year, month: start.month, day: start.day }
  const firstDay = { ...cursor }
  for (let days = 0; days < 366 * 2; days += 1) {
    const noon = zonedTime({ ...cursor, hour: 12, minute: 0 }, timeZone)
    const clock = wallClock(noon, timeZone)
    if (schedule.month.values.has(clock.month) && dayMatches(schedule, clock.day, clock.weekday)) {
      const sameDay = cursor.year === firstDay.year && cursor.month === firstDay.month && cursor.day === firstDay.day
      for (const hour of [...schedule.hour.values].sort((left, right) => left - right)) {
        if (sameDay && hour < start.hour) continue
        for (const minute of [...schedule.minute.values].sort((left, right) => left - right)) {
          if (sameDay && hour === start.hour && minute < start.minute) continue
          const time = zonedTime({ ...cursor, hour, minute }, timeZone)
          const check = wallClock(time, timeZone)
          if (check.hour !== hour || check.minute !== minute) continue
          if (time > after) return time
        }
      }
    }
    const next = wallClock(noon + 24 * 3_600_000, timeZone)
    cursor = { year: next.year, month: next.month, day: next.day }
  }
  return undefined
}

/** 常用的说法转成 cron：每天 HH:MM、每周几 HH:MM、每 N 分钟。 */
export function dailyCron(time: string): string {
  const [hour, minute] = time.split(':').map(Number)
  return `${minute ?? 0} ${hour ?? 0} * * *`
}

export function weeklyCron(time: string, weekdays: readonly number[]): string {
  const [hour, minute] = time.split(':').map(Number)
  return `${minute ?? 0} ${hour ?? 0} * * ${weekdays.map((day) => day % 7).join(',')}`
}

/** 定时例程最短多久跑一次：每次都要调用模型。 */
export const EVERY_MIN_MINUTES = 5

/**
 * 每隔 N 分钟换成 cron，从整点算起：能整除一小时的（5、10、15、20、30 分钟）按分钟走，
 * 整小时且能整除一天的（1、2、3、4、6、8、12、24 小时）按小时走。别的间隔返回 undefined。
 */
export function everyCron(minutes: number): string | undefined {
  if (!Number.isInteger(minutes) || minutes < EVERY_MIN_MINUTES) return undefined
  if (minutes < 60) return 60 % minutes === 0 ? `*/${minutes} * * * *` : undefined
  if (minutes % 60 !== 0) return undefined
  const hours = minutes / 60
  if (hours === 1) return '0 * * * *'
  if (hours === 24) return '0 0 * * *'
  return 24 % hours === 0 ? `0 */${hours} * * *` : undefined
}

/** 每隔几分钟、几小时的 cron 的说法；不是这种写法返回 undefined。 */
function describeEvery(source: string): string | undefined {
  const minutes = /^\*\/(\d+) \* \* \* \*$/.exec(source)
  if (minutes !== null) return `每 ${minutes[1]} 分钟`
  const hours = /^(\d+) \*\/(\d+) \* \* \*$/.exec(source)
  if (hours !== null) return `每 ${hours[2]} 小时${hours[1] === '0' ? '' : `（第 ${hours[1]} 分）`}`
  const hourly = /^(\d+) \* \* \* \*$/.exec(source)
  if (hourly !== null) return hourly[1] === '0' ? '每小时' : `每小时第 ${hourly[1]} 分`
  return undefined
}

/** cron 的中文说明，给例程列表显示。 */
export function describeCron(expression: string): string {
  const schedule = parseCron(expression)
  if (typeof schedule === 'string') return expression
  const every = describeEvery(schedule.source)
  if (every !== undefined) return every
  const minutes = [...schedule.minute.values]
  const hours = [...schedule.hour.values]
  const time = minutes.length === 1 && hours.length === 1 ? `${String(hours[0]).padStart(2, '0')}:${String(minutes[0]).padStart(2, '0')}` : undefined
  if (time !== undefined && schedule.day.star && schedule.month.star && schedule.weekday.star) return `每天 ${time}`
  if (time !== undefined && schedule.day.star && schedule.month.star && !schedule.weekday.star) {
    const names = ['日', '一', '二', '三', '四', '五', '六']
    return `每周${[...schedule.weekday.values].map((day) => names[day] ?? '').join('、')} ${time}`
  }
  return `cron：${schedule.source}`
}
