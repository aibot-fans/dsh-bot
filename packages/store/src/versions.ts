import type { DatabaseSync } from 'node:sqlite'
import type { BotConfig } from 'pod-domain'
import { readJson, writeJson } from './json.ts'

/** 谁改的：你、主管（组织工具）、自我优化，或者回滚。 */
export type VersionSource = 'user' | 'lead' | 'auto' | 'rollback' | 'seed'

export interface BotVersion {
  readonly id: string
  readonly botId: string
  readonly version: number
  readonly config: BotConfig
  readonly source: VersionSource
  readonly reason: string
  readonly createdAt: number
}

interface VersionRow {
  readonly id: string
  readonly bot_id: string
  readonly version: number
  readonly config: string
  readonly source: string
  readonly reason: string
  readonly created_at: number
}

const SOURCES: readonly VersionSource[] = ['user', 'lead', 'auto', 'rollback', 'seed']

function toVersion(row: VersionRow): BotVersion {
  return {
    id: row.id,
    botId: row.bot_id,
    version: row.version,
    config: readJson<BotConfig>(row.config, {} as BotConfig),
    source: (SOURCES as readonly string[]).includes(row.source) ? (row.source as VersionSource) : 'user',
    reason: row.reason,
    createdAt: row.created_at,
  }
}

export function listBotVersions(db: DatabaseSync, botId: string): readonly BotVersion[] {
  const rows = db
    .prepare('SELECT * FROM bot_versions WHERE bot_id = ? ORDER BY version DESC')
    .all(botId) as unknown as readonly VersionRow[]
  return rows.map(toVersion)
}

export function getBotVersion(db: DatabaseSync, botId: string, version: number): BotVersion | undefined {
  const row = db.prepare('SELECT * FROM bot_versions WHERE bot_id = ? AND version = ?').get(botId, version) as
    | VersionRow
    | undefined
  return row === undefined ? undefined : toVersion(row)
}

export interface NewBotVersion {
  readonly id: string
  readonly botId: string
  readonly config: BotConfig
  readonly source: VersionSource
  readonly reason: string
  readonly now: number
}

/** 追加一版，版本号自动加一。 */
export function appendBotVersion(db: DatabaseSync, input: NewBotVersion): BotVersion {
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS latest FROM bot_versions WHERE bot_id = ?').get(
    input.botId,
  ) as { readonly latest: number }
  const version = row.latest + 1
  db.prepare(
    'INSERT INTO bot_versions (id, bot_id, version, config, source, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(input.id, input.botId, version, writeJson(input.config), input.source, input.reason, input.now)
  return {
    id: input.id,
    botId: input.botId,
    version,
    config: input.config,
    source: input.source,
    reason: input.reason,
    createdAt: input.now,
  }
}
