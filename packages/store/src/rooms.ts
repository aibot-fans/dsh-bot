import type { DatabaseSync } from 'node:sqlite'
import type { MessageKind, NotifyLevel, Room, RoomKind, RoomMessage } from 'pod-domain'
import { flag, readJson, writeJson } from './json.ts'

interface RoomRow {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly bot_id: string | null
  readonly team_id: string | null
  readonly task_id: string | null
  readonly topic: string
  readonly pinned: number
  readonly incognito: number
  readonly notify_level: string
  readonly last_seq: number
  readonly read_seq: number
  readonly last_message_at: number | null
  readonly created_at: number
  readonly archived_at: number | null
}

function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    kind: (['direct', 'task', 'team'].includes(row.kind) ? row.kind : 'direct') as RoomKind,
    title: row.title,
    botId: row.bot_id,
    teamId: row.team_id,
    taskId: row.task_id,
    topic: row.topic,
    pinned: flag(row.pinned),
    incognito: flag(row.incognito),
    notifyLevel: (['all', 'waits', 'off'].includes(row.notify_level) ? row.notify_level : 'all') as NotifyLevel,
    lastSeq: row.last_seq,
    readSeq: row.read_seq,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  }
}

export function listRooms(db: DatabaseSync, options: { readonly archived: boolean }): readonly Room[] {
  const rows = db
    .prepare(
      `SELECT * FROM rooms WHERE purged_at IS NULL AND archived_at IS ${options.archived ? 'NOT NULL' : 'NULL'}
       ORDER BY pinned DESC, COALESCE(last_message_at, created_at) DESC`,
    )
    .all() as unknown as readonly RoomRow[]
  return rows.map(toRoom)
}

export function getRoom(db: DatabaseSync, id: string): Room | undefined {
  const row = db.prepare('SELECT * FROM rooms WHERE id = ? AND purged_at IS NULL').get(id) as RoomRow | undefined
  return row === undefined ? undefined : toRoom(row)
}

export function findDirectRooms(db: DatabaseSync, botId: string): readonly Room[] {
  const rows = db
    .prepare(
      "SELECT * FROM rooms WHERE kind = 'direct' AND bot_id = ? AND purged_at IS NULL ORDER BY COALESCE(last_message_at, created_at) DESC",
    )
    .all(botId) as unknown as readonly RoomRow[]
  return rows.map(toRoom)
}

export function findTaskRoom(db: DatabaseSync, taskId: string): Room | undefined {
  const row = db.prepare("SELECT * FROM rooms WHERE kind = 'task' AND task_id = ? AND purged_at IS NULL").get(taskId) as
    | RoomRow
    | undefined
  return row === undefined ? undefined : toRoom(row)
}

export interface NewRoom {
  readonly id: string
  readonly kind: RoomKind
  readonly title: string
  readonly botId?: string | null
  readonly teamId?: string | null
  readonly taskId?: string | null
  readonly topic?: string
  readonly pinned?: boolean
  readonly incognito?: boolean
  readonly now: number
}

