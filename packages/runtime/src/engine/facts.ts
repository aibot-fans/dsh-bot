import type { DatabaseSync } from 'node:sqlite'
import { deriveStage, stageFromStatus, statusFromStage, type StageFacts, type Task, type TicketStage } from 'pod-domain'
import { latestDecisiveReport, latestRun } from 'pod-store'

/**
 * 由引擎按执行和汇报管的任务（工单）：根任务，和任务会话开的子任务（L1）。
 * 以前按计划组队的团队任务（L2、L3 的根任务和它们的子任务）还由编排器直接写旧状态，阶段按旧状态对回来。
 */
export function isTicket(task: Pick<Task, 'parentId' | 'level'>): boolean {
  if (task.parentId !== null) return task.level === 'L1'
  return task.level !== 'L2' && task.level !== 'L3'
}

function openWaits(db: DatabaseSync, task: Task): number {
  const sql = task.parentId === null ? "SELECT COUNT(*) AS n FROM waits WHERE root_id = ? AND status = 'open'" : "SELECT COUNT(*) AS n FROM waits WHERE task_id = ? AND status = 'open'"
  const row = db.prepare(sql).get(task.parentId === null ? task.rootId : task.id) as { readonly n: number }
  return row.n
}

/** 有一条回复发不出去（回复改成副作用之后才会有）。 */
function undeliveredReply(db: DatabaseSync, taskId: string): boolean {
  const row = db.prepare("SELECT 1 AS found FROM effects WHERE kind = 'reply' AND attempts >= 3 AND json_extract(payload, '$.taskId') = ? LIMIT 1").get(taskId) as
    | { readonly found: number }
    | undefined
  return row !== undefined
}

export function stageFacts(db: DatabaseSync, task: Task): StageFacts {
  const report = latestDecisiveReport(db, task.id)
  const run = latestRun(db, task.id)
  // 汇报属于最近一次执行（或者是那次执行结束后替它记的）才算数。
  const current = report !== undefined && (run === undefined || report.runId === run.id || (report.runId === null && run.queuedAt <= report.createdAt))
  return {
    endReason: task.endedAt === null ? null : (task.endReason ?? 'done'),
    undelivered: undeliveredReply(db, task.id),
    openWaits: openWaits(db, task),
    lastReport: current ? report.status : null,
    lastRun: run?.status ?? null,
  }
}

/** 这个任务现在的阶段，和由阶段推出来、给旧代码看的状态。 */
export function currentStage(db: DatabaseSync, task: Task): { readonly stage: TicketStage; readonly status: Task['status'] } {
  if (!isTicket(task)) return { stage: stageFromStatus(task.status), status: task.status }
  const facts = stageFacts(db, task)
  const stage = deriveStage(facts)
  return { stage, status: statusFromStage(stage, facts.endReason, facts.lastRun === 'running') }
}
