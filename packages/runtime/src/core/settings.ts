import type { DatabaseSync } from 'node:sqlite'
import { applySettingsPatch, normalizeSettings, ok, type PodResult, type PodSettings } from 'pod-domain'
import { readSettingsRows, writeSettingsRows } from 'pod-store'
import type { PodBus } from './bus.ts'

type SettingsListener = (next: PodSettings, previous: PodSettings) => void

/** 全局设置：内存里一份不可变的快照，改动先落库再替换快照，并通知页面和订阅的服务。 */
export class SettingsService {
  private current: PodSettings
  private readonly listeners = new Set<SettingsListener>()
  private readonly db: DatabaseSync
  private readonly bus: PodBus
  private readonly now: () => number

  constructor(db: DatabaseSync, bus: PodBus, now: () => number) {
    this.db = db
    this.bus = bus
    this.now = now
    this.current = normalizeSettings(readSettingsRows(db))
  }

  get(): PodSettings {
    return this.current
  }

  update(input: unknown): PodResult<PodSettings> {
    const result = applySettingsPatch(this.current, input)
    if (!result.ok) return result
    const previous = this.current
    const next = result.value
    const changed = Object.fromEntries(
      Object.entries(next).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(previous[key as keyof PodSettings])),
    )
    if (Object.keys(changed).length === 0) return ok(previous)
    writeSettingsRows(this.db, changed, this.now())
    this.current = next
    this.bus.emit({ type: 'settings' })
    for (const listener of this.listeners) listener(next, previous)
    return ok(next)
  }

  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
