import type { DatabaseSync } from 'node:sqlite'
import { MEMORY_TYPES, type CoreMemory, type MemoryEntry, type MemoryScopeKind, type MemorySource, type MemoryStatus, type MemoryType } from 'pod-domain'
import { flag, readJson, writeJson } from './json.ts'

// ---------- 核心记忆 ----------

export function getCore(db: DatabaseSync, scopeKind: MemoryScopeKind, scopeId: string): CoreMemory {
  const row = db.prepare('SELECT * FROM memory_core WHERE scope_kind = ? AND scope_id = ?').get(scopeKind, scopeId) as
    | { readonly text: string; readonly user_edited: number; readonly updated_at: number }
    | undefined
  return { scopeKind, scopeId, text: row?.text ?? '', userEdited: flag(row?.user_edited), updatedAt: row?.updated_at ?? 0 }
}

export function setCore(db: DatabaseSync, core: CoreMemory): void {
  db.prepare(
    `INSERT INTO memory_core (scope_kind, scope_id, text, user_edited, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (scope_kind, scope_id) DO UPDATE SET text = excluded.text, user_edited = excluded.user_edited, updated_at = excluded.updated_at`,
  ).run(core.scopeKind, core.scopeId, core.text, core.userEdited ? 1 : 0, core.updatedAt)
}

export function listCores(db: DatabaseSync): readonly CoreMemory[] {
  const rows = db.prepare('SELECT * FROM memory_core ORDER BY scope_kind, scope_id').all() as unknown as readonly {
    readonly scope_kind: string
    readonly scope_id: string
    readonly text: string
    readonly user_edited: number
    readonly updated_at: number
  }[]
  return rows.map((row) => ({ scopeKind: row.scope_kind as MemoryScopeKind, scopeId: row.scope_id, text: row.text, userEdited: flag(row.user_edited), updatedAt: row.updated_at }))
}

// ---------- 记忆条目 ----------

interface MemoryRow {
  readonly id: string
  readonly scope_kind: string
  readonly scope_id: string
  readonly type: string
  readonly content: string
  readonly source: string
  readonly source_ref: string
  readonly confidence: number
  readonly private: number
  readonly pinned: number
  readonly status: string
  readonly supersedes: string | null
  readonly valid_until: number | null
  readonly user_edited: number
  readonly created_at: number
  readonly updated_at: number
  readonly last_used_at: number | null
  readonly use_count: number
}

function toEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    scopeKind: row.scope_kind as MemoryScopeKind,
    scopeId: row.scope_id,
    type: (MEMORY_TYPES as readonly string[]).includes(row.type) ? (row.type as MemoryType) : 'fact',
    content: row.content,
    source: row.source as MemorySource,
    sourceRef: row.source_ref,
    confidence: row.confidence,
    private: flag(row.private),
    pinned: flag(row.pinned),
    status: row.status as MemoryStatus,
    supersedes: row.supersedes,
    validUntil: row.valid_until,
    userEdited: flag(row.user_edited),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
  }
}

export function getMemory(db: DatabaseSync, id: string): MemoryEntry | undefined {
  const row = db.prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL').get(id) as MemoryRow | undefined
  return row === undefined ? undefined : toEntry(row)
}

export function listMemories(
  db: DatabaseSync,
  filter: { readonly scopeKind?: MemoryScopeKind; readonly scopeId?: string; readonly statuses?: readonly MemoryStatus[]; readonly limit?: number },
): readonly MemoryEntry[] {
  const clauses = ['deleted_at IS NULL']
  const params: (string | number)[] = []
  if (filter.scopeKind !== undefined) {
    clauses.push('scope_kind = ?')
    params.push(filter.scopeKind)
  }
  if (filter.scopeId !== undefined) {
    clauses.push('scope_id = ?')
    params.push(filter.scopeId)
  }
  if (filter.statuses !== undefined && filter.statuses.length > 0) {
    clauses.push(`status IN (${filter.statuses.map(() => '?').join(', ')})`)
    params.push(...filter.statuses)
  }
  params.push(filter.limit ?? 500)
  const rows = db
    .prepare(`SELECT * FROM memories WHERE ${clauses.join(' AND ')} ORDER BY pinned DESC, updated_at DESC LIMIT ?`)
    .all(...params) as unknown as readonly MemoryRow[]
  return rows.map(toEntry)
}

