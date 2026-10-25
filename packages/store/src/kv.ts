import type { DatabaseSync } from 'node:sqlite'
import { readJson, writeJson } from './json.ts'

/** 设置：用户能改的配置，一项一行，值是 JSON。 */
export function readSettingsRows(db: DatabaseSync): Readonly<Record<string, unknown>> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as unknown as readonly {
    readonly key: string
    readonly value: string
  }[]
  return Object.fromEntries(rows.map((row) => [row.key, readJson<unknown>(row.value, undefined)]))
}

export function writeSettingsRows(db: DatabaseSync, values: Readonly<Record<string, unknown>>, now: number): void {
  const statement = db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  )
  for (const [key, value] of Object.entries(values)) statement.run(key, writeJson(value), now)
}

/** 运行状态：上次备份时间、上次整理时间这类 Pod 自己记的值，不给用户改。 */
export function readState<T>(db: DatabaseSync, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM state WHERE key = ?').get(key) as { readonly value: string } | undefined
  return row === undefined ? fallback : readJson<T>(row.value, fallback)
}

export function writeState(db: DatabaseSync, key: string, value: unknown): void {
  db.prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(
    key,
    writeJson(value),
  )
}
