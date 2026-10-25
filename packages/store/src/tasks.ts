import type { DatabaseSync } from 'node:sqlite'
import type { AcceptanceItem, Task, TaskLevel, TaskNeeds, TaskResult, TaskStage, TaskStatus, ToolProfile } from 'pod-domain'
import { flag, readJson, writeJson } from './json.ts'

interface TaskRow {
  readonly id: string
  readonly root_id: string
  readonly parent_id: string | null
  readonly room_id: string | null
  readonly team_id: string | null
  readonly title: string
  readonly brief: string
  readonly kind: string
  readonly deliverable: string
  readonly acceptance: string
  readonly depends_on: string
  readonly needs: string
  readonly owner_bot_id: string | null
  readonly level: string | null
  readonly status: string
  readonly stage: string | null
  readonly note: string
  readonly result: string | null
  readonly folder: string
  readonly plan_version: number
  readonly urgent: number
  readonly tainted: number
  readonly max_profile: string
  readonly plan_pending: number
  readonly created_by: string
  readonly requester_session: string | null
  readonly attempts: number
  readonly created_at: number
  readonly started_at: number | null
  readonly finished_at: number | null
  readonly updated_at: number
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    rootId: row.root_id,
    parentId: row.parent_id,
    roomId: row.room_id,
    teamId: row.team_id,
    title: row.title,
    brief: row.brief,
    kind: row.kind,
    deliverable: row.deliverable,
    acceptance: readJson<readonly AcceptanceItem[]>(row.acceptance, []),
    dependsOn: readJson<readonly string[]>(row.depends_on, []),
    needs: { browser: false, shell: false, ...readJson<Partial<TaskNeeds>>(row.needs, {}) },
    ownerBotId: row.owner_bot_id,
    level: (row.level as TaskLevel | null) ?? null,
    status: row.status as TaskStatus,
    stage: (row.stage as TaskStage | null) ?? null,
    note: row.note,
    result: readJson<TaskResult | null>(row.result, null),
    folder: row.folder,
    planVersion: row.plan_version,
    urgent: flag(row.urgent),
    tainted: flag(row.tainted),
    maxProfile: (['talk', 'research', 'exec'].includes(row.max_profile) ? row.max_profile : 'exec') as ToolProfile,
    planPending: flag(row.plan_pending),
    createdBy: row.created_by,
    requesterSession: row.requester_session,
    attempts: row.attempts,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  }
}

export function getTask(db: DatabaseSync, id: string): Task | undefined {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL').get(id) as TaskRow | undefined
  return row === undefined ? undefined : toTask(row)
}

export function listTaskTree(db: DatabaseSync, rootId: string): readonly Task[] {
  const rows = db
    .prepare('SELECT * FROM tasks WHERE root_id = ? AND deleted_at IS NULL ORDER BY created_at ASC')
    .all(rootId) as unknown as readonly TaskRow[]
  return rows.map(toTask)
}

export function listRootTasks(db: DatabaseSync, options: { readonly limit: number; readonly status?: readonly TaskStatus[] }): readonly Task[] {
  const filter = options.status === undefined ? '' : `AND status IN (${options.status.map(() => '?').join(', ')})`
  const rows = db
    .prepare(`SELECT * FROM tasks WHERE parent_id IS NULL AND deleted_at IS NULL ${filter} ORDER BY updated_at DESC LIMIT ?`)
    .all(...(options.status ?? []), options.limit) as unknown as readonly TaskRow[]
  return rows.map(toTask)
}

/** 某个 bot 手上和排队的任务，算负载用。 */
export function activeTasksForBot(db: DatabaseSync, botId: string): readonly Task[] {
  const rows = db
    .prepare("SELECT * FROM tasks WHERE owner_bot_id = ? AND status IN ('queued', 'running', 'waiting', 'review') AND deleted_at IS NULL")
    .all(botId) as unknown as readonly TaskRow[]
  return rows.map(toTask)
}

export function listTasksByStatus(db: DatabaseSync, statuses: readonly TaskStatus[]): readonly Task[] {
  const rows = db
    .prepare(`SELECT * FROM tasks WHERE status IN (${statuses.map(() => '?').join(', ')}) AND deleted_at IS NULL ORDER BY created_at`)
    .all(...statuses) as unknown as readonly TaskRow[]
  return rows.map(toTask)
}

export interface NewTask {
  readonly id: string
  readonly rootId: string
  readonly parentId: string | null
  readonly roomId: string | null
  readonly teamId: string | null
  readonly title: string
  readonly brief: string
  readonly kind: string
  readonly deliverable: string
  readonly acceptance: readonly AcceptanceItem[]
  readonly dependsOn: readonly string[]
  readonly needs: TaskNeeds
  readonly ownerBotId: string | null
  readonly level: TaskLevel | null
  readonly status: TaskStatus
  readonly stage: TaskStage | null
  readonly folder: string
  readonly urgent: boolean
  readonly tainted: boolean
  readonly maxProfile?: ToolProfile
  readonly planPending?: boolean
  readonly createdBy: string
  readonly requesterSession: string | null
  readonly now: number
}

