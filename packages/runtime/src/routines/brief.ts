import type { DatabaseSync } from 'node:sqlite'
import { TASK_STATUS_LABELS, dailyCron, formatCost, t, triggerSource, type Bot, type PodSettings, type Room, type Task, type TriggerSpec, type Wait } from 'pod-domain'
import { openTriggersOf, triggersBySource } from 'pod-store'
import type { RoomService } from '../chat/rooms.ts'
import type { Engine } from '../engine/index.ts'
import type { TriggerClock, Wake } from '../engine/triggers.ts'
import { openAutoTask } from '../tasks/standing.ts'

export interface BriefData {
  readonly finished: readonly Task[]
  readonly running: readonly Task[]
  readonly waits: readonly Wait[]
  readonly cost: { readonly today: number; readonly yesterday: number }
}

export interface BriefDeps {
  readonly db: DatabaseSync
  readonly engine: Engine
  readonly rooms: RoomService
  readonly triggers: TriggerClock
  readonly settings: () => PodSettings
  readonly data: () => BriefData
  readonly lead: () => Bot
  readonly leadRoom: () => Room
  /** 关掉设置里的每日简报。 */
  readonly turnOff: () => void
  readonly warn: (message: string, error?: unknown) => void
}

function compose(data: BriefData): string {
  const lines = [
    '[每日简报] 根据下面的数据给用户写今天的简报：几段短话，先说最重要的；有等用户处理的事放在前面。不要编造数据里没有的内容。写好后报 ready，摘要就是发给用户的简报正文。',
    `过去一天完成的任务（${data.finished.length} 个）：${data.finished.length === 0 ? '无' : data.finished.map((task) => `「${task.title}」${task.result === null ? '' : `：${task.result.summary.split('\n')[0] ?? ''}`}`).join('；')}`,
    `正在进行（${data.running.length} 个）：${data.running.length === 0 ? '无' : data.running.map((task) => `「${task.title}」${TASK_STATUS_LABELS[task.status]}${task.note === '' ? '' : `，${task.note}`}`).join('；')}`,
    `等用户处理（${data.waits.length} 件）：${data.waits.length === 0 ? '无' : data.waits.map((wait) => wait.title).join('；')}`,
    `花费：今天 ${formatCost(data.cost.today)}，昨天 ${formatCost(data.cost.yesterday)}`,
  ]
  return lines.join('\n')
}

/** 每日简报：Super-agent 的一个常开任务，挂每天的时间触发器，结果回在主管单聊里它的任务卡下面；可以在设置里关掉。 */
export class DailyBrief {
  private readonly deps: BriefDeps

  constructor(deps: BriefDeps) {
    this.deps = deps
  }

  /** 按设置建好或改好：开着就按设置的时间叫醒，关了就把触发器暂停。 */
  ensure(): void {
    const settings = this.deps.settings()
    const spec: TriggerSpec = { kind: 'cron', cron: dailyCron(settings.dailyBrief.time) }
    const current = triggersBySource(this.deps.db, 'brief')[0]
    if (current === undefined) {
      if (!settings.dailyBrief.enabled) return
      const room = this.deps.leadRoom()
      const opened = openAutoTask(this.deps, {
        bot: this.deps.lead(),
        title: t('每日简报'),
        brief: '每天汇总任务进展、等用户处理的事和花费，写成几段短话发给用户。',
        roomId: room.id,
        replyTo: [{ roomId: room.id, messageId: null }],
        origin: { kind: 'rule', rule: t('每日简报'), requester: 'owner' },
        trigger: { spec, timezone: settings.timezone, state: { source: 'brief' }, createdBy: 'pod' },
        actor: 'pod',
      })
      if (!opened.ok) this.deps.warn(t('每日简报的任务没建成：{reason}', { reason: opened.error.message }))
      return
    }
    const sameTime = current.spec.kind === 'cron' && current.spec.cron === spec.cron && current.timezone === settings.timezone
    if (sameTime && current.enabled === settings.dailyBrief.enabled) return
    const changed = this.deps.triggers.change(current.id, { ...(sameTime ? {} : { spec, timezone: settings.timezone }), enabled: settings.dailyBrief.enabled }, 'owner')
    if (typeof changed === 'string') this.deps.warn(t('每日简报的时间没改成：{reason}', { reason: changed }))
  }

  /** 你停掉了每日简报这个任务、删掉了它的触发器：设置里的每日简报跟着关掉，不然重启时又会建出来；要回来在设置里打开。 */
  turnedOff(): void {
    if (this.deps.settings().dailyBrief.enabled) this.deps.turnOff()
  }

  /** 任务结束时（在它的触发器关掉之前）调：停掉的是简报任务就关掉设置。 */
  ended(task: Task): void {
    if (task.endReason === 'stopped' && openTriggersOf(this.deps.db, task.id).some((trigger) => triggerSource(trigger) === 'brief')) this.turnedOff()
  }

  /** 到点了：带上今天的数据。 */
  wake(): Wake {
    return { note: compose(this.deps.data()) }
  }
}
