import type { DatabaseSync } from 'node:sqlite'
import { FRONT_DECISIONS, type FollowKind, type MessageRoute, type RouteKind, type Topic, type TopicFollow, type TopicKind } from 'pod-domain'

interface TopicRow {
  readonly id: string
  readonly kind: string
  readonly room_id: string | null
  readonly root_message: string | null
  readonly task_id: string | null
  readonly created_at: number
}

interface FollowRow {
  readonly topic_id: string
  readonly task_id: string
  readonly kind: string
  readonly started_at: number
  readonly ended_at: number | null
}

interface RouteRow {
  readonly id: number
  readonly message_id: string
  readonly route: string
  readonly task_id: string | null
  readonly decided_by: string
  readonly note: string
  readonly ref: string | null
  readonly bot_id: string | null
  readonly created_at: number
}

function toTopic(row: TopicRow): Topic {
  return { id: row.id, kind: row.kind as TopicKind, roomId: row.room_id, rootMessage: row.root_message, taskId: row.task_id, createdAt: row.created_at }
}

function toFollow(row: FollowRow): TopicFollow {
  return { topicId: row.topic_id, taskId: row.task_id, kind: row.kind as FollowKind, startedAt: row.started_at, endedAt: row.ended_at }
}

function toRoute(row: RouteRow): MessageRoute {
  return { id: row.id, messageId: row.message_id, route: row.route as RouteKind, taskId: row.task_id, decidedBy: row.decided_by, note: row.note, ref: row.ref, botId: row.bot_id, createdAt: row.created_at }
}

/** 顺着回复、引用往上找这一串最早的那条（最多 50 层）。 */
export function threadRoot(db: DatabaseSync, messageId: string): string | undefined {
  const row = db
    .prepare(
      `WITH RECURSIVE chain(id, reply_to, depth) AS (
         SELECT id, reply_to, 0 FROM messages WHERE id = ?
         UNION ALL
         SELECT m.id, m.reply_to, chain.depth + 1 FROM messages m JOIN chain ON m.id = chain.reply_to WHERE chain.depth < 50
       )
       SELECT id FROM chain ORDER BY depth DESC LIMIT 1`,
    )
    .get(messageId) as { readonly id: string } | undefined
  return row?.id
}

export function getTopic(db: DatabaseSync, id: string): Topic | undefined {
  const row = db.prepare('SELECT * FROM topics WHERE id = ?').get(id) as TopicRow | undefined
  return row === undefined ? undefined : toTopic(row)
}

export function topicByRoot(db: DatabaseSync, rootMessage: string): Topic | undefined {
  const row = db.prepare("SELECT * FROM topics WHERE kind = 'thread' AND root_message = ? ORDER BY created_at LIMIT 1").get(rootMessage) as TopicRow | undefined
  return row === undefined ? undefined : toTopic(row)
}

/**
 * 建一个回复串的话题：这一串里已有的消息（最早那条和回它、引用它的）都记上这个话题，
 * 之后新的回复由写入时继承上一条的话题。调用方负责包在事务里。
 */
export function insertThreadTopic(db: DatabaseSync, topic: { readonly id: string; readonly roomId: string | null; readonly rootMessage: string; readonly now: number }): Topic {
  db.prepare("INSERT INTO topics (id, kind, room_id, root_message, task_id, created_at) VALUES (?, 'thread', ?, ?, NULL, ?)").run(topic.id, topic.roomId, topic.rootMessage, topic.now)
  db.prepare(
    `WITH RECURSIVE thread(id, depth) AS (
       SELECT id, 0 FROM messages WHERE id = ?
       UNION ALL
       SELECT m.id, thread.depth + 1 FROM messages m JOIN thread ON m.reply_to = thread.id WHERE thread.depth < 50
     )
     UPDATE messages SET topic_id = ?, topic_via = CASE WHEN id = ? THEN 'root' ELSE 'reply' END
     WHERE id IN (SELECT id FROM thread) AND topic_id IS NULL`,
  ).run(topic.rootMessage, topic.id, topic.rootMessage)
  return { id: topic.id, kind: 'thread', roomId: topic.roomId, rootMessage: topic.rootMessage, taskId: null, createdAt: topic.now }
}

/** 任务群的话题：整个群一个话题，群里不是回复的话写入时都记上它。调用方负责包在事务里。 */
export function insertTeamTopic(db: DatabaseSync, topic: { readonly id: string; readonly roomId: string; readonly taskId: string; readonly now: number }): Topic {
  db.prepare("INSERT INTO topics (id, kind, room_id, root_message, task_id, created_at) VALUES (?, 'team', ?, NULL, ?, ?)").run(topic.id, topic.roomId, topic.taskId, topic.now)
  return { id: topic.id, kind: 'team', roomId: topic.roomId, rootMessage: null, taskId: topic.taskId, createdAt: topic.now }
}

