import type { DatabaseSync } from 'node:sqlite'
import { readJson } from './json.ts'

/** 动态要用的几样：这段对话里的事、干活的 bot 做成的几步、每一轮是被哪句话叫起来的、在这里说的话。 */

/** 任务在一段对话里说的一句（交代、接着说、结果、回答、等你、没做成）。 */
export interface ActivityMessage {
  readonly id: string
  readonly taskId: string
  readonly author: string
  readonly kind: string
  readonly purpose: string
  readonly body: string
  readonly createdAt: number
}

/** 做成的一步：干活的 bot 记的进展（progress）、这一步做完等消息（waiting）、交的结果（ready）。 */
export interface ActivityReport {
  readonly taskId: string
  readonly author: string
  readonly summary: string
  readonly createdAt: number
}

/** 叫起一件事的一轮：一句话（message，带着送进来的第一句）或者到点（trigger）。 */
export interface ActivityRun {
  readonly id: string
  readonly reason: 'message' | 'trigger'
  /** 开始干的时候，还没开始就是排上队的时候。 */
  readonly at: number
  /** message 那一轮送进来的第一句：消息 id（早先的记录没有）和原话。 */
  readonly said: { readonly id: string | null; readonly text: string } | null
}

/** 在这段对话里交代的根任务（开在这里的、交进这里的），常开任务也算；最近动过的 limit 件，先的在前。 */
export function activityRoots(db: DatabaseSync, roomId: string, limit: number): readonly string[] {
  const rows = db
    .prepare('SELECT id FROM tasks WHERE parent_id IS NULL AND (room_id = ? OR conversation_id = ?) ORDER BY updated_at DESC, rowid DESC LIMIT ?')
    .all(roomId, roomId, limit) as unknown as readonly { readonly id: string }[]
  return rows.map((row) => row.id).reverse()
}

/** 一棵任务树在这段对话里说的话，先的在前。 */
export function activityMessages(db: DatabaseSync, roomId: string, rootId: string): readonly ActivityMessage[] {
  const rows = db
    .prepare(
      `SELECT id, author, kind, body, created_at, json_extract(data, '$.taskId') AS task_id, json_extract(data, '$.purpose') AS purpose FROM messages
       WHERE room_id = ? AND deleted_at IS NULL AND json_extract(data, '$.taskId') IN (SELECT id FROM tasks WHERE root_id = ?)
       ORDER BY seq`,
    )
    .all(roomId, rootId) as unknown as readonly { readonly id: string; readonly author: string; readonly kind: string; readonly body: string; readonly created_at: number; readonly task_id: string; readonly purpose: string | null }[]
  return rows.map((row) => ({ id: row.id, taskId: row.task_id, author: row.author, kind: row.kind, purpose: row.purpose ?? '', body: row.body, createdAt: row.created_at }))
}

/** 一棵任务树做成的几步（进展、做完一步等消息、交的结果），先的在前。 */
export function activityReports(db: DatabaseSync, rootId: string): readonly ActivityReport[] {
  const rows = db
    .prepare(
      `SELECT r.task_id, r.author, r.summary, r.created_at FROM task_reports r JOIN tasks t ON t.id = r.task_id
       WHERE t.root_id = ? AND r.status IN ('progress', 'waiting', 'ready') AND r.summary != ''
       ORDER BY r.created_at, r.rowid`,
    )
    .all(rootId) as unknown as readonly { readonly task_id: string; readonly author: string; readonly summary: string; readonly created_at: number }[]
  return rows.map((row) => ({ taskId: row.task_id, author: row.author, summary: row.summary, createdAt: row.created_at }))
}

/** 送进一轮的第一句：新的记录是 {id, text}，早先的只有原话。 */
function firstSaid(detail: string): ActivityRun['said'] {
  const messages = readJson<{ readonly messages?: unknown }>(detail, {}).messages
  const first: unknown = Array.isArray(messages) ? messages[0] : undefined
  if (typeof first === 'string') return { id: null, text: first }
  if (typeof first !== 'object' || first === null) return null
  const entry = first as Readonly<Record<string, unknown>>
  return typeof entry.text === 'string' ? { id: typeof entry.id === 'string' ? entry.id : null, text: entry.text } : null
}

/** 后来叫起这件事（根任务）的每一轮：一句话送进来的、到点的，先的在前。 */
export function activityRuns(db: DatabaseSync, rootId: string): readonly ActivityRun[] {
  const rows = db
    .prepare("SELECT id, reason, COALESCE(started_at, queued_at) AS at, detail FROM task_runs WHERE task_id = ? AND reason IN ('message', 'trigger') ORDER BY at, rowid")
    .all(rootId) as unknown as readonly { readonly id: string; readonly reason: 'message' | 'trigger'; readonly at: number; readonly detail: string }[]
  return rows.map((row) => ({ id: row.id, reason: row.reason, at: row.at, said: row.reason === 'message' ? firstSaid(row.detail) : null }))
}
