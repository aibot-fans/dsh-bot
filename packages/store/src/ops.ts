import type { DatabaseSync } from 'node:sqlite'

/**
 * 操作 id：引擎的每个命令带一个，同一个 id 再来一次什么都不做，直接拿回第一次的结果。
 * 结果存成命令自己定的一小段文字（多半是建出来的那条记录的 id）。
 */
export function opResult(db: DatabaseSync, id: string): string | undefined {
  const row = db.prepare('SELECT result FROM ops WHERE id = ?').get(id) as { readonly result: string } | undefined
  return row?.result
}

export function recordOp(db: DatabaseSync, id: string, command: string, result: string, now: number): void {
  db.prepare('INSERT OR IGNORE INTO ops (id, command, result, created_at) VALUES (?, ?, ?, ?)').run(id, command, result, now)
}

/** 太久以前的操作 id 不会再重放，清掉。 */
export function pruneOps(db: DatabaseSync, before: number): number {
  return Number(db.prepare('DELETE FROM ops WHERE created_at < ?').run(before).changes)
}
