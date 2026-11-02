import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'

export interface LockHolder {
  readonly pid: number
  readonly startedAt: number
}

export interface ProcessLock {
  /** 拿到了：这个进程可以写库、跑任务。 */
  readonly held: boolean
  /** 没拿到时，占着的那个进程。 */
  readonly holder: LockHolder | null
  release(): void
}

function readHolder(path: string): LockHolder | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockHolder>
    return typeof value.pid === 'number' ? { pid: value.pid, startedAt: typeof value.startedAt === 'number' ? value.startedAt : 0 } : null
  } catch {
    return null
  }
}

/** 进程还在吗：发 0 号信号只查不杀；没有权限也说明它在。 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function create(path: string, holder: LockHolder): boolean {
  try {
    const fd = openSync(path, 'wx', 0o600)
    try {
      writeSync(fd, JSON.stringify(holder))
    } finally {
      closeSync(fd)
    }
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}

/**
 * 进程锁：同一份数据只让一个 dsh-bot 写。锁文件里记着进程号和启动时间；
 * 被一个还活着的进程占着就不拿（调用方只读启动），占着的进程已经退出就接过来。
 * 同一个进程里插件重新加载时锁文件还是自己的，直接接着用。
 */
export function acquireLock(path: string, now: number): ProcessLock {
  const mine: LockHolder = { pid: process.pid, startedAt: now }
  const held = (): ProcessLock => ({
    held: true,
    holder: null,
    release: () => {
      // 只删自己写的那份：同一进程里重新加载时，新的一份可能已经写好了。
      const current = readHolder(path)
      if (current?.pid !== mine.pid || current.startedAt !== mine.startedAt) return
      try {
        unlinkSync(path)
      } catch {
        // 已经不在了也算放开了。
      }
    },
  })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (create(path, mine)) return held()
    const holder = readHolder(path)
    if (holder !== null && holder.pid !== mine.pid && alive(holder.pid)) return { held: false, holder, release: () => undefined }
    try {
      unlinkSync(path)
    } catch {
      // 别的进程刚好也在接，下一轮再看。
    }
  }
  const holder = readHolder(path)
  return holder === null || holder.pid === mine.pid ? held() : { held: false, holder, release: () => undefined }
}
