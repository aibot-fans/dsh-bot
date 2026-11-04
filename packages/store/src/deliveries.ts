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
  /** 交给会话、而且 dsh 已经落盘。 */
  readonly handedAt: number | null
  /** 会话把它收进了历史（看到带这个 id 的 user/message）。 */
  readonly takenAt: number | null
  /** 收进历史后这条会话第一次结束一轮。 */
  readonly readAt: number | null
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
  readonly handed_at: number | null
  readonly taken_at: number | null
  readonly read_at: number | null
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
    handedAt: row.handed_at,
    takenAt: row.taken_at,
    readAt: row.read_at,
  }
}

export function insertDelivery(db: DatabaseSync, delivery: Omit<Delivery, 'status' | 'attempts' | 'error' | 'sentAt' | 'handedAt' | 'takenAt' | 'readAt'>): Delivery {
  db.prepare(
    `INSERT INTO deliveries (id, session_id, mode, lane, priority, message, message_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(delivery.id, delivery.sessionId, delivery.mode, delivery.lane, delivery.priority, writeJson(delivery.message), delivery.message.id, delivery.createdAt)
  return { ...delivery, status: 'pending', attempts: 0, error: null, sentAt: null, handedAt: null, takenAt: null, readAt: null }
}

/** 某条会话还没交出去的消息，按优先级和先后。 */
export function pendingFor(db: DatabaseSync, sessionId: string): readonly Delivery[] {
  const rows = db
    .prepare("SELECT * FROM deliveries WHERE session_id = ? AND status = 'pending' ORDER BY priority ASC, created_at ASC")
    .all(sessionId) as unknown as readonly DeliveryRow[]
  return rows.map(toDelivery)
}

/** 有消息等着交出的会话。 */
export function sessionsWithPending(db: DatabaseSync): readonly string[] {
  const rows = db.prepare("SELECT DISTINCT session_id FROM deliveries WHERE status = 'pending'").all() as unknown as readonly { readonly session_id: string }[]
  return rows.map((row) => row.session_id)
}

/** 交出去了，dsh 也落了盘。 */
export function markHanded(db: DatabaseSync, id: string, now: number): void {
  db.prepare("UPDATE deliveries SET status = 'sent', sent_at = ?, handed_at = ?, error = NULL WHERE id = ?").run(now, now, id)
}

/** 会话把这条消息收进了历史；返回是不是 Pod 投的。 */
export function markTaken(db: DatabaseSync, sessionId: string, messageId: string, now: number): boolean {
  const result = db.prepare('UPDATE deliveries SET taken_at = ? WHERE session_id = ? AND message_id = ? AND taken_at IS NULL').run(now, sessionId, messageId)
  return Number(result.changes) > 0
}

/** 一轮结束：这条会话里收进了还没读的，都算读过。 */
export function markReadFor(db: DatabaseSync, sessionId: string, now: number): number {
  const result = db.prepare('UPDATE deliveries SET read_at = ? WHERE session_id = ? AND taken_at IS NOT NULL AND read_at IS NULL').run(now, sessionId)
  return Number(result.changes)
}

/**
 * 重启后：交出去了却没收进历史的，改回待投，由投递时查历史和收件箱决定要不要重交（不丢，也不重复）。
 * 只管还在用的会话；返回涉及的会话。
 */
export function requeueUntaken(db: DatabaseSync, sessionIds: readonly string[]): readonly string[] {
  const touched: string[] = []
  const statement = db.prepare("UPDATE deliveries SET status = 'pending' WHERE session_id = ? AND status = 'sent' AND taken_at IS NULL AND handed_at IS NOT NULL")
  for (const id of sessionIds) if (Number(statement.run(id).changes) > 0) touched.push(id)
  return touched
}

/** 停掉一条会话：没交出的撤回，交出了还没收进历史的也算没读、不再重交。 */
export function dropUndelivered(db: DatabaseSync, sessionId: string, reason: string): number {
  const result = db
    .prepare("UPDATE deliveries SET status = 'cancelled', error = ? WHERE session_id = ? AND (status = 'pending' OR (status = 'sent' AND taken_at IS NULL))")
    .run(reason, sessionId)
  return Number(result.changes)
}

/** 撤回一条还没交出的消息；返回撤没撤成（已经交出的不动）。 */
export function cancelDelivery(db: DatabaseSync, id: string, reason: string): boolean {
  const result = db.prepare("UPDATE deliveries SET status = 'cancelled', error = ? WHERE id = ? AND status = 'pending'").run(reason, id)
  return Number(result.changes) > 0
}

/** 连续送不到的消息（排在最前、失败到门槛的那条），任务上显示“消息没送到”。 */
export function stuckDelivery(db: DatabaseSync, sessionId: string, threshold: number): Delivery | undefined {
  const row = db
    .prepare("SELECT * FROM deliveries WHERE session_id = ? AND status = 'pending' AND attempts >= ? ORDER BY priority ASC, created_at ASC LIMIT 1")
    .get(sessionId, threshold) as DeliveryRow | undefined
  return row === undefined ? undefined : toDelivery(row)
}

/** 某条会话里你的话（来源是用户）的投递，新的在前：任务页显示“你的补充：已读 / 未读”。 */
export function ownerDeliveries(db: DatabaseSync, sessionIds: readonly string[], limit: number): readonly Delivery[] {
  if (sessionIds.length === 0) return []
  const rows = db
    .prepare(
      `SELECT * FROM deliveries WHERE session_id IN (${sessionIds.map(() => '?').join(', ')}) AND json_extract(message, '$.source.kind') = 'user'
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...sessionIds, limit) as unknown as readonly DeliveryRow[]
  return rows.map(toDelivery)
}

export function getDelivery(db: DatabaseSync, id: string): Delivery | undefined {
  const row = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id) as DeliveryRow | undefined
  return row === undefined ? undefined : toDelivery(row)
}

export function bumpDeliveryAttempt(db: DatabaseSync, id: string, error: string): void {
  db.prepare('UPDATE deliveries SET attempts = attempts + 1, error = ? WHERE id = ?').run(error, id)
}

/** 按消息 id 查投递记录：区分“Pod 投进去的消息”和“你在 dsh 会话视图里直接打的字”。 */
export function deliveryByMessageId(db: DatabaseSync, messageId: string): Delivery | undefined {
  const row = db.prepare('SELECT * FROM deliveries WHERE message_id = ?').get(messageId) as DeliveryRow | undefined
  return row === undefined ? undefined : toDelivery(row)
}
