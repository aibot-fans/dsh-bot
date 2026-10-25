import type { DatabaseSync } from 'node:sqlite'
import type { EvolutionEntry, EvolutionKind, Feedback, FeedbackKind, Scorecard, Skill, SkillStatus } from 'pod-domain'
import { flag, readJson, writeJson } from './json.ts'

// ---------- 反馈信号 ----------

interface FeedbackRow {
  readonly id: number
  readonly kind: string
  readonly bot_id: string | null
  readonly task_id: string | null
  readonly root_id: string | null
  readonly message_id: string | null
  readonly value: number
  readonly reason: string
  readonly created_at: number
}

function toFeedback(row: FeedbackRow): Feedback {
  return {
    id: row.id,
    kind: row.kind as FeedbackKind,
    botId: row.bot_id,
    taskId: row.task_id,
    rootId: row.root_id,
    messageId: row.message_id,
    value: row.value,
    reason: row.reason,
    createdAt: row.created_at,
  }
}

export interface FeedbackInput {
  readonly kind: FeedbackKind
  readonly botId: string | null
  readonly taskId?: string | null
  readonly rootId?: string | null
  readonly messageId?: string | null
  readonly value: number
  readonly reason?: string
  readonly now: number
}

export function insertFeedback(db: DatabaseSync, input: FeedbackInput): void {
  db.prepare('INSERT INTO feedback (kind, bot_id, task_id, root_id, message_id, value, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    input.kind,
    input.botId,
    input.taskId ?? null,
    input.rootId ?? null,
    input.messageId ?? null,
    input.value,
    input.reason ?? '',
    input.now,
  )
}

/** 一条消息只留一次评分：再点就覆盖，点 0 就撤销。 */
export function setRating(db: DatabaseSync, input: FeedbackInput & { readonly messageId: string }): void {
  db.prepare("DELETE FROM feedback WHERE kind = 'rating' AND message_id = ?").run(input.messageId)
  if (input.value !== 0) insertFeedback(db, input)
}

/** 一个房间里你给过的评分：消息 id → 1 或 -1。 */
export function ratingsInRoom(db: DatabaseSync, roomId: string): ReadonlyMap<string, number> {
  const rows = db
    .prepare("SELECT f.message_id AS id, f.value AS value FROM feedback f JOIN messages m ON m.id = f.message_id WHERE f.kind = 'rating' AND m.room_id = ?")
    .all(roomId) as unknown as readonly { readonly id: string; readonly value: number }[]
  return new Map(rows.map((row) => [row.id, row.value]))
}

export function ratingOf(db: DatabaseSync, messageId: string): number {
  const row = db.prepare("SELECT value FROM feedback WHERE kind = 'rating' AND message_id = ?").get(messageId) as { readonly value: number } | undefined
  return row?.value ?? 0
}

export function feedbackFor(db: DatabaseSync, filter: { readonly botId?: string; readonly since?: number; readonly taskIds?: readonly string[] }): readonly Feedback[] {
  const clauses: string[] = []
  const params: (string | number)[] = []
  if (filter.botId !== undefined) {
    clauses.push('bot_id = ?')
    params.push(filter.botId)
  }
  if (filter.since !== undefined) {
    clauses.push('created_at >= ?')
    params.push(filter.since)
  }
  if (filter.taskIds !== undefined) {
    if (filter.taskIds.length === 0) return []
    clauses.push(`task_id IN (${filter.taskIds.map(() => '?').join(', ')})`)
    params.push(...filter.taskIds)
  }
  const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
  const rows = db.prepare(`SELECT * FROM feedback ${where} ORDER BY created_at`).all(...params) as unknown as readonly FeedbackRow[]
  return rows.map(toFeedback)
}

// ---------- 技能 ----------

interface SkillRow {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly scope_kind: string
  readonly scope_id: string
  readonly description: string
  readonly content: string
  readonly has_script: number
  readonly status: string
  readonly version: number
  readonly source: string
  readonly source_ref: string | null
  readonly created_by: string
  readonly created_at: number
  readonly updated_at: number
}

function toSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    scopeKind: row.scope_kind === 'team' ? 'team' : 'bot',
    scopeId: row.scope_id,
    description: row.description,
    content: row.content,
    hasScript: flag(row.has_script),
    status: row.status as SkillStatus,
    version: row.version,
    source: row.source as Skill['source'],
    sourceRef: row.source_ref,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listSkills(db: DatabaseSync, filter: { readonly scopeKind?: 'bot' | 'team'; readonly scopeId?: string; readonly statuses?: readonly SkillStatus[] } = {}): readonly Skill[] {
  const rows = db.prepare('SELECT * FROM skills ORDER BY updated_at DESC').all() as unknown as readonly SkillRow[]
  return rows
    .map(toSkill)
    .filter((skill) => (filter.scopeKind === undefined || skill.scopeKind === filter.scopeKind) && (filter.scopeId === undefined || skill.scopeId === filter.scopeId))
    .filter((skill) => filter.statuses === undefined || filter.statuses.includes(skill.status))
}

export function getSkill(db: DatabaseSync, id: string): Skill | undefined {
  const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined
  return row === undefined ? undefined : toSkill(row)
}

export function findSkill(db: DatabaseSync, scopeKind: 'bot' | 'team', scopeId: string, name: string): Skill | undefined {
  const row = db.prepare('SELECT * FROM skills WHERE scope_kind = ? AND scope_id = ? AND name = ?').get(scopeKind, scopeId, name) as SkillRow | undefined
  return row === undefined ? undefined : toSkill(row)
}