export function insertTask(db: DatabaseSync, input: NewTask): Task {
  db.prepare(
    `INSERT INTO tasks (id, root_id, parent_id, room_id, team_id, title, brief, kind, deliverable, acceptance, depends_on, needs,
       owner_bot_id, level, status, stage, folder, urgent, tainted, max_profile, plan_pending, created_by, requester_session, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.rootId,
    input.parentId,
    input.roomId,
    input.teamId,
    input.title,
    input.brief,
    input.kind,
    input.deliverable,
    writeJson(input.acceptance),
    writeJson(input.dependsOn),
    writeJson(input.needs),
    input.ownerBotId,
    input.level,
    input.status,
    input.stage,
    input.folder,
    input.urgent ? 1 : 0,
    input.tainted ? 1 : 0,
    input.maxProfile ?? 'exec',
    input.planPending === true ? 1 : 0,
    input.createdBy,
    input.requesterSession,
    input.now,
    input.now,
  )
  const task = getTask(db, input.id)
  if (task === undefined) throw new Error(`新建任务 ${input.id} 后读不回来`)
  return task
}

export interface TaskPatch {
  readonly title?: string
  readonly brief?: string
  readonly deliverable?: string
  readonly acceptance?: readonly AcceptanceItem[]
  readonly dependsOn?: readonly string[]
  readonly ownerBotId?: string | null
  readonly status?: TaskStatus
  readonly stage?: TaskStage | null
  readonly note?: string
  readonly result?: TaskResult | null
  readonly roomId?: string | null
  readonly planVersion?: number
  readonly urgent?: boolean
  readonly tainted?: boolean
  readonly planPending?: boolean
  readonly kind?: string
  readonly needs?: TaskNeeds
  readonly requesterSession?: string | null
  readonly attempts?: number
  readonly startedAt?: number | null
  readonly finishedAt?: number | null
}

export function updateTask(db: DatabaseSync, id: string, patch: TaskPatch, now: number): Task | undefined {
  const current = getTask(db, id)
  if (current === undefined) return undefined
  const next = { ...current, ...patch }
  db.prepare(
    `UPDATE tasks SET title = ?, brief = ?, deliverable = ?, acceptance = ?, depends_on = ?, owner_bot_id = ?, status = ?, stage = ?,
       note = ?, result = ?, room_id = ?, plan_version = ?, urgent = ?, tainted = ?, plan_pending = ?, kind = ?, needs = ?,
       requester_session = ?, attempts = ?, started_at = ?, finished_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    next.title,
    next.brief,
    next.deliverable,
    writeJson(next.acceptance),
    writeJson(next.dependsOn),
    next.ownerBotId,
    next.status,
    next.stage,
    next.note,
    next.result === null ? null : writeJson(next.result),
    next.roomId,
    next.planVersion,
    next.urgent ? 1 : 0,
    next.tainted ? 1 : 0,
    next.planPending ? 1 : 0,
    next.kind,
    writeJson(next.needs),
    next.requesterSession,
    next.attempts,
    next.startedAt,
    next.finishedAt,
    now,
    id,
  )
  return getTask(db, id)
}

export function readTaskPlan<T>(db: DatabaseSync, id: string): T | null {
  const row = db.prepare('SELECT plan FROM tasks WHERE id = ?').get(id) as { readonly plan: string | null } | undefined
  return readJson<T | null>(row?.plan, null)
}

/** 计划里子任务的 id（s1、s2……）到真实任务 id 的对应，存在子任务行上。 */
export function setTaskPlanKey(db: DatabaseSync, id: string, key: string): void {
  db.prepare('UPDATE tasks SET plan_key = ? WHERE id = ?').run(key, id)
}

export function planKeys(db: DatabaseSync, rootId: string): ReadonlyMap<string, string> {
  const rows = db.prepare('SELECT id, plan_key FROM tasks WHERE root_id = ? AND plan_key IS NOT NULL').all(rootId) as unknown as readonly {
    readonly id: string
    readonly plan_key: string
  }[]
  return new Map(rows.map((row) => [row.plan_key, row.id]))
}

export function writeTaskPlan(db: DatabaseSync, id: string, plan: unknown, version: number, now: number): void {
  db.prepare('UPDATE tasks SET plan = ?, plan_version = ?, updated_at = ? WHERE id = ?').run(writeJson(plan), version, now, id)
}

// ---------- 决策链 ----------

export interface TaskEvent {
  readonly id: number
  readonly taskId: string
  readonly rootId: string
  readonly kind: string
  readonly actor: string
  readonly data: Readonly<Record<string, unknown>>
  readonly createdAt: number
}

export function appendTaskEvent(db: DatabaseSync, event: Omit<TaskEvent, 'id' | 'createdAt'> & { readonly now: number }): void {
  db.prepare('INSERT INTO task_events (task_id, root_id, kind, actor, data, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    event.taskId,
    event.rootId,
    event.kind,
    event.actor,
    writeJson(event.data),
    event.now,
  )
}

export function listTaskEvents(db: DatabaseSync, rootId: string): readonly TaskEvent[] {
  const rows = db.prepare('SELECT * FROM task_events WHERE root_id = ? ORDER BY id ASC').all(rootId) as unknown as readonly {
    readonly id: number
    readonly task_id: string
    readonly root_id: string
    readonly kind: string
    readonly actor: string
    readonly data: string
    readonly created_at: number
  }[]
  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    rootId: row.root_id,
    kind: row.kind,
    actor: row.actor,
    data: readJson<Readonly<Record<string, unknown>>>(row.data, {}),
    createdAt: row.created_at,
  }))
}

/** 资料库用：某个 bot 负责的、或者在某个群聊里的任务文件夹，最近的在前。 */
export function taskFoldersFor(db: DatabaseSync, filter: { readonly botId?: string; readonly roomId?: string }, limit = 40): readonly string[] {
  const rows = (
    filter.botId !== undefined
      ? db.prepare("SELECT folder FROM tasks WHERE owner_bot_id = ? AND folder != '' ORDER BY updated_at DESC LIMIT ?").all(filter.botId, limit)
      : db.prepare("SELECT folder FROM tasks WHERE room_id = ? AND parent_id IS NULL AND folder != '' ORDER BY updated_at DESC LIMIT ?").all(filter.roomId ?? '', limit)
  ) as unknown as readonly { readonly folder: string }[]
  return [...new Set(rows.map((row) => row.folder))]
}
