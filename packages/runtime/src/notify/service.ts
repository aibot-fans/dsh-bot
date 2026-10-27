import type { DatabaseSync } from 'node:sqlite'
import {
  NOTIFICATION_LABELS,
  WAIT_KIND_LABELS,
  inDailyRange,
  isWaitNotification,
  newId,
  t,
  truncate,
  type NotificationKind,
  type PodNotification,
  type PodSettings,
  type Room,
  type Task,
  type Wait,
} from 'pod-domain'
import { bumpNotification, insertNotification, listNotifications, markNotificationsRead, recentNotification, unreadNotifications } from 'pod-store'
import type { PodBus } from '../core/bus.ts'

/** 同一个任务这么短的时间内的同类事件合成一条。 */
const MERGE_WINDOW_MS = 10 * 60_000

export interface NotifyDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly settings: () => PodSettings
  readonly room: (roomId: string) => Room | undefined
  readonly now: () => number
}

export interface NotifyInput {
  readonly kind: NotificationKind
  readonly title: string
  readonly body: string
  readonly roomId?: string | null
  readonly taskId?: string | null
  readonly waitId?: string | null
}

/**
 * 通知中心：任务完成、失败、等你处理、停滞提醒、例程结果、本周变化。
 * 按房间设通知级别（全部、只有等你处理、关闭），勿扰时段只进通知中心、不弹提醒。
 */
export class NotificationService {
  private readonly deps: NotifyDeps

  constructor(deps: NotifyDeps) {
    this.deps = deps
  }

  private silent(input: NotifyInput): boolean {
    const settings = this.deps.settings()
    const now = this.deps.now()
    if (settings.quietHours.enabled && inDailyRange(now, settings.timezone, settings.quietHours.start, settings.quietHours.end)) return true
    const room = input.roomId === null || input.roomId === undefined ? undefined : this.deps.room(input.roomId)
    if (room === undefined) return false
    if (room.notifyLevel === 'off') return true
    if (room.notifyLevel === 'waits') return !isWaitNotification(input.kind)
    return false
  }

  notify(input: NotifyInput): PodNotification {
    const now = this.deps.now()
    const silent = this.silent(input)
    const recent = input.taskId === undefined || input.taskId === null ? undefined : recentNotification(this.deps.db, input.kind, input.taskId, now - MERGE_WINDOW_MS)
    if (recent !== undefined && isWaitNotification(input.kind)) {
      const body = truncate(`${recent.body}\n${input.body}`, 400)
      bumpNotification(this.deps.db, recent.id, body, now)
      const merged: PodNotification = { ...recent, body, createdAt: now }
      this.deps.bus.emit({ type: 'notifications' })
      if (!silent) this.deps.bus.emit({ type: 'notify', notification: merged })
      return merged
    }
    const notification = insertNotification(this.deps.db, {
      id: newId('notif'),
      kind: input.kind,
      title: input.title,
      body: truncate(input.body, 400),
      roomId: input.roomId ?? null,
      taskId: input.taskId ?? null,
      waitId: input.waitId ?? null,
      silent,
      createdAt: now,
    })
    this.deps.bus.emit({ type: 'notifications' })
    if (!silent) this.deps.bus.emit({ type: 'notify', notification })
    return notification
  }

  task(task: Task, event: 'done' | 'failed' | 'stalled'): void {
    const kind: NotificationKind = event === 'done' ? 'task-done' : event === 'failed' ? 'task-failed' : 'task-stalled'
    const body = event === 'done' ? (task.result?.summary.split('\n')[0] ?? '') : task.note
    this.notify({ kind, title: t('{label}：{title}', { label: t(NOTIFICATION_LABELS[kind]), title: task.title }), body, roomId: task.roomId, taskId: task.rootId })
  }

  wait(wait: Wait): void {
    if (wait.status === 'bypassed') return
    this.notify({ kind: wait.kind === 'approval' ? 'approval' : 'wait', title: t('{label}：{title}', { label: t(WAIT_KIND_LABELS[wait.kind]), title: wait.title }), body: wait.detail, roomId: wait.roomId, taskId: wait.rootId, waitId: wait.id })
  }

  list(limit = 100): readonly PodNotification[] {
    return listNotifications(this.deps.db, limit)
  }

  unread(): number {
    return unreadNotifications(this.deps.db)
  }

  markRead(ids: readonly string[] | 'all'): void {
    markNotificationsRead(this.deps.db, ids)
    this.deps.bus.emit({ type: 'notifications' })
  }
}
