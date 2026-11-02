import type { DatabaseSync } from 'node:sqlite'
import type { RunOutcome, RunReason, RunStatus, TaskRun } from 'pod-domain'
import { readJson, writeJson } from './json.ts'

/** 执行：任务的每次开工一条，排队、进行中、已结束；结束后不再改。 */
interface RunRow {
  readonly id: string
  readonly task_id: string
  readonly session_id: string | null
  readonly status: string
  readonly reason: string
  readonly detail: string
  readonly outcome: string | null
  readonly error: string | null
  readonly queued_at: number
  readonly started_at: number | null
  readonly ended_at: number | null
}

function toRun(row: RunRow): TaskRun {
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id,
    status: row.status as RunStatus,
    reason: (row.reason || 'new') as RunReason,
    detail: readJson<Readonly<Record<string, unknown>>>(row.detail, {}),
    outcome: (row.outcome as RunOutcome | null) ?? null,
    error: row.error,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  }
}

export function insertRun(
  db: DatabaseSync,
  run: { readonly id: string; readonly taskId: string; readonly reason: RunReason; readonly detail: Readonly<Record<string, unknown>>; readonly now: number },
): TaskRun {
  db.prepare("INSERT INTO task_runs (id, task_id, status, reason, detail, queued_at) VALUES (?, ?, 'queued', ?, ?, ?)").run(run.id, run.taskId, run.reason, writeJson(run.detail), run.now)
  return { id: run.id, taskId: run.taskId, sessionId: null, status: 'queued', reason: run.reason, detail: run.detail, outcome: null, error: null, queuedAt: run.now, startedAt: null, endedAt: null }
}

export function getRun(db: DatabaseSync, id: string): TaskRun | undefined {
  const row = db.prepare('SELECT * FROM task_runs WHERE id = ?').get(id) as RunRow | undefined
  return row === undefined ? undefined : toRun(row)
}

/** 任务最近的一次执行。 */
export function latestRun(db: DatabaseSync, taskId: string): TaskRun | undefined {
  const row = db.prepare('SELECT * FROM task_runs WHERE task_id = ? ORDER BY queued_at DESC, rowid DESC LIMIT 1').get(taskId) as RunRow | undefined
  return row === undefined ? undefined : toRun(row)
}

/** 还没结束的那次（排队或进行中）；同一个任务同时最多一次。 */
export function openRun(db: DatabaseSync, taskId: string): TaskRun | undefined {
  const row = db.prepare("SELECT * FROM task_runs WHERE task_id = ? AND status != 'ended' ORDER BY queued_at DESC LIMIT 1").get(taskId) as RunRow | undefined
  return row === undefined ? undefined : toRun(row)
}

export function runsFor(db: DatabaseSync, taskId: string, limit = 50): readonly TaskRun[] {
  const rows = db.prepare('SELECT * FROM task_runs WHERE task_id = ? ORDER BY queued_at DESC, rowid DESC LIMIT ?').all(taskId, limit) as unknown as readonly RunRow[]
  return rows.map(toRun)
}

/** 某种状态的所有执行，按排队先后（重启恢复、开工排队用）。 */
export function runsByStatus(db: DatabaseSync, status: RunStatus): readonly TaskRun[] {
  const rows = db.prepare('SELECT * FROM task_runs WHERE status = ? ORDER BY queued_at, rowid').all(status) as unknown as readonly RunRow[]
  return rows.map(toRun)
}

/** 正在进行的执行有几次（占着任务名额的）。 */
export function countRunning(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM task_runs WHERE status = 'running'").get() as { readonly n: number }
  return row.n
}

export function startRun(db: DatabaseSync, id: string, sessionId: string, now: number): void {
  db.prepare("UPDATE task_runs SET status = 'running', session_id = ?, started_at = ? WHERE id = ? AND status = 'queued'").run(sessionId, now, id)
}

/** 排着的执行补一句开工原因（比如又来了一条你的消息）。 */
export function mergeRunDetail(db: DatabaseSync, id: string, detail: Readonly<Record<string, unknown>>): void {
  db.prepare("UPDATE task_runs SET detail = ? WHERE id = ? AND status = 'queued'").run(writeJson(detail), id)
}

/** 结束一次执行；已经结束的不再改。返回是不是这次才结束的。 */
export function endRun(db: DatabaseSync, id: string, outcome: RunOutcome, error: string | null, now: number): boolean {
  const result = db.prepare("UPDATE task_runs SET status = 'ended', outcome = ?, error = ?, ended_at = ? WHERE id = ? AND status != 'ended'").run(outcome, error, now, id)
  return Number(result.changes) > 0
}
