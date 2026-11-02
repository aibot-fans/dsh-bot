import type { DatabaseSync } from 'node:sqlite'
import { readTriggerSpec, type Trigger, type TriggerSpec } from 'pod-domain'

interface TriggerRow {
  readonly id: string
  readonly task_id: string
  readonly spec: string
  readonly timezone: string
  readonly note: string
  readonly next_at: number | null
  readonly last_at: number | null
  readonly enabled: number
  readonly closed_at: number | null
  readonly state: string
  readonly created_by: string
  readonly created_at: number
  readonly updated_at: number
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function toTrigger(row: TriggerRow): Trigger | undefined {
  const spec = readTriggerSpec(parse(row.spec))
  if (spec === undefined) return undefined
  const state = parse(row.state)
  return {
    id: row.id,
    taskId: row.task_id,
    spec,
    timezone: row.timezone,
    note: row.note,
    nextAt: row.next_at,
    lastAt: row.last_at,
    enabled: row.enabled === 1,
    closedAt: row.closed_at,
    state: typeof state === 'object' && state !== null && !Array.isArray(state) ? (state as Readonly<Record<string, unknown>>) : {},
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toTriggers(rows: readonly TriggerRow[]): readonly Trigger[] {
  return rows.flatMap((row) => {
    const trigger = toTrigger(row)
    return trigger === undefined ? [] : [trigger]
  })
}

export interface NewTrigger {
  readonly id: string
  readonly taskId: string
  readonly spec: TriggerSpec
  readonly timezone: string
  readonly note: string
  readonly nextAt: number | null
  readonly lastAt?: number | null
  readonly enabled?: boolean
  readonly state: Readonly<Record<string, unknown>>
  readonly createdBy: string
  readonly now: number
}

export function insertTrigger(db: DatabaseSync, input: NewTrigger): Trigger {
  db.prepare(
    `INSERT INTO triggers (id, task_id, spec, timezone, note, next_at, last_at, enabled, state, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.taskId,
    JSON.stringify(input.spec),
    input.timezone,
    input.note,
    input.nextAt,
    input.lastAt ?? null,
    input.enabled === false ? 0 : 1,
    JSON.stringify(input.state),
    input.createdBy,
    input.now,
    input.now,
  )
  const created = getTrigger(db, input.id)
  if (created === undefined) throw new Error(`trigger ${input.id} not written`)
  return created
}

export function getTrigger(db: DatabaseSync, id: string): Trigger | undefined {
  const row = db.prepare('SELECT * FROM triggers WHERE id = ?').get(id) as TriggerRow | undefined
  return row === undefined ? undefined : toTrigger(row)
}

/** 任务上还挂着的触发器（暂停的也在），先建的在前。 */
export function openTriggersOf(db: DatabaseSync, taskId: string): readonly Trigger[] {
  return toTriggers(db.prepare('SELECT * FROM triggers WHERE task_id = ? AND closed_at IS NULL ORDER BY created_at').all(taskId) as unknown as readonly TriggerRow[])
}

/** 任务上的触发器，关掉的也算（任务页看历史），最近的在前。 */
export function triggersOf(db: DatabaseSync, taskId: string, limit = 20): readonly Trigger[] {
  return toTriggers(db.prepare('SELECT * FROM triggers WHERE task_id = ? ORDER BY closed_at IS NOT NULL, created_at DESC LIMIT ?').all(taskId, limit) as unknown as readonly TriggerRow[])
}

/** 到点了的：开着、没关、下次时间不晚于 now。 */
export function dueTriggers(db: DatabaseSync, now: number): readonly Trigger[] {
  return toTriggers(
    db.prepare('SELECT * FROM triggers WHERE enabled = 1 AND closed_at IS NULL AND next_at IS NOT NULL AND next_at <= ? ORDER BY next_at').all(now) as unknown as readonly TriggerRow[],
  )
}

/** 等某个任务就绪或结束的触发器。 */
export function triggersWatching(db: DatabaseSync, taskId: string): readonly Trigger[] {
  return toTriggers(
    db
      .prepare("SELECT * FROM triggers WHERE enabled = 1 AND closed_at IS NULL AND json_extract(spec, '$.kind') = 'task' AND json_extract(spec, '$.taskId') = ?")
      .all(taskId) as unknown as readonly TriggerRow[],
  )
}

/** 开着的任务里，挂着某种来源触发器的（例程、每日简报）。 */
export function triggersBySource(db: DatabaseSync, source: string): readonly Trigger[] {
  return toTriggers(
    db
      .prepare(
        `SELECT g.* FROM triggers g JOIN tasks t ON t.id = g.task_id
         WHERE g.closed_at IS NULL AND json_extract(g.state, '$.source') = ? AND t.ended_at IS NULL AND t.deleted_at IS NULL
         ORDER BY g.created_at`,
      )
      .all(source) as unknown as readonly TriggerRow[],
  )
}

export function countOpenTriggers(db: DatabaseSync, taskId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM triggers WHERE task_id = ? AND closed_at IS NULL').get(taskId) as { readonly n: number } | undefined
  return row?.n ?? 0
}

export interface TriggerPatch {
  readonly spec?: TriggerSpec
  readonly timezone?: string
  readonly note?: string
  readonly nextAt?: number | null
  readonly lastAt?: number | null
  readonly enabled?: boolean
  readonly closedAt?: number | null
  readonly state?: Readonly<Record<string, unknown>>
}

const COLUMNS: Readonly<Record<keyof TriggerPatch, string>> = {
  spec: 'spec',
  timezone: 'timezone',
  note: 'note',
  nextAt: 'next_at',
  lastAt: 'last_at',
  enabled: 'enabled',
  closedAt: 'closed_at',
  state: 'state',
}

function columnValue(key: keyof TriggerPatch, value: unknown): string | number | null {
  if (key === 'spec' || key === 'state') return JSON.stringify(value)
  if (key === 'enabled') return value === true ? 1 : 0
  return value as string | number | null
}

export function updateTrigger(db: DatabaseSync, id: string, patch: TriggerPatch, now: number): Trigger | undefined {
  const keys = (Object.keys(patch) as (keyof TriggerPatch)[]).filter((key) => patch[key] !== undefined)
  if (keys.length > 0) {
    const sets = keys.map((key) => `${COLUMNS[key]} = ?`).join(', ')
    db.prepare(`UPDATE triggers SET ${sets}, updated_at = ? WHERE id = ?`).run(...keys.map((key) => columnValue(key, patch[key])), now, id)
  }
  return getTrigger(db, id)
}

/** 任务结束：它的触发器一起关掉。返回关了几个。 */
export function closeTriggersOf(db: DatabaseSync, taskId: string, now: number): number {
  const result = db.prepare('UPDATE triggers SET closed_at = ?, next_at = NULL, updated_at = ? WHERE task_id = ? AND closed_at IS NULL').run(now, now, taskId)
  return Number(result.changes)
}

/** 常开任务：挂着会一直触发下去的触发器（cron、盯网页）。就绪、无需处理都不结束它，等下次到点。 */
export function isStanding(db: DatabaseSync, taskId: string): boolean {
  const row = db
    .prepare("SELECT 1 AS found FROM triggers WHERE task_id = ? AND closed_at IS NULL AND json_extract(spec, '$.kind') IN ('cron', 'page') LIMIT 1")
    .get(taskId)
  return row !== undefined
}
