import type { DatabaseSync } from 'node:sqlite'
import type { MemoryNote, MemoryScopeKind, NoteSource, NoteStatus } from 'pod-domain'
import { flag, readJson, writeJson } from './json.ts'

// ---------- 主题笔记 ----------

interface NoteRow {
  readonly id: string
  readonly scope_kind: string
  readonly scope_id: string
  readonly title: string
  readonly description: string
  readonly body: string
  readonly links: string
  readonly sources: string
  readonly status: string
  readonly user_edited: number
  readonly created_at: number
  readonly updated_at: number
}

function toNote(row: NoteRow): MemoryNote {
  return {
    id: row.id,
    scopeKind: row.scope_kind as MemoryScopeKind,
    scopeId: row.scope_id,
    title: row.title,
    description: row.description,
    body: row.body,
    links: readJson<readonly string[]>(row.links, []),
    sources: readJson<readonly NoteSource[]>(row.sources, []),
    status: row.status as NoteStatus,
    userEdited: flag(row.user_edited),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getNote(db: DatabaseSync, id: string): MemoryNote | undefined {
  const row = db.prepare('SELECT * FROM memory_notes WHERE id = ?').get(id) as NoteRow | undefined
  return row === undefined ? undefined : toNote(row)
}

export function getNotes(db: DatabaseSync, ids: readonly string[]): readonly MemoryNote[] {
  if (ids.length === 0) return []
  const rows = db.prepare(`SELECT * FROM memory_notes WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as unknown as readonly NoteRow[]
  return rows.map(toNote)
}

/** 一个范围的笔记，最近改过的在前；不给范围就是全部。默认只要在用的。 */
export function listNotes(
  db: DatabaseSync,
  filter: { readonly scopeKind?: MemoryScopeKind; readonly scopeId?: string; readonly statuses?: readonly NoteStatus[] } = {},
): readonly MemoryNote[] {
  const statuses = filter.statuses ?? ['active']
  const clauses = [`status IN (${statuses.map(() => '?').join(', ')})`]
  const params: string[] = [...statuses]
  if (filter.scopeKind !== undefined) {
    clauses.push('scope_kind = ?')
    params.push(filter.scopeKind)
  }
  if (filter.scopeId !== undefined) {
    clauses.push('scope_id = ?')
    params.push(filter.scopeId)
  }
  const rows = db.prepare(`SELECT * FROM memory_notes WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, id`).all(...params) as unknown as readonly NoteRow[]
  return rows.map(toNote)
}

/** 写一页笔记：没有就新建，有就整页换成给的样子。 */
export function putNote(db: DatabaseSync, note: MemoryNote): MemoryNote {
  db.prepare(
    `INSERT INTO memory_notes (id, scope_kind, scope_id, title, description, body, links, sources, status, user_edited, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET scope_kind = excluded.scope_kind, scope_id = excluded.scope_id, title = excluded.title, description = excluded.description,
       body = excluded.body, links = excluded.links, sources = excluded.sources, status = excluded.status, user_edited = excluded.user_edited, updated_at = excluded.updated_at`,
  ).run(
    note.id,
    note.scopeKind,
    note.scopeId,
    note.title,
    note.description,
    note.body,
    writeJson(note.links),
    writeJson(note.sources),
    note.status,
    note.userEdited ? 1 : 0,
    note.createdAt,
    note.updatedAt,
  )
  return note
}
