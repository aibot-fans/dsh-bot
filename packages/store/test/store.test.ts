import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { appendAudit, listAudit } from '../src/audit.ts'
import { getBot, insertBot, listBots, setBotArchived, writeBotConfig } from '../src/bots.ts'
import { migrate, SCHEMA_VERSION } from '../src/migrations.ts'
import { appendBotVersion, listBotVersions } from '../src/versions.ts'

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

const config = {
  name: '研究员',
  title: '研究员',
  persona: '负责调研',
  avatar: '',
  capabilities: ['调研'],
  card: { duties: '查资料', strengths: '', notResponsible: '', askWho: '' },
  model: null,
  toolProfile: 'research' as const,
  temporary: true,
}

test('迁移到最新版本，重复执行不报错', () => {
  const db = freshDb()
  migrate(db)
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  assert.equal(row.user_version, SCHEMA_VERSION)
})

test('bot：写入、读回、改配置、归档', () => {
  const db = freshDb()
  const bot = insertBot(db, { id: 'bot_a', role: 'member', config, personaSource: 'user', now: 1 })
  assert.deepEqual(bot.capabilities, ['调研'])
  assert.equal(bot.temporary, true)
  const updated = writeBotConfig(db, 'bot_a', { ...config, persona: '新人设', model: { provider: 'deepseek', model: 'x' } }, 'auto', 2)
  assert.equal(updated?.persona, '新人设')
  assert.equal(updated?.personaSource, 'auto')
  assert.deepEqual(updated?.model, { provider: 'deepseek', model: 'x' })
  assert.equal(setBotArchived(db, 'bot_a', 3, 3), true)
  assert.equal(getBot(db, 'bot_a')?.archivedAt, 3)
  assert.equal(listBots(db).length, 1)
})

test('配置版本：版本号递增', () => {
  const db = freshDb()
  insertBot(db, { id: 'bot_a', role: 'member', config, personaSource: 'user', now: 1 })
  appendBotVersion(db, { id: 'v1', botId: 'bot_a', config, source: 'user', reason: '新建', now: 1 })
  const second = appendBotVersion(db, { id: 'v2', botId: 'bot_a', config: { ...config, persona: 'x' }, source: 'auto', reason: '调整', now: 2 })
  assert.equal(second.version, 2)
  assert.deepEqual(listBotVersions(db, 'bot_a').map((version) => version.version), [2, 1])
})

test('审计只能追加', () => {
  const db = freshDb()
  appendAudit(db, { kind: 'test', actor: 'owner', subject: 's', detail: { a: 1 }, now: 1 })
  assert.equal(listAudit(db, { limit: 10 }).length, 1)
  assert.throws(() => db.exec('DELETE FROM audit'))
  assert.throws(() => db.exec("UPDATE audit SET kind = 'x'"))
})
