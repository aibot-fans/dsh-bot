/**
 * 任务即工单：来由、一次次执行、汇报。来由写入后不改；执行结束后不再改；汇报只增。
 * 这里只有类型和纯函数，引擎（runtime/engine）负责写。
 */

/** 来由里的一句原话：消息 id 和原文（太长截断，留着 id 能读回全文）。 */
export interface OriginQuote {
  readonly messageId: string | null
  readonly author: string
  readonly text: string
}

export type OriginKind = 'owner' | 'bot' | 'rule' | 'legacy'

/** 来由：谁要的、在哪说的、原话，加上分派的一方写的标题和一句备注。 */
export interface TaskOrigin {
  readonly kind: OriginKind
  readonly quotes: readonly OriginQuote[]
  /** 谁要的：owner、bot id，或规则的名字。 */
  readonly requester: string
  readonly roomId: string | null
  /** 自动来源开的任务：哪条规则。 */
  readonly rule: string | null
  readonly title: string
  /** 分派的一方的一句备注（背景或你的明确要求），只给任务会话看。 */
  readonly note: string
}

/** 回复去处：发起它的聊天室和那条消息；后来在别处问的也记下来，结果回在每条下面。 */
export interface ReplyTarget {
  readonly roomId: string
  readonly messageId: string | null
}

export type RunStatus = 'queued' | 'running' | 'ended'

/** 开工原因：新任务、你的新消息、触发器、重试、重启恢复、点了继续、子任务交上来要评审。 */
export type RunReason = 'new' | 'message' | 'trigger' | 'retry' | 'recover' | 'resume' | 'review' | 'subtask'

/** 执行怎么结束的：交了汇报、你停下这次、你停掉任务、开工失败、重启打断、催了几次还没汇报。 */
export type RunOutcome = 'reported' | 'paused' | 'stopped' | 'failed' | 'interrupted' | 'silent'

export interface TaskRun {
  readonly id: string
  readonly taskId: string
  readonly sessionId: string | null
  readonly status: RunStatus
  readonly reason: RunReason
  /** 开工原因的补充：哪个触发器、你的哪几条消息、重试附的上次汇报 id。 */
  readonly detail: Readonly<Record<string, unknown>>
  readonly outcome: RunOutcome | null
  readonly error: string | null
  readonly queuedAt: number
  readonly startedAt: number | null
  readonly endedAt: number | null
}

export const RUN_REASON_LABELS: Readonly<Record<RunReason, string>> = {
  new: '新任务',
  message: '你的新消息',
  trigger: '触发器',
  retry: '重试',
  recover: '重启后接着做',
  resume: '点了继续',
  review: '组长打回重做',
  subtask: '子任务有新进展',
}

export const RUN_OUTCOME_LABELS: Readonly<Record<RunOutcome, string>> = {
  reported: '交了汇报',
  paused: '停下这次',
  stopped: '任务停掉',
  failed: '开工失败',
  interrupted: '重启打断',
  silent: '催了几次没汇报',
}

/** 汇报 6 种：进展、等消息、就绪、受阻、失败、无需处理。 */
export type ReportStatus = 'progress' | 'waiting' | 'ready' | 'blocked' | 'failed' | 'dismissed'

export const REPORT_STATUSES: readonly ReportStatus[] = ['progress', 'waiting', 'ready', 'blocked', 'failed', 'dismissed']

export const REPORT_STATUS_LABELS: Readonly<Record<ReportStatus, string>> = {
  progress: '进展',
  waiting: '等消息',
  ready: '就绪',
  blocked: '受阻',
  failed: '失败',
  dismissed: '无需处理',
}

/** 这几种结束这次执行、让出名额；进展不结束。 */
export function endsRun(status: ReportStatus): boolean {
  return status !== 'progress'
}

/** 这几种必须写报告。 */
export function needsReport(status: ReportStatus): boolean {
  return status === 'ready' || status === 'blocked' || status === 'failed'
}

export interface TaskReport {
  readonly id: string
  readonly runId: string | null
  readonly taskId: string
  readonly status: ReportStatus
  /** 一句摘要，先写结论；就绪时作为结果发到聊天室。 */
  readonly summary: string
  /** 完整报告，放任务页。 */
  readonly report: string
  /** 最多一个问题；受阻必填，进等你。 */
  readonly question: string
  /** 问题针对的消息、回的是哪条消息。 */
  readonly aboutMessage: string | null
  readonly replyMessage: string | null
  /** 就绪时勾的验收项（下标从 0 开始）。 */
  readonly checks: readonly number[]
  /** 产出文件、前提、没核实的、跳过的这些附带信息。 */
  readonly data: Readonly<Record<string, unknown>>
  /** 谁写的：任务会话的 bot id，或 pod（替它记的，比如催了几次没汇报）。 */
  readonly author: string
  readonly createdAt: number
}

/** 怎么结束：完成、你停掉、无需处理。 */
export type EndReason = 'done' | 'stopped' | 'dismissed'

export const END_REASON_LABELS: Readonly<Record<EndReason, string>> = {
  done: '完成',
  stopped: '你停掉了',
  dismissed: '无需处理',
}
