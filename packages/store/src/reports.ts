import type { DatabaseSync } from 'node:sqlite'
import type { ReportStatus, TaskReport } from 'pod-domain'
import { readJson, writeJson } from './json.ts'

/** 汇报：任务会话每次调用汇报工具留下的记录，只增不改。 */
interface ReportRow {
  readonly id: string
  readonly run_id: string | null
  readonly task_id: string
  readonly status: string
  readonly summary: string
  readonly report: string
  readonly question: string | null
  readonly about_message: string | null
  readonly reply_message: string | null
  readonly checks: string
  readonly data: string
  readonly author: string
  readonly created_at: number
}

function toReport(row: ReportRow): TaskReport {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    status: row.status as ReportStatus,
    summary: row.summary,
    report: row.report,
    question: row.question ?? '',
    aboutMessage: row.about_message,
    replyMessage: row.reply_message,
    checks: readJson<readonly number[]>(row.checks, []),
    data: readJson<Readonly<Record<string, unknown>>>(row.data, {}),
    author: row.author,
    createdAt: row.created_at,
  }
}

export function insertReport(db: DatabaseSync, report: TaskReport): TaskReport {
  db.prepare(
    `INSERT INTO task_reports (id, run_id, task_id, status, summary, report, question, about_message, reply_message, checks, data, author, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    report.id,
    report.runId,
    report.taskId,
    report.status,
    report.summary,
    report.report,
    report.question === '' ? null : report.question,
    report.aboutMessage,
    report.replyMessage,
    writeJson(report.checks),
    writeJson(report.data),
    report.author,
    report.createdAt,
  )
  return report
}

export function getReport(db: DatabaseSync, id: string): TaskReport | undefined {
  const row = db.prepare('SELECT * FROM task_reports WHERE id = ?').get(id) as ReportRow | undefined
  return row === undefined ? undefined : toReport(row)
}

/** 最后一次汇报（进展也算）。 */
export function latestReport(db: DatabaseSync, taskId: string): TaskReport | undefined {
  const row = db.prepare('SELECT * FROM task_reports WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(taskId) as ReportRow | undefined
  return row === undefined ? undefined : toReport(row)
}

/** 最后一次不是进展的汇报：阶段看它（进展只更新任务卡）。 */
export function latestDecisiveReport(db: DatabaseSync, taskId: string): TaskReport | undefined {
  const row = db
    .prepare("SELECT * FROM task_reports WHERE task_id = ? AND status != 'progress' ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(taskId) as ReportRow | undefined
  return row === undefined ? undefined : toReport(row)
}

export function reportsFor(db: DatabaseSync, taskId: string, limit = 50): readonly TaskReport[] {
  const rows = db.prepare('SELECT * FROM task_reports WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(taskId, limit) as unknown as readonly ReportRow[]
  return rows.map(toReport)
}
