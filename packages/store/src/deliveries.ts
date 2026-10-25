import type { DatabaseSync } from 'node:sqlite'
import type { Lane } from 'pod-domain'
import { readJson, writeJson } from './json.ts'

/**
 * 持久邮箱：Pod 发给 bot 会话的每一条消息（开工说明、事件、转达、答复）先落库再投递。
 * 重启后没投出去的接着投；投递方式对应 Agent 的 followup / steer / inject。
 */
export type DeliveryMode = 'followup' | 'steer' | 'inject'

export type DeliveryStatus = 'pending' | 'sent' | 'cancelled' | 'failed'

export interface StoredMessage {
  readonly id: string
  readonly text: string
  readonly source: Readonly<Record<string, unknown>> & { readonly kind: string }
}

export interface Delivery {
  readonly id: string
  readonly sessionId: string
  readonly mode: DeliveryMode
  readonly lane: Lane
  readonly priority: number
  readonly message: StoredMessage
  readonly status: DeliveryStatus
  readonly attempts: number
  readonly error: string | null
  readonly createdAt: number
  readonly sentAt: number | null
}

interface DeliveryRow {
  readonly id: string
  readonly session_id: string
  readonly mode: string
  readonly lane: string
  readonly priority: number
  readonly message: string
  readonly status: string
  readonly attempts: number
  readonly error: string | null
  readonly created_at: number
  readonly sent_at: number | null
}

function toDelivery(row: DeliveryRow): Delivery {
  return {
    id: row.id,
    sessionId: row.session_id,
    mode: row.mode as DeliveryMode,
    lane: row.lane as Lane,
    priority: row.priority,
    message: readJson<StoredMessage>(row.message, { id: row.id, text: '', source: { kind: 'pod' } }),
    status: row.status as DeliveryStatus,
    attempts: row.attempts,
    error: row.error,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  }
}

export function insertDelivery(db: DatabaseSync, delivery: Omit<Delivery, 'status' | 'attempts' | 'error' | 'sentAt'>): Delivery {
  db.prepare(
    `INSERT INTO deliveries (id, session_id, mode, lane, priority, message, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(delivery.id, delivery.sessionId, delivery.mode, delivery.lane, delivery.priority, writeJson(delivery.message), delivery.createdAt)
  return { ...delivery, status: 'pending', attempts: 0, error: null, sentAt: null }
}

export function pendingDeliveries(db: DatabaseSync): readonly Delivery[] {
  const rows = db
    .prepare("SELECT * FROM deliveries WHERE status = 'pending' ORDER BY priority ASC, created_at ASC")
    .all() as unknown as readonly DeliveryRow[]
  return rows.map(toDelivery)
}

export function markDelivery(db: DatabaseSync, id: string, status: DeliveryStatus, now: number, error: string | null = null): void {
  db.prepare('UPDATE deliveries SET status = ?, attempts = attempts + 1, error = ?, sent_at = CASE WHEN ? = \'sent\' THEN ? ELSE sent_at END WHERE id = ?').run(
    status,
    error,
    status,
    now,
    id,
  )
}

export function bumpDeliveryAttempt(db: DatabaseSync, id: string, error: string): void {
  db.prepare('UPDATE deliveries SET attempts = attempts + 1, error = ? WHERE id = ?').run(error, id)
}

/** 某条会话里还没投出去的消息全部撤回（任务停止或取消时）。 */
export function cancelPendingFor(db: DatabaseSync, sessionId: string): number {
  const result = db.prepare("UPDATE deliveries SET status = 'cancelled' WHERE session_id = ? AND status = 'pending'").run(sessionId)
  return Number(result.changes)
}

/** 按消息 id 查投递记录：区分“Pod 投进去的消息”和“你在 dsh 会话视图里直接打的字”。 */
export function deliveryByMessageId(db: DatabaseSync, messageId: string): Delivery | undefined {
  const row = db.prepare("SELECT * FROM deliveries WHERE json_extract(message, '$.id') = ?").get(messageId) as DeliveryRow | undefined
  return row === undefined ? undefined : toDelivery(row)
}