export function insertRoom(db: DatabaseSync, input: NewRoom): Room {
  db.prepare(
    `INSERT INTO rooms (id, kind, title, bot_id, team_id, task_id, topic, pinned, incognito, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.kind,
    input.title,
    input.botId ?? null,
    input.teamId ?? null,
    input.taskId ?? null,
    input.topic ?? '',
    input.pinned === true ? 1 : 0,
    input.incognito === true ? 1 : 0,
    input.now,
  )
  const room = getRoom(db, input.id)
  if (room === undefined) throw new Error(`新建房间 ${input.id} 后读不回来`)
  return room
}

export interface RoomPatch {
  readonly title?: string
  readonly topic?: string
  readonly pinned?: boolean
  readonly incognito?: boolean
  readonly notifyLevel?: NotifyLevel
  readonly archivedAt?: number | null
}

export function updateRoom(db: DatabaseSync, id: string, patch: RoomPatch): Room | undefined {
  const current = getRoom(db, id)
  if (current === undefined) return undefined
  const next = { ...current, ...patch }
  db.prepare('UPDATE rooms SET title = ?, topic = ?, pinned = ?, incognito = ?, notify_level = ?, archived_at = ? WHERE id = ?').run(
    next.title,
    next.topic,
    next.pinned ? 1 : 0,
    next.incognito ? 1 : 0,
    next.notifyLevel,
    next.archivedAt,
    id,
  )
  return getRoom(db, id)
}

export function markRoomRead(db: DatabaseSync, id: string, seq: number): void {
  db.prepare('UPDATE rooms SET read_seq = MAX(read_seq, MIN(?, last_seq)) WHERE id = ?').run(seq, id)
}

export function purgeArchivedRooms(db: DatabaseSync, before: number, now: number): number {
  const result = db.prepare('UPDATE rooms SET purged_at = ? WHERE archived_at IS NOT NULL AND archived_at < ? AND purged_at IS NULL').run(now, before)
  return Number(result.changes)
}

// ---------- 成员 ----------

export function listRoomMembers(db: DatabaseSync, roomId: string): readonly { readonly botId: string; readonly muted: boolean }[] {
  const rows = db.prepare('SELECT bot_id, muted FROM room_members WHERE room_id = ? ORDER BY joined_at').all(roomId) as unknown as readonly {
    readonly bot_id: string
    readonly muted: number
  }[]
  return rows.map((row) => ({ botId: row.bot_id, muted: flag(row.muted) }))
}

export function addRoomMember(db: DatabaseSync, roomId: string, botId: string, now: number): void {
  db.prepare('INSERT OR IGNORE INTO room_members (room_id, bot_id, joined_at) VALUES (?, ?, ?)').run(roomId, botId, now)
}

export function removeRoomMember(db: DatabaseSync, roomId: string, botId: string): void {
  db.prepare('DELETE FROM room_members WHERE room_id = ? AND bot_id = ?').run(roomId, botId)
}

export function setMemberMuted(db: DatabaseSync, roomId: string, botId: string, muted: boolean): void {
  db.prepare('UPDATE room_members SET muted = ? WHERE room_id = ? AND bot_id = ?').run(muted ? 1 : 0, roomId, botId)
}

// ---------- 消息 ----------

interface MessageRow {
  readonly id: string
  readonly room_id: string
  readonly seq: number
  readonly author: string
  readonly kind: string
  readonly body: string
  readonly data: string
  readonly reply_to: string | null
  readonly pinned: number
  readonly session_id: string | null
  readonly version: number
  readonly created_at: number
  readonly updated_at: number
  readonly deleted_at: number | null
}

function toMessage(row: MessageRow): RoomMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    seq: row.seq,
    author: row.author,
    kind: row.kind as MessageKind,
    body: row.body,
    data: readJson<Readonly<Record<string, unknown>>>(row.data, {}),
    replyTo: row.reply_to,
    pinned: flag(row.pinned),
    sessionId: row.session_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

export interface NewMessage {
  readonly id: string
  readonly roomId: string
  readonly author: string
  readonly kind: MessageKind
  readonly body: string
  readonly data?: Readonly<Record<string, unknown>>
  readonly replyTo?: string | null
  readonly sessionId?: string | null
  readonly now: number
}

/** 追加一条消息：房间的序号加一，最近消息时间跟着更新。调用方负责包在事务里。 */
export function appendMessage(db: DatabaseSync, input: NewMessage): RoomMessage {
  db.prepare('UPDATE rooms SET last_seq = last_seq + 1, last_message_at = ? WHERE id = ?').run(input.now, input.roomId)
  const { last_seq: seq } = db.prepare('SELECT last_seq FROM rooms WHERE id = ?').get(input.roomId) as { readonly last_seq: number }
  db.prepare(
    `INSERT INTO messages (id, room_id, seq, author, kind, body, data, reply_to, session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.roomId,
    seq,
    input.author,
    input.kind,
    input.body,
    writeJson(input.data ?? {}),
    input.replyTo ?? null,
    input.sessionId ?? null,
    input.now,
    input.now,
  )
  return {
    id: input.id,
    roomId: input.roomId,
    seq,
    author: input.author,
    kind: input.kind,
    body: input.body,
    data: input.data ?? {},
    replyTo: input.replyTo ?? null,
    pinned: false,
    sessionId: input.sessionId ?? null,
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
  }
}

export function getMessage(db: DatabaseSync, id: string): RoomMessage | undefined {
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined
  return row === undefined ? undefined : toMessage(row)
}

/** 一页消息：before 之前（不含）最多 limit 条，按序号从旧到新返回。 */
export function listMessages(
  db: DatabaseSync,
  roomId: string,
  options: { readonly limit: number; readonly before?: number; readonly after?: number },
): readonly RoomMessage[] {
  if (options.after !== undefined) {
    const rows = db
      .prepare('SELECT * FROM messages WHERE room_id = ? AND seq > ? AND deleted_at IS NULL ORDER BY seq ASC LIMIT ?')
      .all(roomId, options.after, options.limit) as unknown as readonly MessageRow[]
    return rows.map(toMessage)
  }
  const rows = (
    options.before === undefined
      ? db.prepare('SELECT * FROM messages WHERE room_id = ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT ?').all(roomId, options.limit)
      : db
          .prepare('SELECT * FROM messages WHERE room_id = ? AND seq < ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT ?')
          .all(roomId, options.before, options.limit)
  ) as unknown as readonly MessageRow[]
  return rows.map(toMessage).reverse()
}

export interface MessagePatch {
  readonly body?: string
  readonly data?: Readonly<Record<string, unknown>>
  readonly pinned?: boolean
  readonly deletedAt?: number | null
}

/** 原地更新一条消息（卡片刷新、置顶、撤回），版本号加一。 */
export function updateMessage(db: DatabaseSync, id: string, patch: MessagePatch, now: number): RoomMessage | undefined {
  const current = getMessage(db, id)
  if (current === undefined) return undefined
  const next = { ...current, ...patch }
  db.prepare('UPDATE messages SET body = ?, data = ?, pinned = ?, deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ?').run(
    next.body,
    writeJson(next.data),
    next.pinned ? 1 : 0,
    next.deletedAt,
    now,
    id,
  )
  return getMessage(db, id)
}

/** 清空一个房间的消息（软删除），返回被删掉的消息，调用方据此更新搜索索引。 */
export function clearRoomMessages(db: DatabaseSync, roomId: string, now: number): readonly RoomMessage[] {
  const rows = db.prepare('SELECT * FROM messages WHERE room_id = ? AND deleted_at IS NULL').all(roomId) as unknown as readonly MessageRow[]
  db.prepare('UPDATE messages SET deleted_at = ?, updated_at = ? WHERE room_id = ? AND deleted_at IS NULL').run(now, now, roomId)
  return rows.map((row) => ({ ...toMessage(row), deletedAt: now }))
}

/** 对话里和某个页面有关的消息（页面卡片、修改要求、bot 修改时的回复），从旧到新。 */
export function listPageMessages(db: DatabaseSync, pageId: string, limit: number): readonly RoomMessage[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE json_extract(data, '$.pageId') = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?")
    .all(pageId, limit) as unknown as readonly MessageRow[]
  return rows.map(toMessage).reverse()
}

/** 某个任务的卡片消息，用来原地刷新。 */
export function findTaskCard(db: DatabaseSync, taskId: string): RoomMessage | undefined {
  const row = db
    .prepare("SELECT * FROM messages WHERE kind = 'task-card' AND json_extract(data, '$.taskId') = ? ORDER BY created_at DESC LIMIT 1")
    .get(taskId) as MessageRow | undefined
  return row === undefined ? undefined : toMessage(row)
}

export function pinnedMessages(db: DatabaseSync, roomId: string): readonly RoomMessage[] {
  const rows = db
    .prepare('SELECT * FROM messages WHERE room_id = ? AND pinned = 1 AND deleted_at IS NULL ORDER BY seq ASC')
    .all(roomId) as unknown as readonly MessageRow[]
  return rows.map(toMessage)
}

/** 每个房间最后一条可见消息，给房间列表的预览用。 */
/** 每个单聊里你说的第一句话：对话记录里拿它当这段对话的标题。 */
export function firstOwnerLines(db: DatabaseSync): ReadonlyMap<string, string> {
  const rows = db
    .prepare(
      `SELECT m.room_id, m.body FROM messages m JOIN (
         SELECT f.room_id, MIN(f.seq) AS seq FROM messages f JOIN rooms r ON r.id = f.room_id
         WHERE r.kind = 'direct' AND f.author = 'owner' AND f.kind = 'text' AND f.deleted_at IS NULL GROUP BY f.room_id
       ) first ON first.room_id = m.room_id AND first.seq = m.seq`,
    )
    .all() as unknown as readonly { readonly room_id: string; readonly body: string }[]
  return new Map(rows.map((row) => [row.room_id, row.body]))
}

/** 一个房间里你说的第一句话；还没说过话是空串。 */
export function firstOwnerLine(db: DatabaseSync, roomId: string): string {
  const row = db
    .prepare("SELECT body FROM messages WHERE room_id = ? AND author = 'owner' AND kind = 'text' AND deleted_at IS NULL ORDER BY seq ASC LIMIT 1")
    .get(roomId) as { readonly body: string } | undefined
  return row?.body ?? ''
}

/** 群聊里最近一次开新对话留下的分隔线的序号；没开过是 0。 */
export function lastChatBreak(db: DatabaseSync, roomId: string): number {
  const row = db
    .prepare("SELECT MAX(seq) AS seq FROM messages WHERE room_id = ? AND kind = 'notice' AND json_extract(data, '$.segment') = 1 AND deleted_at IS NULL")
    .get(roomId) as { readonly seq: number | null } | undefined
  return row?.seq ?? 0
}

export function lastMessages(db: DatabaseSync): ReadonlyMap<string, RoomMessage> {
  const rows = db
    .prepare(
      `SELECT m.* FROM messages m JOIN (
         SELECT room_id, MAX(seq) AS seq FROM messages WHERE deleted_at IS NULL GROUP BY room_id
       ) last ON last.room_id = m.room_id AND last.seq = m.seq`,
    )
    .all() as unknown as readonly MessageRow[]
  return new Map(rows.map((row) => [row.room_id, toMessage(row)]))
}
