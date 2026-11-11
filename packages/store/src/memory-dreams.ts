import type { DatabaseSync } from 'node:sqlite'
import {
  EMPTY_DREAM_STATS,
  type DreamEvidence,
  type DreamOp,
  type DreamOpAfter,
  type DreamOpBefore,
  type DreamOpKind,
  type DreamQuestion,
  type DreamRejection,
  type DreamScope,
  type DreamStats,
  type DreamStatus,
  type DreamTrigger,
  type MemoryDream,
  type MemoryScopeKind,
} from 'pod-domain'
import { flag, readJson, writeJson } from './json.ts'

// ---------- 每一晚的整理 ----------

interface DreamRow {
  readonly id: string
  readonly trigger: string
  readonly status: string
  readonly scopes: string
  readonly stats: string
  readonly questions: string
  readonly rejected: string
  readonly work: string
  readonly model: string
  readonly error: string
  readonly held: string
  readonly started_at: number
  readonly finished_at: number | null
  readonly applied_at: number | null
  readonly reverted_at: number | null
}

function toDream(row: DreamRow): MemoryDream {
  return {
    id: row.id,
    trigger: row.trigger as DreamTrigger,
    status: row.status as DreamStatus,
    scopes: readJson<readonly DreamScope[]>(row.scopes, []),
    stats: { ...EMPTY_DREAM_STATS, ...readJson<Partial<DreamStats>>(row.stats, {}) },
    questions: readJson<readonly DreamQuestion[]>(row.questions, []),
    rejected: readJson<readonly DreamRejection[]>(row.rejected, []),
    model: row.model,
    error: row.error,
    held: row.held,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    appliedAt: row.applied_at,
    revertedAt: row.reverted_at,
  }
}

export function insertDream(db: DatabaseSync, dream: Pick<MemoryDream, 'id' | 'trigger' | 'status' | 'model' | 'startedAt'>): MemoryDream {
  db.prepare('INSERT INTO memory_dreams (id, trigger, status, model, started_at) VALUES (?, ?, ?, ?, ?)').run(dream.id, dream.trigger, dream.status, dream.model, dream.startedAt)
  const created = getDream(db, dream.id)
  if (created === undefined) throw new Error(`写入整理记录 ${dream.id} 后读不回来`)
  return created
}

export function getDream(db: DatabaseSync, id: string): MemoryDream | undefined {
  const row = db.prepare('SELECT * FROM memory_dreams WHERE id = ?').get(id) as DreamRow | undefined
  return row === undefined ? undefined : toDream(row)
}

export function listDreams(db: DatabaseSync, limit: number): readonly MemoryDream[] {
  const rows = db.prepare('SELECT * FROM memory_dreams ORDER BY started_at DESC LIMIT ?').all(limit) as unknown as readonly DreamRow[]
  return rows.map(toDream)
}

/** 还没收尾的那一次（正在整理，或者停着等空闲）。同时只有一次。 */
export function openDream(db: DatabaseSync): MemoryDream | undefined {
  const row = db.prepare("SELECT * FROM memory_dreams WHERE status IN ('running', 'paused') ORDER BY started_at DESC LIMIT 1").get() as DreamRow | undefined
  return row === undefined ? undefined : toDream(row)
}

/** 生效过几次（撤销了的也算看过）：头几次都先给你看。 */
export function countAppliedDreams(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM memory_dreams WHERE status IN ('applied', 'reverted')").get() as { readonly n: number }
  return Number(row.n)
}

export type DreamPatch = Partial<Pick<MemoryDream, 'status' | 'scopes' | 'stats' | 'questions' | 'rejected' | 'model' | 'error' | 'held' | 'finishedAt' | 'appliedAt' | 'revertedAt'>>

