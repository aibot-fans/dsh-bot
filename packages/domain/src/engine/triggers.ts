import { describeCron, nextCronRun, parseCron } from '../cron.ts'
import { t } from '../i18n.ts'
import { formatLocal } from '../time.ts'

/**
 * 触发器：任务的属性，到点或遇事时叫醒任务（同一个任务会话再开一次执行）。
 * 时间：某个时刻、cron（每天、每周、每隔多久都写成 cron）；事件：某个任务就绪或结束、页面变了。
 */
export type TriggerSpec =
  | { readonly kind: 'at'; readonly at: number }
  | { readonly kind: 'cron'; readonly cron: string }
  | { readonly kind: 'task'; readonly taskId: string; readonly on: 'ready' | 'ended' }
  | { readonly kind: 'page'; readonly url: string; readonly selector: string; readonly minutes: number }

/** 谁定的、做什么用：例程（常开任务的时间表）、每日简报、任务会话给自己定的叫醒、前台开任务时带的。 */
export type TriggerSource = 'routine' | 'brief' | 'wake' | 'open'

export interface Trigger {
  readonly id: string
  readonly taskId: string
  readonly spec: TriggerSpec
  readonly timezone: string
  /** 叫醒时带给任务的一句话。 */
  readonly note: string
  readonly nextAt: number | null
  readonly lastAt: number | null
  /** 你暂停了它就是 false；暂停的照样挂在任务上。 */
  readonly enabled: boolean
  /** 关掉了（只触发一次的触发过了、任务结束了、被删了）。 */
  readonly closedAt: number | null
  /** 来源、错峰、补跑、盯网页的指纹、上次结果这类附带的状态。 */
  readonly state: Readonly<Record<string, unknown>>
  readonly createdBy: string
  readonly createdAt: number
  readonly updatedAt: number
}

/** 任务卡上的一行：最近要叫醒的那个触发器。 */
export interface TriggerSummary {
  readonly text: string
  readonly nextAt: number | null
  readonly enabled: boolean
  /** 任务上挂着几个。 */
  readonly count: number
}

/** 盯网页最少隔几分钟、最多隔几分钟（7 天）。 */
export const PAGE_MIN_MINUTES = 5
export const PAGE_MAX_MINUTES = 7 * 24 * 60

export function triggerSource(trigger: Pick<Trigger, 'state'>): TriggerSource {
  const source = trigger.state.source
  return source === 'routine' || source === 'brief' || source === 'wake' ? source : 'open'
}

/** 会一直触发下去的（cron、盯网页）；只触发一次的是某个时刻和等某个任务。 */
export function recurring(spec: TriggerSpec): boolean {
  return spec.kind === 'cron' || spec.kind === 'page'
}

/** 下一次到点；事件触发器和过了的时刻没有下一次。 */
export function nextTriggerAt(spec: TriggerSpec, timezone: string, after: number): number | null {
  switch (spec.kind) {
    case 'at':
      return spec.at > after ? spec.at : null
    case 'cron': {
      const schedule = parseCron(spec.cron)
      return typeof schedule === 'string' ? null : (nextCronRun(schedule, after, timezone) ?? null)
    }
    case 'page':
      return after + spec.minutes * 60_000
    case 'task':
      return null
  }
}

/** 一句话说清什么时候叫醒：「每天 09:00」「11月3日 09:00 一次」「t41 就绪后」「每 60 分钟看一次 https://…」。 */
export function describeTrigger(spec: TriggerSpec, timezone: string, taskTitle?: string): string {
  switch (spec.kind) {
    case 'at':
      return t('{time} 一次', { time: formatLocal(spec.at, timezone) })
    case 'cron':
      return describeCron(spec.cron)
    case 'task': {
      const name = taskTitle === undefined ? spec.taskId : t('「{title}」', { title: taskTitle })
      return spec.on === 'ready' ? t('{name}就绪后', { name }) : t('{name}结束后', { name })
    }
    case 'page':
      return t('每 {minutes} 分钟看一次 {url}', { minutes: spec.minutes, url: spec.url })
  }
}

/** 读存下来的 spec；认不出的返回 undefined。 */
export function readTriggerSpec(value: unknown): TriggerSpec | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Readonly<Record<string, unknown>>
  switch (record.kind) {
    case 'at':
      return typeof record.at === 'number' ? { kind: 'at', at: record.at } : undefined
    case 'cron':
      return typeof record.cron === 'string' ? { kind: 'cron', cron: record.cron } : undefined
    case 'task':
      return typeof record.taskId === 'string' ? { kind: 'task', taskId: record.taskId, on: record.on === 'ended' ? 'ended' : 'ready' } : undefined
    case 'page':
      return typeof record.url === 'string' && typeof record.minutes === 'number'
        ? { kind: 'page', url: record.url, selector: typeof record.selector === 'string' ? record.selector : '', minutes: record.minutes }
        : undefined
    default:
      return undefined
  }
}
