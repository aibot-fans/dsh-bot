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

type Exec = { exec(sql: string): void }

interface TxState {
  depth: number
  /** 每一层登记的提交后回调；内层成功时并进外层，回滚时丢掉。 */
  readonly hooks: (() => void)[][]
}

const states = new WeakMap<object, TxState>()

let reportHookError: (error: unknown) => void = (error) => console.error('[pod] 提交后回调出错', error)

/** 提交后回调出错时怎么报：事务已经提交了，不能再抛给调用的一方。 */
export function onAfterCommitError(report: (error: unknown) => void): void {
  reportHookError = report
}

/**
 * 在一个事务里执行一组写入；出错回滚并重新抛出。
 * 可以嵌套：里面那层用保存点，出错只回滚它自己；提交后回调等最外层提交了才执行。
 */
export function transaction<T>(db: Exec, work: () => T): T {
  const state = states.get(db) ?? { depth: 0, hooks: [] }
  states.set(db, state)
  const level = state.depth
  const savepoint = `pod_tx_${level}`
  db.exec(level === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`)
  state.depth += 1
  state.hooks.push([])
  let result: T
  try {
    result = work()
  } catch (error) {
    state.depth -= 1
    state.hooks.pop()
    db.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
    throw error
  }
  state.depth -= 1
  const mine = state.hooks.pop() ?? []
  if (level > 0) {
    db.exec(`RELEASE ${savepoint}`)
    state.hooks[state.hooks.length - 1]?.push(...mine)
    return result
  }
  db.exec('COMMIT')
  for (const hook of mine) {
    try {
      hook()
    } catch (error) {
      reportHookError(error)
    }
  }
  return result
}

/** 现在是不是在事务里。 */
export function inTransaction(db: Exec): boolean {
  return (states.get(db)?.depth ?? 0) > 0
}

/** 提交后再做的事（推页面事件、唤醒副作用队列）；不在事务里就马上做，事务回滚就不做。 */
export function afterCommit(db: Exec, hook: () => void): void {
  const state = states.get(db)
  const hooks = state === undefined || state.depth === 0 ? undefined : state.hooks[state.hooks.length - 1]
  if (hooks === undefined) {
    hook()
    return
  }
  hooks.push(hook)
}
