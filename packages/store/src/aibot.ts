import type { DatabaseSync } from 'node:sqlite'

/**
 * aibot 接入的设备：安装码（等同密码，拿着它能取回同一把 Key）和 Key。
 * 只存在这张表里，不进设置、运行状态、日志，也不出现在任何接口的返回里。
 */
export interface AibotDevice {
  readonly installSecret: string
  /** 还没开通成功时是空串。 */
  readonly apiKey: string
  readonly deviceId: string
  /** aibot 停用了这台设备的时间；恢复后清空。 */
  readonly disabledAt: number | null
}

interface DeviceRow {
  readonly install_secret: string
  readonly api_key: string
  readonly device_id: string
  readonly disabled_at: number | null
}

export function readAibotDevice(db: DatabaseSync): AibotDevice | undefined {
  const row = db.prepare('SELECT install_secret, api_key, device_id, disabled_at FROM aibot_device WHERE id = 1').get() as DeviceRow | undefined
  if (row === undefined) return undefined
  return { installSecret: row.install_secret, apiKey: row.api_key, deviceId: row.device_id, disabledAt: row.disabled_at }
}

/** 第一次启动时记下安装码；已经有了就保留原来的（同一个安装码才能取回同一把 Key）。 */
export function ensureAibotDevice(db: DatabaseSync, installSecret: string, now: number): AibotDevice {
  db.prepare('INSERT INTO aibot_device (id, install_secret, created_at, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT (id) DO NOTHING').run(installSecret, now, now)
  const device = readAibotDevice(db)
  if (device === undefined) throw new Error('记下 aibot 安装码后读不回来')
  return device
}

export function saveAibotKey(db: DatabaseSync, apiKey: string, deviceId: string, now: number): void {
  db.prepare('UPDATE aibot_device SET api_key = ?, device_id = ?, updated_at = ? WHERE id = 1').run(apiKey, deviceId, now)
}

export function setAibotDisabled(db: DatabaseSync, disabledAt: number | null, now: number): void {
  db.prepare('UPDATE aibot_device SET disabled_at = ?, updated_at = ? WHERE id = 1').run(disabledAt, now)
}