/** 新建或更新一个技能：版本号加一，旧内容存进版本表。 */
export function saveSkill(db: DatabaseSync, skill: Omit<Skill, 'version' | 'createdAt' | 'updatedAt'> & { readonly now: number; readonly reason: string }): Skill {
  const existing = findSkill(db, skill.scopeKind, skill.scopeId, skill.name)
  const version = existing === undefined ? 1 : existing.version + 1
  if (existing === undefined) {
    db.prepare(
      'INSERT INTO skills (id, name, title, scope_kind, scope_id, description, content, has_script, status, version, source, source_ref, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(skill.id, skill.name, skill.title, skill.scopeKind, skill.scopeId, skill.description, skill.content, skill.hasScript ? 1 : 0, skill.status, version, skill.source, skill.sourceRef, skill.createdBy, skill.now, skill.now)
  } else {
    db.prepare('UPDATE skills SET title = ?, description = ?, content = ?, has_script = ?, status = ?, version = ?, source = ?, source_ref = ?, updated_at = ? WHERE id = ?').run(
      skill.title,
      skill.description,
      skill.content,
      skill.hasScript ? 1 : 0,
      skill.status,
      version,
      skill.source,
      skill.sourceRef,
      skill.now,
      existing.id,
    )
  }
  const id = existing?.id ?? skill.id
  db.prepare('INSERT INTO skill_versions (skill_id, version, title, description, content, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, version, skill.title, skill.description, skill.content, skill.reason, skill.now)
  return getSkill(db, id) as Skill
}

export function setSkillStatus(db: DatabaseSync, id: string, status: SkillStatus, now: number): Skill | undefined {
  db.prepare('UPDATE skills SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id)
  return getSkill(db, id)
}

export interface SkillVersion {
  readonly version: number
  readonly title: string
  readonly description: string
  readonly content: string
  readonly reason: string
  readonly createdAt: number
}

export function skillVersions(db: DatabaseSync, id: string): readonly SkillVersion[] {
  const rows = db.prepare('SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY version DESC').all(id) as unknown as readonly {
    readonly version: number
    readonly title: string
    readonly description: string
    readonly content: string
    readonly reason: string
    readonly created_at: number
  }[]
  return rows.map((row) => ({ version: row.version, title: row.title, description: row.description, content: row.content, reason: row.reason, createdAt: row.created_at }))
}

// ---------- 进化日志 ----------

interface EvolutionRow {
  readonly id: string
  readonly kind: string
  readonly bot_id: string | null
  readonly subject: string
  readonly summary: string
  readonly before: string
  readonly after: string
  readonly reason: string
  readonly source: string
  readonly baseline: string
  readonly status: string
  readonly created_at: number
  readonly reverted_at: number | null
}

function toEntry(row: EvolutionRow): EvolutionEntry {
  return {
    id: row.id,
    kind: row.kind as EvolutionKind,
    botId: row.bot_id,
    subject: row.subject,
    summary: row.summary,
    before: readJson<unknown>(row.before, null),
    after: readJson<unknown>(row.after, null),
    reason: row.reason,
    source: row.source,
    baseline: readJson<Scorecard | null>(row.baseline, null),
    status: row.status as EvolutionEntry['status'],
    createdAt: row.created_at,
    revertedAt: row.reverted_at,
  }
}

export function insertEvolution(db: DatabaseSync, entry: Omit<EvolutionEntry, 'status' | 'revertedAt'>): EvolutionEntry {
  db.prepare('INSERT INTO evolution (id, kind, bot_id, subject, summary, before, after, reason, source, baseline, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    entry.id,
    entry.kind,
    entry.botId,
    entry.subject,
    entry.summary,
    writeJson(entry.before ?? null),
    writeJson(entry.after ?? null),
    entry.reason,
    entry.source,
    writeJson(entry.baseline),
    entry.createdAt,
  )
  return { ...entry, status: 'active', revertedAt: null }
}

export function listEvolution(db: DatabaseSync, options: { readonly since?: number; readonly limit?: number } = {}): readonly EvolutionEntry[] {
  const rows = db.prepare('SELECT * FROM evolution WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?').all(options.since ?? 0, options.limit ?? 200) as unknown as readonly EvolutionRow[]
  return rows.map(toEntry)
}

export function getEvolution(db: DatabaseSync, id: string): EvolutionEntry | undefined {
  const row = db.prepare('SELECT * FROM evolution WHERE id = ?').get(id) as EvolutionRow | undefined
  return row === undefined ? undefined : toEntry(row)
}

export function setEvolutionStatus(db: DatabaseSync, id: string, status: EvolutionEntry['status'], now: number): void {
  db.prepare('UPDATE evolution SET status = ?, reverted_at = ? WHERE id = ?').run(status, status === 'reverted' ? now : null, id)
}

// ---------- 按反馈的调整：人设补充和推理档位 ----------

export interface Tuning {
  readonly botId: string
  readonly persona: string
  readonly effort: string | null
  readonly updatedAt: number
}

export function getTuning(db: DatabaseSync, botId: string): Tuning | undefined {
  const row = db.prepare('SELECT * FROM tuning WHERE bot_id = ?').get(botId) as { readonly bot_id: string; readonly persona: string; readonly effort: string | null; readonly updated_at: number } | undefined
  return row === undefined ? undefined : { botId: row.bot_id, persona: row.persona, effort: row.effort, updatedAt: row.updated_at }
}

export function setTuning(db: DatabaseSync, botId: string, patch: { readonly persona?: string; readonly effort?: string | null }, now: number): Tuning {
  const current = getTuning(db, botId) ?? { botId, persona: '', effort: null, updatedAt: now }
  const next = { ...current, ...patch, updatedAt: now }
  db.prepare('INSERT INTO tuning (bot_id, persona, effort, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (bot_id) DO UPDATE SET persona = excluded.persona, effort = excluded.effort, updated_at = excluded.updated_at').run(
    botId,
    next.persona,
    next.effort,
    now,
  )
  return next
}

// ---------- 评分卡用的查询 ----------

export interface OwnedTask {
  readonly id: string
  readonly rootId: string
  readonly status: string
  readonly createdAt: number
  readonly finishedAt: number | null
}

/** 某个 bot 负责过的任务（最近的在前）。 */
export function tasksOwnedBy(db: DatabaseSync, botId: string, options: { readonly since?: number; readonly limit?: number } = {}): readonly OwnedTask[] {
  const rows = db
    .prepare('SELECT id, root_id, status, created_at, finished_at FROM tasks WHERE owner_bot_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?')
    .all(botId, options.since ?? 0, options.limit ?? 50) as unknown as readonly { readonly id: string; readonly root_id: string; readonly status: string; readonly created_at: number; readonly finished_at: number | null }[]
  return rows.map((row) => ({ id: row.id, rootId: row.root_id, status: row.status, createdAt: row.created_at, finishedAt: row.finished_at }))
}

/** 每个任务的验收记录：按时间先后的通过或打回。 */
export function reviewsOf(db: DatabaseSync, taskIds: readonly string[]): ReadonlyMap<string, readonly boolean[]> {
  if (taskIds.length === 0) return new Map()
  const rows = db
    .prepare(`SELECT task_id, data FROM task_events WHERE kind = 'reviewed' AND task_id IN (${taskIds.map(() => '?').join(', ')}) ORDER BY id`)
    .all(...taskIds) as unknown as readonly { readonly task_id: string; readonly data: string }[]
  const result = new Map<string, boolean[]>()
  for (const row of rows) result.set(row.task_id, [...(result.get(row.task_id) ?? []), readJson<{ readonly pass?: boolean }>(row.data, {}).pass === true])
  return result
}
