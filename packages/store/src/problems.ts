import type { DatabaseSync } from 'node:sqlite'

/**
 * 系统问题：同一种动作连续失败到门槛记一条，成功一次就标成已恢复。
 * detail 写最后一次的错误，进库前已经打过码。
 */
export interface Problem {
  readonly id: number
  readonly kind: string
  readonly detail: string
  readonly failures: number
  readonly startedAt: number
  readonly updatedAt: number
  readonly resolvedAt: number | null
}

interface ProblemRow {
  readonly id: number
  readonly kind: string
  readonly detail: string
  readonly failures: number
  readonly started_at: number
  readonly updated_at: number
  readonly resolved_at: number | null
}

function toProblem(row: ProblemRow): Problem {
  return { id: row.id, kind: row.kind, detail: row.detail, failures: row.failures, startedAt: row.started_at, updatedAt: row.updated_at, resolvedAt: row.resolved_at }
}

export function openProblem(db: DatabaseSync, kind: string): Problem | undefined {
  const row = db.prepare('SELECT * FROM problems WHERE kind = ? AND resolved_at IS NULL ORDER BY id DESC LIMIT 1').get(kind) as ProblemRow | undefined
  return row === undefined ? undefined : toProblem(row)
}

/** 记下或更新一条还没恢复的问题；返回 true 表示是新出现的。 */
export function raiseProblem(db: DatabaseSync, kind: string, detail: string, failures: number, now: number): boolean {
  const current = openProblem(db, kind)
  if (current !== undefined) {
    db.prepare('UPDATE problems SET detail = ?, failures = ?, updated_at = ? WHERE id = ?').run(detail, failures, now, current.id)
    return false
  }
  db.prepare('INSERT INTO problems (kind, detail, failures, started_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(kind, detail, failures, now, now)
  return true
}

/** 恢复了；返回 true 表示原来确实有问题。 */
export function resolveProblem(db: DatabaseSync, kind: string, now: number): boolean {
  const result = db.prepare('UPDATE problems SET resolved_at = ?, updated_at = ? WHERE kind = ? AND resolved_at IS NULL').run(now, now, kind)
  return Number(result.changes) > 0
}

export function listProblems(db: DatabaseSync, options: { readonly openOnly: boolean; readonly limit?: number }): readonly Problem[] {
  const rows = options.openOnly
    ? db.prepare('SELECT * FROM problems WHERE resolved_at IS NULL ORDER BY started_at DESC').all()
    : db.prepare('SELECT * FROM problems ORDER BY id DESC LIMIT ?').all(options.limit ?? 50)
  return (rows as unknown as readonly ProblemRow[]).map(toProblem)
}
