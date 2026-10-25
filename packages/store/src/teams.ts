import type { DatabaseSync } from 'node:sqlite'
import type { Autonomy, ModelChoice, Team } from 'pod-domain'
import { flag, readJson, writeJson } from './json.ts'

interface TeamRow {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly leader_bot_id: string
  readonly autonomy: string | null
  readonly model: string | null
  readonly room_id: string | null
  readonly temporary: number
  readonly created_at: number
  readonly updated_at: number
  readonly archived_at: number | null
}

function members(db: DatabaseSync, teamId: string): readonly string[] {
  const rows = db.prepare('SELECT bot_id FROM team_members WHERE team_id = ? ORDER BY joined_at').all(teamId) as unknown as readonly {
    readonly bot_id: string
  }[]
  return rows.map((row) => row.bot_id)
}

function toTeam(db: DatabaseSync, row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    leaderBotId: row.leader_bot_id,
    memberIds: members(db, row.id),
    autonomy: row.autonomy === 'careful' || row.autonomy === 'hands-off' ? (row.autonomy as Autonomy) : null,
    model: readJson<ModelChoice | null>(row.model, null),
    roomId: row.room_id,
    temporary: flag(row.temporary),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  }
}

export function listTeams(db: DatabaseSync): readonly Team[] {
  const rows = db.prepare('SELECT * FROM teams WHERE purged_at IS NULL ORDER BY created_at').all() as unknown as readonly TeamRow[]
  return rows.map((row) => toTeam(db, row))
}

export function getTeam(db: DatabaseSync, id: string): Team | undefined {
  const row = db.prepare('SELECT * FROM teams WHERE id = ? AND purged_at IS NULL').get(id) as TeamRow | undefined
  return row === undefined ? undefined : toTeam(db, row)
}

export interface NewTeam {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly leaderBotId: string
  readonly memberIds: readonly string[]
  readonly temporary: boolean
  readonly now: number
}

export function insertTeam(db: DatabaseSync, input: NewTeam): Team {
  db.prepare(
    'INSERT INTO teams (id, name, description, leader_bot_id, temporary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(input.id, input.name, input.description, input.leaderBotId, input.temporary ? 1 : 0, input.now, input.now)
  setTeamMembers(db, input.id, [input.leaderBotId, ...input.memberIds], input.now)
  const team = getTeam(db, input.id)
  if (team === undefined) throw new Error(`新建团队 ${input.id} 后读不回来`)
  return team
}

export interface TeamPatch {
  readonly name?: string
  readonly description?: string
  readonly leaderBotId?: string
  readonly autonomy?: Autonomy | null
  readonly model?: ModelChoice | null
  readonly roomId?: string | null
  readonly temporary?: boolean
  readonly archivedAt?: number | null
}

export function updateTeam(db: DatabaseSync, id: string, patch: TeamPatch, now: number): Team | undefined {
  const current = getTeam(db, id)
  if (current === undefined) return undefined
  const next = { ...current, ...patch }
  db.prepare(
    'UPDATE teams SET name = ?, description = ?, leader_bot_id = ?, autonomy = ?, model = ?, room_id = ?, temporary = ?, archived_at = ?, updated_at = ? WHERE id = ?',
  ).run(
    next.name,
    next.description,
    next.leaderBotId,
    next.autonomy,
    next.model === null ? null : writeJson(next.model),
    next.roomId,
    next.temporary ? 1 : 0,
    next.archivedAt,
    now,
    id,
  )
  return getTeam(db, id)
}

/** 整体替换成员名单（组长一定在里面）。 */
export function setTeamMembers(db: DatabaseSync, teamId: string, botIds: readonly string[], now: number): void {
  db.prepare('DELETE FROM team_members WHERE team_id = ?').run(teamId)
  const statement = db.prepare('INSERT OR IGNORE INTO team_members (team_id, bot_id, joined_at) VALUES (?, ?, ?)')
  for (const [index, botId] of [...new Set(botIds)].entries()) statement.run(teamId, botId, now + index)
}

export function teamsOfBot(db: DatabaseSync, botId: string): readonly string[] {
  const rows = db.prepare('SELECT team_id FROM team_members WHERE bot_id = ?').all(botId) as unknown as readonly { readonly team_id: string }[]
  return rows.map((row) => row.team_id)
}

export function purgeArchivedTeams(db: DatabaseSync, before: number, now: number): number {
  const result = db.prepare('UPDATE teams SET purged_at = ? WHERE archived_at IS NOT NULL AND archived_at < ? AND purged_at IS NULL').run(now, before)
  return Number(result.changes)
}
