/**
 * 搜索索引的 worker 线程。node:sqlite 的查询是同步的，放在单独的线程里，避免卡住 dsh web 的主线程。
 * 索引在独立的 search.db 里，随时可以删掉重建。
 */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parentPort, workerData } from 'node:worker_threads'
import { fromIndexText, rankScore, toIndexText, toLooseMatchQuery, toMatchQuery, type SearchDoc, type SearchFilters, type SearchHit } from 'pod-domain'

interface Request {
  readonly id: number
  readonly op: string
  readonly args: unknown
}

const file = (workerData as { readonly file: string }).file
mkdirSync(dirname(file), { recursive: true })
const db = new DatabaseSync(file)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA busy_timeout = 5000')
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
    title, body, ref UNINDEXED, kind UNINDEXED, room UNINDEXED, bot UNINDEXED, team UNINDEXED, task UNINDEXED,
    time UNINDEXED, boost UNINDEXED, tokenize = 'unicode61'
  );
  CREATE TABLE IF NOT EXISTS refs (ref TEXT PRIMARY KEY, row INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, size INTEGER NOT NULL);
`)

const insertDoc = db.prepare('INSERT INTO docs (title, body, ref, kind, room, bot, team, task, time, boost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
const findRef = db.prepare('SELECT row FROM refs WHERE ref = ?')
const deleteDoc = db.prepare('DELETE FROM docs WHERE rowid = ?')
const upsertRef = db.prepare('INSERT INTO refs (ref, row) VALUES (?, ?) ON CONFLICT (ref) DO UPDATE SET row = excluded.row')
const deleteRef = db.prepare('DELETE FROM refs WHERE ref = ?')

function remove(ref: string): void {
  const row = findRef.get(ref) as { readonly row: number } | undefined
  if (row === undefined) return
  deleteDoc.run(row.row)
  deleteRef.run(ref)
}

function upsert(docs: readonly SearchDoc[]): number {
  db.exec('BEGIN')
  try {
    for (const doc of docs) {
      remove(doc.ref)
      const result = insertDoc.run(
        toIndexText(doc.title),
        toIndexText(doc.body),
        doc.ref,
        doc.kind,
        doc.roomId,
        doc.botId,
        doc.teamId,
        doc.taskId,
        doc.time,
        doc.boost,
      )
      upsertRef.run(doc.ref, Number(result.lastInsertRowid))
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return docs.length
}

interface Row {
  readonly ref: string
  readonly kind: string
  readonly title: string
  readonly room: string | null
  readonly bot: string | null
  readonly task: string | null
  readonly time: number
  readonly boost: number
  readonly rank: number
  readonly snip: string
}

function runQuery(match: string, filters: SearchFilters): readonly Row[] {
  const clauses = ['docs MATCH ?']
  const params: (string | number)[] = [match]
  if (filters.kinds !== undefined && filters.kinds.length > 0) {
    clauses.push(`kind IN (${filters.kinds.map(() => '?').join(', ')})`)
    params.push(...filters.kinds)
  }
  if (filters.roomId !== undefined) {
    clauses.push('room = ?')
    params.push(filters.roomId)
  }
  if (filters.roomIds !== undefined) {
    if (filters.roomIds.length === 0) return []
    clauses.push(`room IN (${filters.roomIds.map(() => '?').join(', ')})`)
    params.push(...filters.roomIds)
  }
  if (filters.botId !== undefined) {
    clauses.push('bot = ?')
    params.push(filters.botId)
  }
  if (filters.teamId !== undefined) {
    clauses.push('team = ?')
    params.push(filters.teamId)
  }
  if (filters.taskId !== undefined) {
    clauses.push('task = ?')
    params.push(filters.taskId)
  }
  if (filters.since !== undefined) {
    clauses.push('time >= ?')
    params.push(filters.since)
  }
  if (filters.until !== undefined) {
    clauses.push('time <= ?')
    params.push(filters.until)
  }
  const sql = `SELECT ref, kind, fromindex(title) AS title, room, bot, task, time, boost, bm25(docs, 2.0, 1.0) AS rank,
      snippet(docs, 1, '[', ']', '…', 18) AS snip
    FROM docs WHERE ${clauses.join(' AND ')} ORDER BY rank LIMIT 300`
  return db.prepare(sql).all(...params) as unknown as readonly Row[]
}

db.function('fromindex', { deterministic: true }, (value) => (typeof value === 'string' ? fromIndexText(value) : null))

function search(query: string, filters: SearchFilters): readonly SearchHit[] {
  const strict = toMatchQuery(query)
  if (strict === undefined) return []
  let rows = runQuery(strict, filters)
  if (rows.length === 0) {
    const loose = toLooseMatchQuery(query)
    if (loose !== undefined) rows = runQuery(loose, filters)
  }
  const now = Date.now()
  const hits = rows.map((row) => ({
    ref: row.ref,
    kind: row.kind as SearchHit['kind'],
    title: row.title,
    snippet: fromIndexText(row.snip),
    roomId: row.room,
    botId: row.bot,
    taskId: row.task,
    time: Number(row.time),
    score: rankScore(Number(row.rank), Number(row.boost), Number(row.time), now),
  }))
  return [...hits].sort((left, right) => right.score - left.score).slice(0, filters.limit ?? 30)
}

function handle(request: Request): unknown {
  const args = request.args as Readonly<Record<string, unknown>>
  switch (request.op) {
    case 'upsert':
      return upsert(args.docs as readonly SearchDoc[])
    case 'remove':
      for (const ref of args.refs as readonly string[]) remove(ref)
      return null
    case 'search':
      return search(String(args.query ?? ''), (args.filters ?? {}) as SearchFilters)
    case 'fileState': {
      const row = db.prepare('SELECT mtime, size FROM files WHERE path = ?').get(String(args.path)) as { readonly mtime: number; readonly size: number } | undefined
      return row ?? null
    }
    case 'setFileState':
      db.prepare('INSERT INTO files (path, mtime, size) VALUES (?, ?, ?) ON CONFLICT (path) DO UPDATE SET mtime = excluded.mtime, size = excluded.size').run(
        String(args.path),
        Number(args.mtime),
        Number(args.size),
      )
      return null
    case 'count':
      return (db.prepare('SELECT COUNT(*) AS count FROM refs').get() as { readonly count: number }).count
    case 'clear':
      db.exec('DELETE FROM docs; DELETE FROM refs; DELETE FROM files;')
      return null
    default:
      throw new Error(`未知的搜索操作：${request.op}`)
  }
}

parentPort?.on('message', (request: Request) => {
  try {
    parentPort?.postMessage({ id: request.id, ok: true, value: handle(request) })
  } catch (error) {
    parentPort?.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})
