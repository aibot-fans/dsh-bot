import type { DatabaseSync } from 'node:sqlite'
import { readJson, writeJson } from './json.ts'

/**
 * 副作用队列：只存还没做完的对外动作（开会话、交消息、发通知……）。
 * 种类加 key 唯一，同一个 key 再登记时覆盖内容、保留排队位置；generation 每覆盖一次加 1，
 * 正在执行的旧内容做完时不会删掉新内容。做成了删掉那一行，失败按种类退避重试。
 */
export interface EffectRow {
  readonly kind: string
  readonly key: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly seq: number
  readonly generation: number
  readonly attempts: number
  readonly error: string
  readonly due: number
  readonly since: number
}

interface Row {
  readonly kind: string
  readonly key: string
  readonly payload: string
  readonly seq: number
  readonly generation: number
  readonly attempts: number
  readonly error: string
  readonly due: number
  readonly since: number
}

function toEffect(row: Row): EffectRow {
  return { ...row, payload: readJson<Readonly<Record<string, unknown>>>(row.payload, {}) }
}

/** 正在执行的那一行：kind、key、seq、generation 都对上才算它自己（中途被覆盖或重新登记的不动）。 */
export interface EffectIdentity {
  readonly kind: string
  readonly key: string
  readonly seq: number
  readonly generation: number
}

const OWN = 'kind = ? AND key = ? AND seq = ? AND generation = ?'

function own(row: EffectIdentity): readonly [string, string, number, number] {
  return [row.kind, row.key, row.seq, row.generation]
}

export function maxEffectSeq(db: DatabaseSync): number {
  const row = db.prepare('SELECT IFNULL(MAX(seq), 0) AS seq FROM effects').get() as { readonly seq: number } | undefined
  return Number(row?.seq ?? 0)
}

/** 登记或覆盖一行；覆盖时清掉失败次数、马上可以再试。 */
export function upsertEffect(db: DatabaseSync, input: { readonly kind: string; readonly key: string; readonly payload: Readonly<Record<string, unknown>>; readonly seq: number; readonly due: number; readonly now: number }): void {
  db.prepare(
    `INSERT INTO effects (kind, key, payload, seq, due, since) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (kind, key) DO UPDATE SET payload = excluded.payload, generation = generation + 1, attempts = 0, error = '', due = MIN(due, excluded.due)`,
  ).run(input.kind, input.key, writeJson(input.payload), input.seq, input.due, input.now)
}

/**
 * 这一种里排在前面的行。order 是额外的排序表达式（比如按待投消息的优先级），在 seq 之前。
 * ordered 的种类只看最老的那一行，没到时间也挡着后面的。
 */
export function effectRows(db: DatabaseSync, kind: string, options: { readonly ordered: boolean; readonly now: number; readonly limit: number; readonly order?: string }): readonly EffectRow[] {
  const orderBy = options.order === undefined ? 'seq' : `${options.order}, seq`
  const rows = options.ordered
    ? db.prepare(`SELECT * FROM effects WHERE kind = ? ORDER BY ${orderBy} LIMIT 1`).all(kind)
    : db.prepare(`SELECT * FROM effects WHERE kind = ? AND due <= ? ORDER BY ${orderBy} LIMIT ?`).all(kind, options.now, options.limit)
  return (rows as unknown as readonly Row[]).map(toEffect)
}

export function getEffect(db: DatabaseSync, kind: string, key: string): EffectRow | undefined {
  const row = db.prepare('SELECT * FROM effects WHERE kind = ? AND key = ?').get(kind, key) as Row | undefined
  return row === undefined ? undefined : toEffect(row)
}

export function finishEffect(db: DatabaseSync, row: EffectIdentity): void {
  db.prepare(`DELETE FROM effects WHERE ${OWN}`).run(...own(row))
}

/** 现在做不了（没有空名额、会话在恢复）：往后排，不算失败。 */
export function postponeEffect(db: DatabaseSync, row: EffectIdentity, due: number): void {
  db.prepare(`UPDATE effects SET due = ? WHERE ${OWN}`).run(due, ...own(row))
}

export function failEffect(db: DatabaseSync, row: EffectIdentity, error: string, due: number): void {
  db.prepare(`UPDATE effects SET attempts = attempts + 1, error = ?, due = ? WHERE ${OWN}`).run(error.slice(0, 1000), due, ...own(row))
}

export function cancelEffect(db: DatabaseSync, kind: string, key: string): void {
  db.prepare('DELETE FROM effects WHERE kind = ? AND key = ?').run(kind, key)
}

/** 往后排着的（没失败过的）马上可以再试：名额空出来时用。 */
export function wakeEffects(db: DatabaseSync, kind: string, now: number): void {
  db.prepare('UPDATE effects SET due = ? WHERE kind = ? AND attempts = 0 AND due > ?').run(now, kind, now)
}

/** 你点了“重试”：失败次数清零、马上再试。 */
export function retryEffect(db: DatabaseSync, kind: string, key: string, now: number): boolean {
  const result = db.prepare("UPDATE effects SET attempts = 0, error = '', due = ? WHERE kind = ? AND key = ?").run(now, kind, key)
  return Number(result.changes) > 0
}

export function listEffects(db: DatabaseSync, kind?: string): readonly EffectRow[] {
  const rows = kind === undefined ? db.prepare('SELECT * FROM effects ORDER BY seq').all() : db.prepare('SELECT * FROM effects WHERE kind = ? ORDER BY seq').all(kind)
  return (rows as unknown as readonly Row[]).map(toEffect)
}