export function updateDream(db: DatabaseSync, id: string, patch: DreamPatch): MemoryDream | undefined {
  const current = getDream(db, id)
  if (current === undefined) return undefined
  const next = { ...current, ...patch }
  db.prepare(
    `UPDATE memory_dreams SET status = ?, scopes = ?, stats = ?, questions = ?, rejected = ?, model = ?, error = ?, held = ?, finished_at = ?, applied_at = ?, reverted_at = ? WHERE id = ?`,
  ).run(next.status, writeJson(next.scopes), writeJson(next.stats), writeJson(next.questions), writeJson(next.rejected), next.model, next.error, next.held, next.finishedAt, next.appliedAt, next.revertedAt, id)
  return getDream(db, id)
}

/** 做到一半的进度（读完了哪几份记录、找到了什么）：停下来以后接着做用。 */
export function readDreamWork<T>(db: DatabaseSync, id: string, fallback: T): T {
  const row = db.prepare('SELECT work FROM memory_dreams WHERE id = ?').get(id) as { readonly work: string } | undefined
  return row === undefined ? fallback : readJson<T>(row.work, fallback)
}

export function writeDreamWork(db: DatabaseSync, id: string, work: unknown): void {
  db.prepare('UPDATE memory_dreams SET work = ? WHERE id = ?').run(writeJson(work), id)
}

// ---------- 一晚里的每一处改动 ----------

interface OpRow {
  readonly dream_id: string
  readonly seq: number
  readonly kind: string
  readonly scope_kind: string
  readonly scope_id: string
  readonly ref: string
  readonly before: string
  readonly after: string
  readonly reason: string
  readonly evidence: string
  readonly held: number
  readonly applied_at: number | null
  readonly reverted_at: number | null
  readonly skipped: string
}

function toOp(row: OpRow): DreamOp {
  return {
    dreamId: row.dream_id,
    seq: row.seq,
    kind: row.kind as DreamOpKind,
    scopeKind: row.scope_kind as MemoryScopeKind,
    scopeId: row.scope_id,
    ref: row.ref,
    before: readJson<DreamOpBefore>(row.before, {}),
    after: readJson<DreamOpAfter>(row.after, {}),
    reason: row.reason,
    evidence: readJson<readonly DreamEvidence[]>(row.evidence, []),
    held: flag(row.held),
    appliedAt: row.applied_at,
    revertedAt: row.reverted_at,
    skipped: row.skipped,
  }
}

export type NewDreamOp = Omit<DreamOp, 'appliedAt' | 'revertedAt' | 'skipped'>

export function insertDreamOps(db: DatabaseSync, ops: readonly NewDreamOp[]): void {
  const statement = db.prepare(
    'INSERT INTO memory_dream_ops (dream_id, seq, kind, scope_kind, scope_id, ref, before, after, reason, evidence, held) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  for (const op of ops) {
    statement.run(op.dreamId, op.seq, op.kind, op.scopeKind, op.scopeId, op.ref, writeJson(op.before), writeJson(op.after), op.reason, writeJson(op.evidence), op.held ? 1 : 0)
  }
}

export function listDreamOps(db: DatabaseSync, dreamId: string): readonly DreamOp[] {
  const rows = db.prepare('SELECT * FROM memory_dream_ops WHERE dream_id = ? ORDER BY seq').all(dreamId) as unknown as readonly OpRow[]
  return rows.map(toOp)
}

export function markDreamOp(
  db: DatabaseSync,
  dreamId: string,
  seq: number,
  patch: { readonly appliedAt?: number | null; readonly revertedAt?: number | null; readonly skipped?: string; readonly before?: DreamOpBefore },
): void {
  const row = db.prepare('SELECT * FROM memory_dream_ops WHERE dream_id = ? AND seq = ?').get(dreamId, seq) as OpRow | undefined
  if (row === undefined) return
  db.prepare('UPDATE memory_dream_ops SET applied_at = ?, reverted_at = ?, skipped = ?, before = ? WHERE dream_id = ? AND seq = ?').run(
    patch.appliedAt === undefined ? row.applied_at : patch.appliedAt,
    patch.revertedAt === undefined ? row.reverted_at : patch.revertedAt,
    patch.skipped ?? row.skipped,
    patch.before === undefined ? row.before : writeJson(patch.before),
    dreamId,
    seq,
  )
}
