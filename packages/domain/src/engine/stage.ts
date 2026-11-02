import type { TaskStatus } from '../tasks.ts'
import type { EndReason, ReportStatus, RunStatus } from './tickets.ts'

/**
 * 任务卡和概览上的阶段：不存下来（库里那份只是缓存），每次按事实从上往下对，第一条对上的就是。
 * 同样的事实推出同样的阶段。
 */
export type TicketStage = 'ended' | 'undelivered' | 'waiting' | 'review' | 'blocked' | 'failed' | 'queued' | 'scheduled' | 'idle' | 'running'

export interface StageFacts {
  readonly endReason: EndReason | null
  /** 有一条回复发不出去。 */
  readonly undelivered: boolean
  readonly openWaits: number
  /**
   * 最后一次汇报（进展不算），只算最近一次执行的：之后又开了新的执行（你说了话、点了重试），
   * 旧的汇报就不再说明现在的情况，受阻、失败、就绪都跟着翻篇。
   */
  readonly lastReport: ReportStatus | null
  readonly lastRun: RunStatus | null
  /** 挂着还没关掉的触发器（暂停的也算）：没在跑时就是等到点。 */
  readonly armed: boolean
}

export function deriveStage(facts: StageFacts): TicketStage {
  if (facts.endReason !== null) return 'ended'
  if (facts.undelivered) return 'undelivered'
  if (facts.openWaits > 0) return 'waiting'
  if (facts.lastReport === 'blocked' || facts.lastReport === 'failed') return facts.lastReport
  if (facts.armed && facts.lastRun !== 'running' && facts.lastRun !== 'queued') return 'scheduled'
  if (facts.lastReport === 'ready') return 'review'
  if (facts.lastRun === null || facts.lastRun === 'queued') return 'queued'
  if (facts.lastReport === 'waiting' || facts.lastRun === 'ended') return 'idle'
  return 'running'
}

export const TICKET_STAGE_LABELS: Readonly<Record<TicketStage, string>> = {
  ended: '已结束',
  undelivered: '消息没送到',
  waiting: '等你答复',
  review: '等你验收',
  blocked: '受阻',
  failed: '失败',
  queued: '排队中',
  scheduled: '等到点',
  idle: '等新消息',
  running: '进行中',
}

/** 概览里放哪：要你处理、进行中，或者不显示。 */
export type StageGroup = 'attention' | 'active' | 'hidden'

export function stageGroup(stage: TicketStage): StageGroup {
  switch (stage) {
    case 'undelivered':
    case 'waiting':
    case 'review':
    case 'blocked':
    case 'failed':
      return 'attention'
    case 'queued':
    case 'running':
      return 'active'
    case 'ended':
    case 'scheduled':
    case 'idle':
      return 'hidden'
  }
}

/**
 * 旧的 9 种状态由阶段推出来，只给还没改成读阶段的代码用（列表筛选、团队编排）。
 * 你停掉的记成 stopped，无需处理记成 cancelled。
 */
export function statusFromStage(stage: TicketStage, endReason: EndReason | null, running: boolean): TaskStatus {
  switch (stage) {
    case 'ended':
      return endReason === 'stopped' ? 'stopped' : endReason === 'dismissed' ? 'cancelled' : 'done'
    case 'undelivered':
      return running ? 'running' : 'paused'
    case 'waiting':
    case 'blocked':
      return 'waiting'
    case 'review':
      return 'review'
    case 'failed':
      return 'failed'
    case 'queued':
      return 'queued'
    case 'scheduled':
    case 'idle':
      return 'paused'
    case 'running':
      return 'running'
  }
}

/** 团队编排还在直接写旧状态的任务：按状态对回阶段。 */
export function stageFromStatus(status: TaskStatus): TicketStage {
  switch (status) {
    case 'queued':
      return 'queued'
    case 'running':
      return 'running'
    case 'waiting':
      return 'waiting'
    case 'review':
      return 'review'
    case 'failed':
      return 'failed'
    case 'paused':
      return 'idle'
    case 'done':
    case 'stopped':
    case 'cancelled':
      return 'ended'
  }
}
