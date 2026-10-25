/** JSON 列的读写。坏数据不抛错，退回给定的默认值，避免一行坏数据拖垮整个页面。 */

export function readJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === '') return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

export function writeJson(value: unknown): string {
  return JSON.stringify(value)
}

/** SQLite 的 0/1 转成布尔。 */
export function flag(value: number | bigint | null | undefined): boolean {
  return value !== null && value !== undefined && Number(value) !== 0
}

/** 在一个事务里执行一组写入；出错回滚并重新抛出。 */
export function transaction<T>(db: { exec(sql: string): void }, work: () => T): T {
  db.exec('BEGIN')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