export function teamTopicOf(db: DatabaseSync, roomId: string): Topic | undefined {
  const row = db.prepare("SELECT * FROM topics WHERE kind = 'team' AND room_id = ? ORDER BY created_at LIMIT 1").get(roomId) as TopicRow | undefined
  return row === undefined ? undefined : toTopic(row)
}

/** 自带比挂上强，挂上比只读强：重复跟进时只升不降；取消过的重新跟进。 */
export function followTopic(db: DatabaseSync, follow: { readonly topicId: string; readonly taskId: string; readonly kind: FollowKind; readonly now: number }): void {
  db.prepare(
    `INSERT INTO topic_follows (topic_id, task_id, kind, started_at, ended_at) VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT (topic_id, task_id) DO UPDATE SET
       kind = CASE
         WHEN topic_follows.ended_at IS NOT NULL THEN excluded.kind
         WHEN topic_follows.kind = 'own' OR excluded.kind = 'own' THEN 'own'
         WHEN topic_follows.kind = 'attached' OR excluded.kind = 'attached' THEN 'attached'
         ELSE 'readonly' END,
       started_at = CASE WHEN topic_follows.ended_at IS NULL THEN topic_follows.started_at ELSE excluded.started_at END,
       ended_at = NULL`,
  ).run(follow.topicId, follow.taskId, follow.kind, follow.now)
}

export function unfollowTopic(db: DatabaseSync, topicId: string, taskId: string, now: number): boolean {
  const result = db.prepare('UPDATE topic_follows SET ended_at = ? WHERE topic_id = ? AND task_id = ? AND ended_at IS NULL').run(now, topicId, taskId)
  return Number(result.changes) > 0
}

/** 正在跟进这个话题的任务。 */
export function followersOf(db: DatabaseSync, topicId: string): readonly TopicFollow[] {
  const rows = db.prepare('SELECT * FROM topic_follows WHERE topic_id = ? AND ended_at IS NULL ORDER BY started_at').all(topicId) as unknown as readonly FollowRow[]
  return rows.map(toFollow)
}

/** 任务正在跟进的话题。 */
export function followsOf(db: DatabaseSync, taskId: string): readonly TopicFollow[] {
  const rows = db.prepare('SELECT * FROM topic_follows WHERE task_id = ? AND ended_at IS NULL ORDER BY started_at').all(taskId) as unknown as readonly FollowRow[]
  return rows.map(toFollow)
}

/** 话题里某个时间之后的消息（只读跟进的开工时带上），旧的在前。 */
export function topicMessagesSince(db: DatabaseSync, topicId: string, since: number, limit: number): readonly { readonly id: string; readonly author: string; readonly body: string; readonly replyTo: string | null; readonly createdAt: number }[] {
  const rows = db
    .prepare(
      `SELECT id, author, body, reply_to, created_at FROM (
         SELECT id, author, body, reply_to, created_at FROM messages
         WHERE topic_id = ? AND created_at > ? AND deleted_at IS NULL AND kind = 'text'
         ORDER BY created_at DESC LIMIT ?
       ) ORDER BY created_at`,
    )
    .all(topicId, since, limit) as unknown as readonly { readonly id: string; readonly author: string; readonly body: string; readonly reply_to: string | null; readonly created_at: number }[]
  return rows.map((row) => ({ id: row.id, author: row.author, body: row.body, replyTo: row.reply_to, createdAt: row.created_at }))
}

export function insertRoute(
  db: DatabaseSync,
  route: {
    readonly messageId: string
    readonly route: RouteKind
    readonly taskId: string | null
    readonly decidedBy: string
    readonly note?: string
    readonly ref?: string | null
    readonly botId?: string | null
    readonly now: number
  },
): void {
  db.prepare('INSERT INTO message_routes (message_id, route, task_id, decided_by, note, ref, bot_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    route.messageId,
    route.route,
    route.taskId,
    route.decidedBy,
    route.note ?? '',
    route.ref ?? null,
    route.botId ?? null,
    route.now,
  )
}

const DECIDED = FRONT_DECISIONS.map((kind) => `'${kind}'`).join(', ')

/** 交给这个 bot 的前台、还没送出去的消息（前台的待送队列），旧的在前。 */
export function frontQueue(db: DatabaseSync, botId: string): readonly MessageRoute[] {
  const rows = db.prepare("SELECT * FROM message_routes WHERE route = 'front' AND bot_id = ? AND ref IS NULL ORDER BY id").all(botId) as unknown as readonly RouteRow[]
  return rows.map(toRoute)
}

/** 这个时间以后记成漏掉、之后没再有去向的消息（你点重试时重新交给前台）。 */
export function missedFrontRoutes(db: DatabaseSync, since: number): readonly MessageRoute[] {
  const rows = db
    .prepare(
      `SELECT * FROM message_routes r
       WHERE r.route = 'missed' AND r.bot_id IS NOT NULL AND r.created_at >= ?
         AND NOT EXISTS (SELECT 1 FROM message_routes s WHERE s.message_id = r.message_id AND s.id > r.id)
       ORDER BY r.id`,
    )
    .all(since) as unknown as readonly RouteRow[]
  return rows.map(toRoute)
}

