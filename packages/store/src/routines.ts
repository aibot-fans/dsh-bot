import type { DatabaseSync } from 'node:sqlite'
import type { NotificationKind, PodNotification, Routine, RoutineKind } from 'pod-domain'
import { flag } from './json.ts'

interface RoutineRow {
  readonly id: string
  readonly title: string
  readonly kind: string
  readonly cron: string
  readonly timezone: string
  readonly prompt: string
  readonly bot_id: string
  readonly room_id: string | null
  readonly page_id: string | null
  readonly url: string
  readonly selector: string
  readonly interval_minutes: number
  readonly fingerprint: string
  readonly last_text: string
  readonly catch_up: number
  readonly off_peak: number
  readonly enabled: number
  readonly last_run_at: number | null
  readonly next_run_at: number | null
  readonly last_status: string
  readonly created_by: string
  readonly created_at: number
  readonly updated_at: number
}

function toRoutine(row: RoutineRow): Routine {
  return {
    id: row.id,
    title: row.title,
    kind: (row.kind === 'watch' ? 'watch' : 'cron') as RoutineKind,
    cron: row.cron,
    timezone: row.timezone,
    prompt: row.prompt,
    botId: row.bot_id,
    roomId: row.room_id,
    pageId: row.page_id,
    url: row.url,
    selector: row.selector,
    intervalMinutes: row.interval_minutes,
    fingerprint: row.fingerprint,
    lastText: row.last_text,
    catchUp: flag(row.catch_up),
    offPeak: flag(row.off_peak),
    enabled: flag(row.enabled),
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastStatus: row.last_status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listRoutines(db: DatabaseSync): readonly Routine[] {
  const rows = db.prepare('SELECT * FROM routines WHERE deleted_at IS NULL ORDER BY created_at').all() as unknown as readonly RoutineRow[]
  return rows.map(toRoutine)
}

export function getRoutine(db: DatabaseSync, id: string): Routine | undefined {
  const row = db.prepare('SELECT * FROM routines WHERE id = ? AND deleted_at IS NULL').get(id) as RoutineRow | undefined
  return row === undefined ? undefined : toRoutine(row)
}

export function dueRoutines(db: DatabaseSync, now: number): readonly Routine[] {
  const rows = db
    .prepare('SELECT * FROM routines WHERE deleted_at IS NULL AND enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at')
    .all(now) as unknown as readonly RoutineRow[]
  return rows.map(toRoutine)
}

export type NewRoutine = Omit<Routine, 'fingerprint' | 'lastText' | 'lastRunAt' | 'lastStatus' | 'createdAt' | 'updatedAt'> & { readonly now: number }

export function insertRoutine(db: DatabaseSync, input: NewRoutine): Routine {
  db.prepare(
    `INSERT INTO routines (id, title, kind, cron, timezone, prompt, bot_id, room_id, page_id, url, selector, interval_minutes, catch_up, off_peak,
       enabled, next_run_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.title,
    input.kind,
    input.cron,
    input.timezone,
    input.prompt,
    input.botId,
    input.roomId,
    input.pageId,
    input.url,
    input.selector,
    input.intervalMinutes,
    input.catchUp ? 1 : 0,
    input.offPeak ? 1 : 0,
    input.enabled ? 1 : 0,
    input.nextRunAt,
    input.createdBy,
    input.now,
    input.now,
  )
  const routine = getRoutine(db, input.id)
  if (routine === undefined) throw new Error(`新建例程 ${input.id} 后读不回来`)
  return routine
}

export interface RoutinePatch {
  readonly title?: string
  readonly cron?: string
  readonly timezone?: string
  readonly prompt?: string
  readonly botId?: string
  readonly roomId?: string | null
  readonly pageId?: string | null
  readonly url?: string
  readonly selector?: string
  readonly intervalMinutes?: number
  readonly fingerprint?: string
  readonly lastText?: string
  readonly catchUp?: boolean
  readonly offPeak?: boolean
  readonly enabled?: boolean
  readonly lastRunAt?: number | null
  readonly nextRunAt?: number | null
  readonly lastStatus?: string
}

export function updateRoutine(db: DatabaseSync, id: string, patch: RoutinePatch, now: number): Routine | undefined {
  const current = getRoutine(db, id)
  if (current === undefined) return undefined
  const next = { ...current, ...patch }
  db.prepare(
    `UPDATE routines SET title = ?, cron = ?, timezone = ?, prompt = ?, bot_id = ?, room_id = ?, page_id = ?, url = ?, selector = ?, interval_minutes = ?,
       fingerprint = ?, last_text = ?, catch_up = ?, off_peak = ?, enabled = ?, last_run_at = ?, next_run_at = ?, last_status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    next.title,
    next.cron,
    next.timezone,
    next.prompt,
    next.botId,
    next.roomId,
    next.pageId,
    next.url,
    next.selector,
    next.intervalMinutes,
    next.fingerprint,
    next.lastText,
    next.catchUp ? 1 : 0,
    next.offPeak ? 1 : 0,
    next.enabled ? 1 : 0,
    next.lastRunAt,
    next.nextRunAt,
    next.lastStatus,
    now,
    id,
  )
  return getRoutine(db, id)
}

export function deleteRoutine(db: DatabaseSync, id: string, now: number): boolean {
  const result = db.prepare('UPDATE routines SET deleted_at = ?, enabled = 0 WHERE id = ? AND deleted_at IS NULL').run(now, id)
  return Number(result.changes) > 0
}

// ---------- 通知 ----------

interface NotificationRow {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly body: string
  readonly room_id: string | null
  readonly task_id: string | null
  readonly wait_id: string | null
  readonly silent: number
  readonly read: number
  readonly created_at: number
}

function toNotification(row: NotificationRow): PodNotification {
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    title: row.title,
    body: row.body,
    roomId: row.room_id,
    taskId: row.task_id,
    waitId: row.wait_id,
    silent: flag(row.silent),
    read: flag(row.read),
    createdAt: row.created_at,
  }
}

export function insertNotification(db: DatabaseSync, notification: Omit<PodNotification, 'read'>): PodNotification {
  db.prepare(
    'INSERT INTO notifications (id, kind, title, body, room_id, task_id, wait_id, silent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    notification.id,
    notification.kind,
    notification.title,
    notification.body,
    notification.roomId,
    notification.taskId,
    notification.waitId,
    notification.silent ? 1 : 0,
    notification.createdAt,
  )
  return { ...notification, read: false }
}

export function listNotifications(db: DatabaseSync, limit: number): readonly PodNotification[] {
  const rows = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?').all(limit) as unknown as readonly NotificationRow[]
  return rows.map(toNotification)
}

export function unreadNotifications(db: DatabaseSync): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE read = 0').get() as { readonly count: number }).count
}

export function markNotificationsRead(db: DatabaseSync, ids: readonly string[] | 'all'): void {
  if (ids === 'all') {
    db.exec('UPDATE notifications SET read = 1 WHERE read = 0')
    return
  }
  const statement = db.prepare('UPDATE notifications SET read = 1 WHERE id = ?')
  for (const id of ids) statement.run(id)
}

/** 同一个任务短时间内的多件事合并成一条：找最近一条同类、同任务的未读通知。 */
export function recentNotification(db: DatabaseSync, kind: NotificationKind, taskId: string | null, since: number): PodNotification | undefined {
  const row = db
    .prepare('SELECT * FROM notifications WHERE kind = ? AND task_id IS ? AND read = 0 AND created_at >= ? ORDER BY created_at DESC LIMIT 1')
    .get(kind, taskId, since) as NotificationRow | undefined
  return row === undefined ? undefined : toNotification(row)
}

export function bumpNotification(db: DatabaseSync, id: string, body: string, now: number): void {
  db.prepare('UPDATE notifications SET body = ?, created_at = ? WHERE id = ?').run(body, now, id)
}
