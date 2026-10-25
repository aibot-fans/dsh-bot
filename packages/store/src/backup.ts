import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { backup, type DatabaseSync } from 'node:sqlite'

const BACKUP_PATTERN = /^pod-(\d{4}-\d{2}-\d{2})\.db$/

/**
 * 用 SQLite 的在线备份接口把库复制一份，再只保留最近 keep 份。
 * 同一天重复调用会覆盖当天那份。
 * @param day - 本地日期 YYYY-MM-DD，决定文件名。
 * @returns 备份文件的绝对路径。
 */
export async function backupDatabase(db: DatabaseSync, dir: string, day: string, keep: number): Promise<string> {
  mkdirSync(dir, { recursive: true })
  const target = join(dir, `pod-${day}.db`)
  rmSync(target, { force: true })
  await backup(db, target)
  const stale = readdirSync(dir)
    .filter((name) => BACKUP_PATTERN.test(name))
    .sort()
    .reverse()
    .slice(keep)
  for (const name of stale) rmSync(join(dir, name), { force: true })
  return target
}

export function listBackups(dir: string): readonly string[] {
  try {
    return readdirSync(dir)
      .filter((name) => BACKUP_PATTERN.test(name))
      .sort()
      .reverse()
  } catch {
    return []
  }
}
