import type { DatabaseSync } from 'node:sqlite'
import type { PodSession, SessionKind, SessionStatus } from 'pod-domain'
import { flag } from './json.ts'

interface SessionRow {
  readonly id: string
  readonly bot_id: string
  readonly kind: string
  readonly room_id: string | null
  readonly task_id: string | null
  readonly segment: number
  readonly preset: string
  readonly folder: string
  readonly status: string
  readonly input_tokens: number
  readonly output_tokens: number
  readonly cache_tokens: number
  readonly context_tokens: number
  readonly cost: number
  readonly steps: number
  readonly tainted: number
  readonly created_at: number
  readonly last_active_at: number | null
  readonly retired_at: number | null
}

const KINDS: readonly SessionKind[] = ['chat', 'task', 'coord', 'consult', 'routine']

function toSession(row: SessionRow): PodSession {
  return {
    id: row.id,
    botId: row.bot_id,
    kind: (KINDS as readonly string[]).includes(row.kind) ? (row.kind as SessionKind) : 'chat',
    roomId: row.room_id,
    taskId: row.task_id,
    segment: row.segment,
    preset: row.preset,
    folder: row.folder,
    status: (row.status === 'retired' ? 'retired' : 'active') as SessionStatus,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheTokens: row.cache_tokens,
    contextTokens: row.context_tokens,
    cost: row.cost,
    steps: row.steps,
    tainted: flag(row.tainted),
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    retiredAt: row.retired_at,
  }
}

export function listSessions(db: DatabaseSync, options: { readonly activeOnly: boolean }): readonly PodSession[] {
  const rows = db
    .prepare(options.activeOnly ? "SELECT * FROM sessions WHERE status = 'active'" : 'SELECT * FROM sessions')
    .all() as unknown as readonly SessionRow[]
  return rows.map(toSession)
}

export function getSession(db: DatabaseSync, id: string): PodSession | undefined {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
  return row === undefined ? undefined : toSession(row)
}

export function activeRoomSession(db: DatabaseSync, roomId: string, botId: string): PodSession | undefined {
  const row = db
    .prepare("SELECT * FROM sessions WHERE room_id = ? AND bot_id = ? AND kind = 'chat' AND status = 'active' ORDER BY segment DESC LIMIT 1")
    .get(roomId, botId) as SessionRow | undefined
  return row === undefined ? undefined : toSession(row)
}

export function activeTaskSession(db: DatabaseSync, taskId: string, kind: SessionKind): PodSession | undefined {
  const row = db
    .prepare("SELECT * FROM sessions WHERE task_id = ? AND kind = ? AND status = 'active' ORDER BY segment DESC LIMIT 1")
    .get(taskId, kind) as SessionRow | undefined
  return row === undefined ? undefined : toSession(row)
}

export function sessionsForTask(db: DatabaseSync, taskId: string): readonly PodSession[] {
  const rows = db.prepare('SELECT * FROM sessions WHERE task_id = ? ORDER BY created_at').all(taskId) as unknown as readonly SessionRow[]
  return rows.map(toSession)
}

export function sessionsForRoom(db: DatabaseSync, roomId: string): readonly PodSession[] {
  const rows = db.prepare('SELECT * FROM sessions WHERE room_id = ? ORDER BY created_at').all(roomId) as unknown as readonly SessionRow[]
  return rows.map(toSession)
}

export interface NewSession {
  readonly id: string
  readonly botId: string
  readonly kind: SessionKind
  readonly roomId: string | null
  readonly taskId: string | null
  readonly segment: number
  readonly preset: string
  readonly folder: string
  readonly tainted: boolean
  readonly now: number
}

export function insertSession(db: DatabaseSync, input: NewSession): PodSession {
  db.prepare(
    `INSERT INTO sessions (id, bot_id, kind, room_id, task_id, segment, preset, folder, tainted, created_at, last_active_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET status = 'active', retired_at = NULL`,
  ).run(
    input.id,
    input.botId,
    input.kind,
    input.roomId,
    input.taskId,
    input.segment,
    input.preset,
    input.folder,
    input.tainted ? 1 : 0,
    input.now,
    input.now,
  )
  const session = getSession(db, input.id)
  if (session === undefined) throw new Error(`登记会话 ${input.id} 后读不回来`)
  return session
}

export function retireSession(db: DatabaseSync, id: string, now: number): void {
  db.prepare("UPDATE sessions SET status = 'retired', retired_at = ? WHERE id = ?").run(now, id)
}

export interface SessionUsageDelta {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheTokens: number
  readonly cost: number
  readonly contextTokens: number
}

export function addSessionUsage(db: DatabaseSync, id: string, delta: SessionUsageDelta, now: number): void {
  db.prepare(
    `UPDATE sessions SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cache_tokens = cache_tokens + ?,
       cost = cost + ?, context_tokens = ?, last_active_at = ? WHERE id = ?`,
  ).run(delta.inputTokens, delta.outputTokens, delta.cacheTokens, delta.cost, delta.contextTokens, now, id)
}

export function addSessionSteps(db: DatabaseSync, id: string, steps: number, now: number): void {
  db.prepare('UPDATE sessions SET steps = steps + ?, last_active_at = ? WHERE id = ?').run(steps, now, id)
}

export function markSessionTainted(db: DatabaseSync, id: string): void {
  db.prepare('UPDATE sessions SET tainted = 1 WHERE id = ?').run(id)
}
