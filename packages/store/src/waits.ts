import type { DatabaseSync } from 'node:sqlite'
import { WAIT_KINDS, type Wait, type WaitKind, type WaitStatus } from 'pod-domain'
import { readJson, writeJson } from './json.ts'

interface WaitRow {
  readonly id: string
  readonly kind: string
  readonly status: string
  readonly title: string
  readonly detail: string
  readonly data: string
  readonly task_id: string | null
  readonly root_id: string | null
  readonly session_id: string | null
  readonly bot_id: string | null
  readonly room_id: string | null
  readonly answer: string | null
  readonly created_at: number
  readonly resolved_at: number | null
}

function toWait(row: WaitRow): Wait {
  return {
    id: row.id,
    kind: (WAIT_KINDS as readonly string[]).includes(row.kind) ? (row.kind as WaitKind) : 'ambiguity',
    status: row.status as WaitStatus,
    title: row.title,
    detail: row.detail,
    data: readJson<Readonly<Record<string, unknown>>>(row.data, {}),
    taskId: row.task_id,
    rootId: row.root_id,
    sessionId: row.session_id,
    botId: row.bot_id,
    roomId: row.room_id,
    answer: row.answer,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  }
}

export function getWait(db: DatabaseSync, id: string): Wait | undefined {
  const row = db.prepare('SELECT * FROM waits WHERE id = ?').get(id) as WaitRow | undefined
  return row === undefined ? undefined : toWait(row)
}

export function listWaits(db: DatabaseSync, statuses: readonly WaitStatus[], limit = 200): readonly Wait[] {
  const rows = db
    .prepare(`SELECT * FROM waits WHERE status IN (${statuses.map(() => '?').join(', ')}) ORDER BY created_at DESC LIMIT ?`)
    .all(...statuses, limit) as unknown as readonly WaitRow[]
  return rows.map(toWait)
}

export function waitsForRoot(db: DatabaseSync, rootId: string): readonly Wait[] {
  const rows = db.prepare('SELECT * FROM waits WHERE root_id = ? ORDER BY created_at').all(rootId) as unknown as readonly WaitRow[]
  return rows.map(toWait)
}

export interface NewWait {
  readonly id: string
  readonly kind: WaitKind
  readonly status: WaitStatus
  readonly title: string
  readonly detail: string
  readonly data: Readonly<Record<string, unknown>>
  readonly taskId: string | null
  readonly rootId: string | null
  readonly sessionId: string | null
  readonly botId: string | null
  readonly roomId: string | null
  readonly now: number
}

export function insertWait(db: DatabaseSync, input: NewWait): Wait {
  db.prepare(
    `INSERT INTO waits (id, kind, status, title, detail, data, task_id, root_id, session_id, bot_id, room_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.kind,
    input.status,
    input.title,
    input.detail,
    writeJson(input.data),
    input.taskId,
    input.rootId,
    input.sessionId,
    input.botId,
    input.roomId,
    input.now,
  )
  const wait = getWait(db, input.id)
  if (wait === undefined) throw new Error(`新建等你事项 ${input.id} 后读不回来`)
  return wait
}

export function setWaitStatus(db: DatabaseSync, id: string, status: WaitStatus, answer: string | null, now: number): Wait | undefined {
  const resolved = status === 'resolved' || status === 'closed' ? now : null
  db.prepare('UPDATE waits SET status = ?, answer = COALESCE(?, answer), resolved_at = ? WHERE id = ?').run(status, answer, resolved, id)
  return getWait(db, id)
}

/** 一个根任务下所有还开着的等你事项一起改状态（停止时挂起、继续时恢复、取消时关闭）。 */
export function setRootWaitStatus(db: DatabaseSync, rootId: string, from: readonly WaitStatus[], to: WaitStatus, now: number): number {
  const resolved = to === 'resolved' || to === 'closed' ? now : null
  const result = db
    .prepare(`UPDATE waits SET status = ?, resolved_at = ? WHERE root_id = ? AND status IN (${from.map(() => '?').join(', ')})`)
    .run(to, resolved, rootId, ...from)
  return Number(result.changes)
}