/** 有待送消息的前台。 */
export function frontsWithQueue(db: DatabaseSync): readonly string[] {
  const rows = db.prepare("SELECT DISTINCT bot_id FROM message_routes WHERE route = 'front' AND bot_id IS NOT NULL AND ref IS NULL").all() as unknown as readonly { readonly bot_id: string }[]
  return rows.map((row) => row.bot_id)
}

/** 这几条交给前台的去向记成随这一批送出。 */
export function bindFrontRoutes(db: DatabaseSync, ids: readonly number[], ref: string): void {
  const statement = db.prepare('UPDATE message_routes SET ref = ? WHERE id = ?')
  for (const id of ids) statement.run(ref, id)
}

/** 随这几批送进前台、这个前台还没给判断的消息。 */
export function undecidedFront(db: DatabaseSync, botId: string, refs: readonly string[]): readonly MessageRoute[] {
  if (refs.length === 0) return []
  const rows = db
    .prepare(
      `SELECT * FROM message_routes r
       WHERE r.route = 'front' AND r.bot_id = ? AND r.ref IN (${refs.map(() => '?').join(', ')})
         AND NOT EXISTS (SELECT 1 FROM message_routes s WHERE s.message_id = r.message_id AND s.bot_id = r.bot_id AND s.route IN (${DECIDED}) AND s.id > r.id)
       ORDER BY r.id`,
    )
    .all(botId, ...refs) as unknown as readonly RouteRow[]
  return rows.map(toRoute)
}

/** 交给这个前台、已经送进去但还没去向的那几批（重启后内存里的记录没了，按这个补）。 */
export function frontRefsUndecided(db: DatabaseSync, botId: string): readonly string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT r.ref AS ref FROM message_routes r
       WHERE r.route = 'front' AND r.bot_id = ? AND r.ref IS NOT NULL AND r.ref != 'dropped'
         AND NOT EXISTS (SELECT 1 FROM message_routes s WHERE s.message_id = r.message_id AND s.bot_id = r.bot_id AND s.route IN (${DECIDED}) AND s.id > r.id)`,
    )
    .all(botId) as unknown as readonly { readonly ref: string }[]
  return rows.map((row) => row.ref)
}

/** 这条消息交给这个前台以后，前台还没给判断（没交给它返回 false）。 */
export function awaitingFront(db: DatabaseSync, messageId: string, botId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS hit FROM message_routes r
       WHERE r.message_id = ? AND r.route = 'front' AND r.bot_id = ?
         AND NOT EXISTS (SELECT 1 FROM message_routes s WHERE s.message_id = r.message_id AND s.bot_id = r.bot_id AND s.route IN (${DECIDED}) AND s.id > r.id)
       LIMIT 1`,
    )
    .get(messageId, botId) as { readonly hit: number } | undefined
  return row !== undefined
}

/** 某个时间以后的去向（前台的任务动静里写“哪条消息直通了哪个任务”）。 */
export function routesSince(db: DatabaseSync, kinds: readonly RouteKind[], since: number, limit: number): readonly MessageRoute[] {
  const rows = db
    .prepare(`SELECT * FROM message_routes WHERE route IN (${kinds.map(() => '?').join(', ')}) AND created_at > ? ORDER BY id LIMIT ?`)
    .all(...kinds, since, limit) as unknown as readonly RouteRow[]
  return rows.map(toRoute)
}

export function routesFor(db: DatabaseSync, messageId: string): readonly MessageRoute[] {
  const rows = db.prepare('SELECT * FROM message_routes WHERE message_id = ? ORDER BY id').all(messageId) as unknown as readonly RouteRow[]
  return rows.map(toRoute)
}

/** 送进这个任务、还没确认也没交还的消息（直通的和前台转来的），旧的在前。 */
export function pendingRoutes(db: DatabaseSync, taskId: string): readonly MessageRoute[] {
  const rows = db
    .prepare(
      `SELECT * FROM message_routes r
       WHERE r.task_id = ? AND r.route IN ('direct', 'relayed')
         AND NOT EXISTS (SELECT 1 FROM message_routes s WHERE s.message_id = r.message_id AND s.task_id = r.task_id AND s.route IN ('acked', 'handed_back', 'returned') AND s.id > r.id)
       ORDER BY r.id`,
    )
    .all(taskId) as unknown as readonly RouteRow[]
  return rows.map(toRoute)
}

/** 开工时把送进任务的消息从记在执行上改成记在开工说明那次投递上。 */
export function rebindRouteRef(db: DatabaseSync, from: string, to: string): void {
  db.prepare('UPDATE message_routes SET ref = ? WHERE ref = ?').run(to, from)
}
