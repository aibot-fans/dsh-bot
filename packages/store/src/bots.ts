import type { DatabaseSync } from 'node:sqlite'
import {
  EMPTY_CARD,
  TOOL_PROFILES,
  type Bot,
  type BotCard,
  type BotConfig,
  type BotRole,
  type ModelChoice,
  type PersonaSource,
  type ToolProfile,
} from 'pod-domain'
import { flag, readJson, writeJson } from './json.ts'

interface BotRow {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly title: string
  readonly persona: string
  readonly persona_source: string
  readonly avatar: string
  readonly capabilities: string
  readonly card: string
  readonly model: string | null
  readonly tool_profile: string
  readonly temporary: number
  readonly color: string
  readonly created_at: number
  readonly updated_at: number
  readonly archived_at: number | null
}

function toProfile(value: string): ToolProfile {
  return (TOOL_PROFILES as readonly string[]).includes(value) ? (value as ToolProfile) : 'exec'
}

function toSource(value: string): PersonaSource {
  return value === 'seed' || value === 'auto' ? value : 'user'
}

function toBot(row: BotRow): Bot {
  return {
    id: row.id,
    name: row.name,
    role: row.role === 'lead' ? 'lead' : 'member',
    title: row.title,
    persona: row.persona,
    personaSource: toSource(row.persona_source),
    avatar: row.avatar,
    capabilities: readJson<readonly string[]>(row.capabilities, []),
    card: { ...EMPTY_CARD, ...readJson<Partial<BotCard>>(row.card, {}) },
    model: readJson<ModelChoice | null>(row.model, null),
    toolProfile: toProfile(row.tool_profile),
    temporary: flag(row.temporary),
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  }
}

const VISIBLE = 'purged_at IS NULL'

/** 全部没彻底删除的 bot，含回收站里的；主管排第一，其余按创建时间。 */
export function listBots(db: DatabaseSync): readonly Bot[] {
  const rows = db
    .prepare(`SELECT * FROM bots WHERE ${VISIBLE} ORDER BY role = 'lead' DESC, created_at ASC`)
    .all() as unknown as readonly BotRow[]
  return rows.map(toBot)
}

export function getBot(db: DatabaseSync, id: string): Bot | undefined {
  const row = db.prepare(`SELECT * FROM bots WHERE id = ? AND ${VISIBLE}`).get(id) as BotRow | undefined
  return row === undefined ? undefined : toBot(row)
}

export interface NewBot {
  readonly id: string
  readonly role: BotRole
  readonly config: BotConfig
  readonly personaSource: PersonaSource
  /** 名字颜色（色板里的一个名字）；不给就是空的，之后再配。 */
  readonly color?: string
  readonly now: number
}

export function insertBot(db: DatabaseSync, input: NewBot): Bot {
  const { config } = input
  db.prepare(
    `INSERT INTO bots (id, name, role, title, persona, persona_source, avatar, capabilities, card, model,
       tool_profile, temporary, color, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    config.name,
    input.role,
    config.title,
    config.persona,
    input.personaSource,
    config.avatar,
    writeJson(config.capabilities),
    writeJson(config.card),
    config.model === null ? null : writeJson(config.model),
    config.toolProfile,
    config.temporary ? 1 : 0,
    input.color ?? '',
    input.now,
    input.now,
  )
  const bot = getBot(db, input.id)
  if (bot === undefined) throw new Error(`新建 bot ${input.id} 后读不回来`)
  return bot
}

/** 整体写回一份配置；调用方负责先合并好。 */
export function writeBotConfig(
  db: DatabaseSync,
  id: string,
  config: BotConfig,
  personaSource: PersonaSource,
  now: number,
): Bot | undefined {
  db.prepare(
    `UPDATE bots SET name = ?, title = ?, persona = ?, persona_source = ?, avatar = ?, capabilities = ?, card = ?,
       model = ?, tool_profile = ?, temporary = ?, updated_at = ?
     WHERE id = ? AND ${VISIBLE}`,
  ).run(
    config.name,
    config.title,
    config.persona,
    personaSource,
    config.avatar,
    writeJson(config.capabilities),
    writeJson(config.card),
    config.model === null ? null : writeJson(config.model),
    config.toolProfile,
    config.temporary ? 1 : 0,
    now,
    id,
  )
  return getBot(db, id)
}

/** 只改头像、不动更新时间：给老 bot 配小图标时用，不算一次配置修改。 */
export function setBotAvatar(db: DatabaseSync, id: string, avatar: string): void {
  db.prepare('UPDATE bots SET avatar = ? WHERE id = ?').run(avatar, id)
}

/** 只改名字颜色：不算一次配置修改，不进版本记录。 */
export function setBotColor(db: DatabaseSync, id: string, color: string): void {
  db.prepare('UPDATE bots SET color = ? WHERE id = ?').run(color, id)
}

/** 归档（进回收站）或恢复；主管不会走到这里。返回是否真的改了。 */
export function setBotArchived(db: DatabaseSync, id: string, archivedAt: number | null, now: number): boolean {
  const result = db
    .prepare(`UPDATE bots SET archived_at = ?, updated_at = ? WHERE id = ? AND role = 'member' AND ${VISIBLE}`)
    .run(archivedAt, now, id)
  return Number(result.changes) > 0
}

/** 回收站里超过期限的 bot 标为彻底删除：不再显示也不能恢复，历史消息里的名字还在。 */
export function purgeArchivedBots(db: DatabaseSync, before: number, now: number): number {
  const result = db
    .prepare(`UPDATE bots SET purged_at = ? WHERE archived_at IS NOT NULL AND archived_at < ? AND ${VISIBLE}`)
    .run(now, before)
  return Number(result.changes)
}

/** 名字查 bot（不区分大小写，含回收站），给主管按名字找人用。 */
export function findBotByName(db: DatabaseSync, name: string): Bot | undefined {
  const row = db
    .prepare(`SELECT * FROM bots WHERE lower(name) = lower(?) AND ${VISIBLE} ORDER BY archived_at IS NULL DESC LIMIT 1`)
    .get(name) as BotRow | undefined
  return row === undefined ? undefined : toBot(row)
}
