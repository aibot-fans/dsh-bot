import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from './migrations.ts'

/**
 * 打开 Pod 的数据库并升到最新表结构。
 * WAL 让页面读和 bot 写互不阻塞；外键保证单聊总能找到所属的 bot。
 * @param file - 数据库文件的绝对路径，父目录不存在时会创建。
 */
export function openDatabase(file: string): DatabaseSync {
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  migrate(db)
  return db
}
