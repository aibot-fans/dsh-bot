import type { DatabaseSync } from 'node:sqlite'
import { costOf, wallClock, zonedTime } from 'pod-domain'
import { usageRowsSince } from 'pod-store'

/** 用量页的时间范围：今天按小时看，最近 7 天、30 天按天看。 */
export type UsageRange = 'today' | '7d' | '30d'

export const USAGE_RANGES: readonly UsageRange[] = ['today', '7d', '30d']

export interface UsageBucket {
  /** 今天是“14”（点钟），按天是“10/23”。 */
  readonly label: string
  readonly start: number
  readonly cost: number
  readonly tokens: number
}

export interface UsageShare {
  /** bot 或对话的 id；null 表示后台的轻量调用（记忆、交接笔记、复盘），或者不属于任何对话。 */
  readonly id: string | null
  readonly cost: number
  readonly tokens: number
}

export interface UsageReport {
  readonly range: UsageRange
  readonly since: number
  readonly cost: number
  readonly tokens: number
  /** 输入里命中缓存的比例，0–1。 */
  readonly cacheHit: number
  /** 闲时运行比放在高峰时段省下的钱。 */
  readonly saved: number
  readonly series: readonly UsageBucket[]
  readonly byBot: readonly UsageShare[]
  readonly byRoom: readonly UsageShare[]
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

function startOfDay(time: number, timeZone: string): number {
  const clock = wallClock(time, timeZone)
  return zonedTime({ year: clock.year, month: clock.month, day: clock.day, hour: 0, minute: 0 }, timeZone)
}

/** 时间桶：今天 24 个小时；按天时取每天的中午再找当天零点，夏令时也不会错位。 */
function bucketsOf(range: UsageRange, now: number, timeZone: string): readonly { readonly label: string; readonly start: number }[] {
  const today = startOfDay(now, timeZone)
  if (range === 'today') return Array.from({ length: 24 }, (_, hour) => ({ label: String(hour), start: today + hour * HOUR }))
  const days = range === '7d' ? 7 : 30
  return Array.from({ length: days }, (_, index) => {
    const start = startOfDay(today + 12 * HOUR - (days - 1 - index) * DAY, timeZone)
    const clock = wallClock(start, timeZone)
    return { label: `${clock.month}/${clock.day}`, start }
  })
}

function share(map: ReadonlyMap<string | null, { readonly cost: number; readonly tokens: number }>): readonly UsageShare[] {
  return [...map.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .sort((left, right) => right.cost - left.cost || right.tokens - left.tokens)
}

function add(
  map: Map<string | null, { readonly cost: number; readonly tokens: number }>,
  key: string | null,
  cost: number,
  tokens: number,
): void {
  const current = map.get(key) ?? { cost: 0, tokens: 0 }
  map.set(key, { cost: current.cost + cost, tokens: current.tokens + tokens })
}

/** 只看一部分用量：某个对话（群聊或单聊）里的，或者某个 bot 做事用的（后台的轻量调用不算）。 */
export interface UsageFilter {
  readonly roomId?: string
  readonly botId?: string
}

/** 一段时间的用量：总数、缓存命中、闲时省下的钱、按时间的走势，以及按 bot 和按对话的分布。 */
export function usageReport(db: DatabaseSync, range: UsageRange, now: number, timeZone: string, filter: UsageFilter = {}): UsageReport {
  const buckets = bucketsOf(range, now, timeZone)
  const since = buckets[0]?.start ?? now
  const rows = usageRowsSince(db, since).filter(
    (row) => (filter.roomId === undefined || row.roomId === filter.roomId) && (filter.botId === undefined || (row.botId === filter.botId && row.sessionId !== null)),
  )
  const series = buckets.map((bucket) => ({ ...bucket, cost: 0, tokens: 0 }))
  const byBot = new Map<string | null, { readonly cost: number; readonly tokens: number }>()
  const byRoom = new Map<string | null, { readonly cost: number; readonly tokens: number }>()
  let cost = 0
  let tokens = 0
  let input = 0
  let cached = 0
  let saved = 0
  for (const row of rows) {
    const rowTokens = row.inputTokens + row.outputTokens
    cost += row.cost
    tokens += rowTokens
    input += row.inputTokens
    cached += Math.min(row.cacheTokens, row.inputTokens)
    if (!row.peak) {
      const atPeak = costOf(row.provider, row.model, { inputTokens: row.inputTokens, outputTokens: row.outputTokens, cacheReadTokens: row.cacheTokens }, true)
      if (atPeak !== undefined) saved += Math.max(0, atPeak - row.cost)
    }
    const index = series.findLastIndex((bucket) => bucket.start <= row.createdAt)
    const bucket = series[index]
    if (bucket !== undefined) series[index] = { ...bucket, cost: bucket.cost + row.cost, tokens: bucket.tokens + rowTokens }
    add(byBot, row.sessionId === null ? null : row.botId, row.cost, rowTokens)
    add(byRoom, row.roomId, row.cost, rowTokens)
  }
  return {
    range,
    since,
    cost,
    tokens,
    cacheHit: input === 0 ? 0 : cached / input,
    saved,
    series,
    byBot: share(byBot),
    byRoom: share(byRoom),
  }
}
