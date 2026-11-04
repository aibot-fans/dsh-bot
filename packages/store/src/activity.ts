import type { DatabaseSync } from 'node:sqlite'

/** 动态要用的几样：这段对话里的活、记的进展、任务在这里说的话、你接着说的话、谁进群出群。 */

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

/** 一条进展（干活的 bot 报的 progress）。 */
export interface ActivityProgress {
  readonly taskId: string
  readonly author: string
  readonly summary: string
  readonly createdAt: number
}

/** 一句话：你说的、进群出群这一行。 */
export interface ActivityLine {
  readonly id: string
  readonly body: string
  readonly createdAt: number
}

/** 在这段对话里交代的根任务（开在这里的、交进这里的），常开任务不算；先的在前，最多最近 limit 件。 */
export function activityRoots(db: DatabaseSync, roomId: string, limit: number): readonly string[] {
  const rows = db
    .prepare(
      `SELECT id FROM tasks
       WHERE parent_id IS NULL AND (room_id = ? OR conversation_id = ?)
         AND id NOT IN (SELECT task_id FROM triggers WHERE closed_at IS NULL AND json_extract(spec, '$.kind') IN ('cron', 'page'))
         AND id NOT IN (SELECT json_extract(data, '$.taskId') FROM messages WHERE kind = 'task-card' AND json_extract(data, '$.standing') = 1)
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
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

/** 一棵任务树记的进展，先的在前。 */
export function activityProgress(db: DatabaseSync, rootId: string): readonly ActivityProgress[] {
  const rows = db
    .prepare(
      `SELECT r.task_id, r.author, r.summary, r.created_at FROM task_reports r JOIN tasks t ON t.id = r.task_id
       WHERE t.root_id = ? AND r.status = 'progress' AND r.summary != ''
       ORDER BY r.created_at, r.rowid`,
    )
    .all(rootId) as unknown as readonly { readonly task_id: string; readonly author: string; readonly summary: string; readonly created_at: number }[]
  return rows.map((row) => ({ taskId: row.task_id, author: row.author, summary: row.summary, createdAt: row.created_at }))
}

/** 你在这段对话里说的话，先的在前（任务对话里按它分组：每句是一次接着说）。 */
export function ownerLines(db: DatabaseSync, roomId: string): readonly ActivityLine[] {
  const rows = db
    .prepare("SELECT id, body, created_at FROM messages WHERE room_id = ? AND author = 'owner' AND kind = 'text' AND deleted_at IS NULL ORDER BY seq")
    .all(roomId) as unknown as readonly { readonly id: string; readonly body: string; readonly created_at: number }[]
  return rows.map((row) => ({ id: row.id, body: row.body, createdAt: row.created_at }))
}

/** 谁进群、谁出群（dsh-bot 记的那一行，带着是哪个 bot），先的在前。 */
export function memberLines(db: DatabaseSync, roomId: string): readonly ActivityLine[] {
  const rows = db
    .prepare(
      `SELECT id, body, created_at FROM messages
       WHERE room_id = ? AND kind = 'milestone' AND deleted_at IS NULL AND json_extract(data, '$.botId') IS NOT NULL AND json_extract(data, '$.taskId') IS NULL
       ORDER BY seq`,
    )
    .all(roomId) as unknown as readonly { readonly id: string; readonly body: string; readonly created_at: number }[]
  return rows.map((row) => ({ id: row.id, body: row.body, createdAt: row.created_at }))
}
