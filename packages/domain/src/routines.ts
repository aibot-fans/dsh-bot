/** 主动行为只有两种：定时例程和盯网页。都由 Pod 自己的调度器运行。 */

export type RoutineKind = 'cron' | 'watch'

export interface Routine {
  readonly id: string
  readonly title: string
  readonly kind: RoutineKind
  /** 定时例程的 cron 表达式（按 timezone 求值）。只跑一次的例程是空的。 */
  readonly cron: string
  /** 只跑一次的例程：到这个时刻跑一次，跑完就删掉；null 表示按 cron 重复。 */
  readonly runAt: number | null
  readonly timezone: string
  /** 每次运行时交给 bot 的指令。 */
  readonly prompt: string
  readonly botId: string
  /** 结果发到哪个房间；null 表示发到这个 bot 的单聊。 */
  readonly roomId: string | null
  /** 每次运行时要更新的页面；null 表示普通例程。 */
  readonly pageId: string | null
  /** 盯网页：网址、要盯的部分（CSS 选择器，可空）、检查间隔。 */
  readonly url: string
  readonly selector: string
  readonly intervalMinutes: number
  /** 上次读到的内容指纹；没变化就不调用模型。 */
  readonly fingerprint: string
  readonly lastText: string
  /** dsh web 没开时错过的，下次启动后补跑一次。 */
  readonly catchUp: boolean
  /** 用 DeepSeek 模型时放到非高峰时段。 */
  readonly offPeak: boolean
  readonly enabled: boolean
  readonly lastRunAt: number | null
  readonly nextRunAt: number | null
  readonly lastStatus: string
  readonly createdBy: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type NotificationKind = 'task-done' | 'task-failed' | 'task-stalled' | 'wait' | 'approval' | 'routine' | 'weekly' | 'brief' | 'system'

export interface PodNotification {
  readonly id: string
  readonly kind: NotificationKind
  readonly title: string
  readonly body: string
  readonly roomId: string | null
  readonly taskId: string | null
  readonly waitId: string | null
  /** 勿扰时段或房间通知级别压下去的：只进通知中心，不弹提醒。 */
  readonly silent: boolean
  readonly read: boolean
  readonly createdAt: number
}

export const NOTIFICATION_LABELS: Readonly<Record<NotificationKind, string>> = {
  'task-done': '任务完成',
  'task-failed': '任务失败',
  'task-stalled': '停滞提醒',
  wait: '等你处理',
  approval: '等你批准',
  routine: '例程结果',
  weekly: '本周变化',
  brief: '每日简报',
  system: '系统',
}

/** 和“等你处理”有关的通知：房间通知级别设成“只有等你处理”时还会弹。 */
export function isWaitNotification(kind: NotificationKind): boolean {
  return kind === 'wait' || kind === 'approval'
}

export const WATCH_MIN_INTERVAL = 5
export const WATCH_MAX_INTERVAL = 7 * 24 * 60
