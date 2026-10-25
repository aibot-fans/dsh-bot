import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { localDate } from 'pod-domain'
import { backupDatabase, readState, writeState } from 'pod-store'

/** 每天备份保留的份数。 */
export const BACKUP_KEEP = 7

/** 回收站保留天数。 */
export const RECYCLE_DAYS = 30

export interface DailyTask {
  readonly name: string
  run(now: number): void | Promise<void>
}

/**
 * 每天一次的维护：备份数据库、清理回收站里过期的东西。
 * 每小时检查一次“今天做过没有”，所以 dsh web 晚上没开也会在第二天启动后补上。
 */
export class Maintenance {
  private readonly db: DatabaseSync
  private readonly dataRoot: string
  private readonly timezone: () => string
  private readonly tasks: DailyTask[] = []
  private readonly warn: (message: string) => void

  constructor(db: DatabaseSync, dataRoot: string, timezone: () => string, warn: (message: string) => void) {
    this.db = db
    this.dataRoot = dataRoot
    this.timezone = timezone
    this.warn = warn
  }

  /** 注册一个每天跑一次的任务；各模块（回收站、记忆整理……）自己挂进来。 */
  addDaily(task: DailyTask): () => void {
    this.tasks.push(task)
    return () => {
      const index = this.tasks.indexOf(task)
      if (index >= 0) this.tasks.splice(index, 1)
    }
  }

  async backupNow(now: number): Promise<string> {
    const target = await backupDatabase(this.db, join(this.dataRoot, 'backups'), localDate(now, this.timezone()), BACKUP_KEEP)
    writeState(this.db, 'maintenance.lastBackupAt', now)
    return target
  }

  lastBackupAt(): number | null {
    return readState<number | null>(this.db, 'maintenance.lastBackupAt', null)
  }

  /** 今天还没做过就做一遍；返回是否真的做了。 */
  async tick(now: number): Promise<boolean> {
    const today = localDate(now, this.timezone())
    if (readState<string>(this.db, 'maintenance.lastDay', '') === today) return false
    try {
      await this.backupNow(now)
    } catch (error) {
      this.warn(`每日备份失败：${error instanceof Error ? error.message : String(error)}`)
    }
    for (const task of [...this.tasks]) {
      try {
        await task.run(now)
      } catch (error) {
        this.warn(`每日维护「${task.name}」失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    writeState(this.db, 'maintenance.lastDay', today)
    return true
  }
}
