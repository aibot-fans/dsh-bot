import type { DatabaseSync } from 'node:sqlite'
import { PRIORITY, TASK_STATUS_LABELS, formatCost, nextDailyAt, type PodSettings, type Task, type Wait } from 'pod-domain'
import { readState, writeState } from 'pod-store'
import type { Dispatcher } from '../agents/dispatcher.ts'
import { noticeSource } from '../agents/messages.ts'

export interface BriefData {
  readonly finished: readonly Task[]
  readonly running: readonly Task[]
  readonly waits: readonly Wait[]
  readonly cost: { readonly today: number; readonly yesterday: number }
}

export interface BriefDeps {
  readonly db: DatabaseSync
  readonly dispatcher: Dispatcher
  readonly settings: () => PodSettings
  readonly now: () => number
  readonly data: () => BriefData
  /** 主管单聊里主管的聊天会话。 */
  readonly leadSession: () => Promise<{ readonly id: string } | undefined>
  readonly notified: () => void
}

const STATE_KEY = 'brief.nextAt'

function compose(data: BriefData): string {
  const lines = [
    '[每日简报] 请根据下面的数据给用户写今天的简报：几段短话，先说最重要的；有等用户处理的事要放在前面。不要编造数据里没有的内容。',
    `过去一天完成的任务（${data.finished.length} 个）：${data.finished.length === 0 ? '无' : data.finished.map((task) => `「${task.title}」${task.result === null ? '' : `：${task.result.summary.split('\n')[0] ?? ''}`}`).join('；')}`,
    `正在进行（${data.running.length} 个）：${data.running.length === 0 ? '无' : data.running.map((task) => `「${task.title}」${TASK_STATUS_LABELS[task.status]}${task.note === '' ? '' : `，${task.note}`}`).join('；')}`,
    `等用户处理（${data.waits.length} 件）：${data.waits.length === 0 ? '无' : data.waits.map((wait) => wait.title).join('；')}`,
    `花费：今天 ${formatCost(data.cost.today)}，昨天 ${formatCost(data.cost.yesterday)}`,
  ]
  return lines.join('\n')
}

/** 每日简报：内置例程，主管每天汇总各团队的进展、等你处理的事和花费，发到主管单聊；可以在设置里关掉。 */
export class DailyBrief {
  private readonly deps: BriefDeps

  constructor(deps: BriefDeps) {
    this.deps = deps
  }

  private nextAt(now: number): number {
    const settings = this.deps.settings()
    return nextDailyAt(now, settings.timezone, settings.dailyBrief.time)
  }

  /** 设置里改了时间或开关时重新排一次。 */
  reschedule(): void {
    writeState(this.deps.db, STATE_KEY, this.nextAt(this.deps.now()))
  }

  async tick(): Promise<boolean> {
    const settings = this.deps.settings()
    if (!settings.dailyBrief.enabled) return false
    const now = this.deps.now()
    const due = readState<number | null>(this.deps.db, STATE_KEY, null)
    if (due === null) {
      this.reschedule()
      return false
    }
    if (due > now) return false
    writeState(this.deps.db, STATE_KEY, this.nextAt(now))
    const session = await this.deps.leadSession()
    if (session === undefined) return false
    const text = compose(this.deps.data())
    this.deps.dispatcher.enqueue({ sessionId: session.id, mode: 'followup', priority: PRIORITY.routine, text, source: noticeSource('每日简报') })
    this.deps.notified()
    return true
  }
}