export function getMemories(db: DatabaseSync, ids: readonly string[]): readonly MemoryEntry[] {
  if (ids.length === 0) return []
  const rows = db
    .prepare(`SELECT * FROM memories WHERE id IN (${ids.map(() => '?').join(', ')}) AND deleted_at IS NULL`)
    .all(...ids) as unknown as readonly MemoryRow[]
  return rows.map(toEntry)
}

export type NewMemory = Omit<MemoryEntry, 'createdAt' | 'updatedAt' | 'lastUsedAt' | 'useCount'> & { readonly now: number }

export function insertMemory(db: DatabaseSync, entry: NewMemory): MemoryEntry {
  db.prepare(
    `INSERT INTO memories (id, scope_kind, scope_id, type, content, source, source_ref, confidence, private, pinned, status, supersedes,
       valid_until, user_edited, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    entry.scopeKind,
    entry.scopeId,
    entry.type,
    entry.content,
    entry.source,
    entry.sourceRef,
    entry.confidence,
    entry.private ? 1 : 0,
    entry.pinned ? 1 : 0,
    entry.status,
    entry.supersedes,
    entry.validUntil,
    entry.userEdited ? 1 : 0,
    entry.now,
    entry.now,
  )
  const created = getMemory(db, entry.id)
  if (created === undefined) throw new Error(`写入记忆 ${entry.id} 后读不回来`)
  return created
}

export interface MemoryPatch {
  readonly content?: string
  readonly type?: MemoryType
  readonly status?: MemoryStatus
  readonly pinned?: boolean
  readonly private?: boolean
  readonly validUntil?: number | null
  readonly userEdited?: boolean
  readonly confidence?: number
}

export function updateMemory(db: DatabaseSync, id: string, patch: MemoryPatch, now: number): MemoryEntry | undefined {
  const current = getMemory(db, id)
  if (current === undefined) return undefined
  const next = { ...current, ...patch }
  db.prepare(
    'UPDATE memories SET content = ?, type = ?, status = ?, pinned = ?, private = ?, valid_until = ?, user_edited = ?, confidence = ?, updated_at = ? WHERE id = ?',
  ).run(next.content, next.type, next.status, next.pinned ? 1 : 0, next.private ? 1 : 0, next.validUntil, next.userEdited ? 1 : 0, next.confidence, now, id)
  return getMemory(db, id)
}

export function touchMemories(db: DatabaseSync, ids: readonly string[], now: number): void {
  const statement = db.prepare('UPDATE memories SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?')
  for (const id of ids) statement.run(now, id)
}

/** 有效期过了的条目自动失效。 */
export function expireMemories(db: DatabaseSync, now: number): number {
  const result = db.prepare("UPDATE memories SET status = 'archived', updated_at = ? WHERE status = 'active' AND valid_until IS NOT NULL AND valid_until < ?").run(now, now)
  return Number(result.changes)
}

// ---------- 变更日志 ----------

export interface MemoryLogEntry {
  readonly id: number
  readonly memoryId: string
  readonly action: string
  readonly before: MemoryEntry | null
  readonly after: MemoryEntry | null
  readonly actor: string
  readonly reason: string
  readonly createdAt: number
  readonly revertedAt: number | null
}

export function appendMemoryLog(
  db: DatabaseSync,
  entry: { readonly memoryId: string; readonly action: string; readonly before: MemoryEntry | null; readonly after: MemoryEntry | null; readonly actor: string; readonly reason: string; readonly now: number },
): void {
  db.prepare('INSERT INTO memory_log (memory_id, action, before, after, actor, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    entry.memoryId,
    entry.action,
    entry.before === null ? null : writeJson(entry.before),
    entry.after === null ? null : writeJson(entry.after),
    entry.actor,
    entry.reason,
    entry.now,
  )
}

interface MemoryLogRow {
  readonly id: number
  readonly memory_id: string
  readonly action: string
  readonly before: string | null
  readonly after: string | null
  readonly actor: string
  readonly reason: string
  readonly created_at: number
  readonly reverted_at: number | null
}

function toLog(row: MemoryLogRow): MemoryLogEntry {
  return {
    id: row.id,
    memoryId: row.memory_id,
    action: row.action,
    before: readJson<MemoryEntry | null>(row.before, null),
    after: readJson<MemoryEntry | null>(row.after, null),
    actor: row.actor,
    reason: row.reason,
    createdAt: row.created_at,
    revertedAt: row.reverted_at,
  }
}

export function listMemoryLog(db: DatabaseSync, options: { readonly since?: number; readonly limit: number }): readonly MemoryLogEntry[] {
  const rows = (
    options.since === undefined
      ? db.prepare('SELECT * FROM memory_log ORDER BY id DESC LIMIT ?').all(options.limit)
      : db.prepare('SELECT * FROM memory_log WHERE created_at >= ? ORDER BY id DESC LIMIT ?').all(options.since, options.limit)
  ) as unknown as readonly MemoryLogRow[]
  return rows.map(toLog)
}

export function getMemoryLog(db: DatabaseSync, id: number): MemoryLogEntry | undefined {
  const row = db.prepare('SELECT * FROM memory_log WHERE id = ?').get(id) as MemoryLogRow | undefined
  return row === undefined ? undefined : toLog(row)
}

export function markMemoryLogReverted(db: DatabaseSync, id: number, now: number): void {
  db.prepare('UPDATE memory_log SET reverted_at = ? WHERE id = ?').run(now, id)
}

// ---------- 交接笔记 ----------

export interface Handover {
  readonly id: string
  readonly fromSession: string
  readonly toSession: string | null
  readonly roomId: string | null
  readonly taskId: string | null
  readonly botId: string
  readonly note: Readonly<Record<string, unknown>>
  readonly reason: string
  readonly createdAt: number
  readonly updatedAt: number
}

interface HandoverRow {
  readonly id: string
  readonly from_session: string
  readonly to_session: string | null
  readonly room_id: string | null
  readonly task_id: string | null
  readonly bot_id: string
  readonly note: string
  readonly reason: string
  readonly created_at: number
  readonly updated_at: number
}

function toHandover(row: HandoverRow): Handover {
  return {
    id: row.id,
    fromSession: row.from_session,
    toSession: row.to_session,
    roomId: row.room_id,
    taskId: row.task_id,
    botId: row.bot_id,
    note: readJson<Readonly<Record<string, unknown>>>(row.note, {}),
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function insertHandover(db: DatabaseSync, handover: Omit<Handover, 'updatedAt'>): Handover {
  db.prepare(
    'INSERT INTO handovers (id, from_session, to_session, room_id, task_id, bot_id, note, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(handover.id, handover.fromSession, handover.toSession, handover.roomId, handover.taskId, handover.botId, writeJson(handover.note), handover.reason, handover.createdAt, handover.createdAt)
  return { ...handover, updatedAt: handover.createdAt }
}

export function setHandoverTarget(db: DatabaseSync, id: string, toSession: string): void {
  db.prepare('UPDATE handovers SET to_session = ? WHERE id = ?').run(toSession, id)
}

export function updateHandoverNote(db: DatabaseSync, id: string, note: Readonly<Record<string, unknown>>, now: number): Handover | undefined {
  db.prepare('UPDATE handovers SET note = ?, updated_at = ? WHERE id = ?').run(writeJson(note), now, id)
  const row = db.prepare('SELECT * FROM handovers WHERE id = ?').get(id) as HandoverRow | undefined
  return row === undefined ? undefined : toHandover(row)
}

export function listHandovers(db: DatabaseSync, filter: { readonly roomId?: string; readonly taskId?: string }): readonly Handover[] {
  const rows = (
    filter.roomId !== undefined
      ? db.prepare('SELECT * FROM handovers WHERE room_id = ? ORDER BY created_at DESC').all(filter.roomId)
      : db.prepare('SELECT * FROM handovers WHERE task_id = ? ORDER BY created_at DESC').all(filter.taskId ?? '')
  ) as unknown as readonly HandoverRow[]
  return rows.map(toHandover)
}
