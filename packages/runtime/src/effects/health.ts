import type { DatabaseSync } from 'node:sqlite'
import { listEffects, listProblems, type Problem } from 'pod-store'
import { FAILURES_BEFORE_PROBLEM } from './queue.ts'

export interface QueueHealth {
  readonly kind: string
  /** 排着几行。 */
  readonly waiting: number
  /** 其中连续失败到门槛的几行。 */
  readonly failing: number
  /** 最早一行登记的时间。 */
  readonly since: number | null
}

export interface HealthReport {
  /** 还没恢复的系统问题；没有就是空的，页面上不出现那一块。 */
  readonly problems: readonly Problem[]
  /** 最近恢复了的（看得到刚才出过什么事）。 */
  readonly recent: readonly Problem[]
  readonly queues: readonly QueueHealth[]
  /** dsh 有没有查重和落盘要用的接口；没有就退回不查重的投递。 */
  readonly exactlyOnce: boolean
}

/** 系统好不好：系统问题、副作用队列排着的和失败的。 */
export function healthReport(db: DatabaseSync, exactlyOnce: boolean, now: number): HealthReport {
  const rows = listEffects(db)
  const kinds = [...new Set(rows.map((row) => row.kind))]
  const queues = kinds.map((kind) => {
    const mine = rows.filter((row) => row.kind === kind)
    return {
      kind,
      waiting: mine.length,
      failing: mine.filter((row) => row.attempts >= FAILURES_BEFORE_PROBLEM).length,
      since: mine.reduce<number | null>((min, row) => (min === null || row.since < min ? row.since : min), null),
    }
  })
  const day = 86_400_000
  const recent = listProblems(db, { openOnly: false, limit: 20 }).filter((problem) => problem.resolvedAt !== null && problem.resolvedAt > now - day)
  return { problems: listProblems(db, { openOnly: true }), recent, queues, exactlyOnce }
}
