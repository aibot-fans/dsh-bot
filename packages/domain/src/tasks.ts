/** 任务树：根任务是目标，子任务派给成员；验收项既是标准，也是进度的计量单位。 */

import type { ToolProfile } from './bots.ts'

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'review'
  | 'done'
  | 'failed'
  | 'paused'
  | 'stopped'
  | 'cancelled'

export type TaskLevel = 'L0' | 'L1' | 'L2' | 'L3'

export type TaskStage = 'understand' | 'split' | 'execute' | 'integrate' | 'deliver' | 'done'

export interface AcceptanceItem {
  readonly text: string
  readonly done: boolean
  readonly at: number | null
}

export interface TaskNeeds {
  readonly browser: boolean
  readonly shell: boolean
}

/** 提交结果：摘要加文件路径，以及交付卡上的“前提和待确认”。 */
export interface TaskResult {
  readonly summary: string
  readonly files: readonly string[]
  readonly assumptions: readonly string[]
  readonly unverified: readonly string[]
  readonly skipped: readonly string[]
}

export interface Task {
  readonly id: string
  readonly rootId: string
  readonly parentId: string | null
  /** 里程碑和任务卡发到哪个房间。 */
  readonly roomId: string | null
  readonly teamId: string | null
  readonly title: string
  readonly brief: string
  /** 调研、写作、分析……分配打分时用。 */
  readonly kind: string
  readonly deliverable: string
  readonly acceptance: readonly AcceptanceItem[]
  readonly dependsOn: readonly string[]
  readonly needs: TaskNeeds
  readonly ownerBotId: string | null
  readonly level: TaskLevel | null
  readonly status: TaskStatus
  readonly stage: TaskStage | null
  /** 最近一条进度说明。 */
  readonly note: string
  readonly result: TaskResult | null
  /** 工作目录（相对 Pod 工作区）。 */
  readonly folder: string
  readonly planVersion: number
  readonly urgent: boolean
  /** 读过网页或不可信内容；它派出的子任务也受污染，写操作一律审批。 */
  readonly tainted: boolean
  /** 权限上限：子任务的权限 = 负责人的工具档案 ∩ 派出它的任务的上限。 */
  readonly maxProfile: ToolProfile
  /** “谨慎”档：计划等你点“开始”才动。 */
  readonly planPending: boolean
  /** 谁建的：owner 或会话 id。 */
  readonly createdBy: string
  /** 结果要回给哪条会话（主管的聊天会话或组长的协调会话）。 */
  readonly requesterSession: string | null
  readonly attempts: number
  readonly createdAt: number
  readonly startedAt: number | null
  readonly finishedAt: number | null
  readonly updatedAt: number
}

export const TASK_STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  queued: '排队',
  running: '进行中',
  waiting: '等你',
  review: '待验收',
  done: '完成',
  failed: '失败',
  paused: '已暂停',
  stopped: '已停止',
  cancelled: '已取消',
}

export const STAGE_LABELS: Readonly<Record<TaskStage, string>> = {
  understand: '理解',
  split: '拆分',
  execute: '执行',
  integrate: '汇总',
  deliver: '交付',
  done: '完成',
}

/** 单个 bot 的任务只有理解 > 执行 > 交付；团队任务多出拆分和汇总。 */
export function stagesFor(level: TaskLevel | null): readonly TaskStage[] {
  return level === 'L2' || level === 'L3'
    ? ['understand', 'split', 'execute', 'integrate', 'deliver']
    : ['understand', 'execute', 'deliver']
}

const TERMINAL: ReadonlySet<TaskStatus> = new Set(['done', 'failed', 'cancelled'])

/** 结束了的任务不再派活；stopped 不算结束，说“继续”还能接着做。 */
export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL.has(status)
}

export function isActive(status: TaskStatus): boolean {
  return status === 'running' || status === 'waiting' || status === 'review' || status === 'queued'
}

export function acceptanceProgress(items: readonly AcceptanceItem[]): { readonly done: number; readonly total: number } {
  return { done: items.filter((item) => item.done).length, total: items.length }
}

export function newAcceptance(texts: readonly string[]): readonly AcceptanceItem[] {
  return texts.map((text) => ({ text, done: false, at: null }))
}

/** 勾选验收项（下标从 0 开始），已勾的保持原来的时间。 */
export function checkAcceptance(items: readonly AcceptanceItem[], indexes: readonly number[], now: number): readonly AcceptanceItem[] {
  const wanted = new Set(indexes)
  return items.map((item, index) => (wanted.has(index) && !item.done ? { ...item, done: true, at: now } : item))
}

export const EMPTY_RESULT: TaskResult = { summary: '', files: [], assumptions: [], unverified: [], skipped: [] }

/** 任务的实时动态：直接取自会话事件，不调用模型。 */
export interface TaskActivity {
  readonly sessionId: string
  readonly running: boolean
  readonly turn: number
  readonly steps: number
  /** 最近几个动作，例如“打开 b.com/pricing”。 */
  readonly actions: readonly string[]
  readonly current: string | null
  readonly lastEventAt: number | null
  readonly stalled: boolean
}

/** 任务卡和进度快照里用到的全部数字。 */
export interface TaskSnapshot {
  readonly task: Task
  readonly children: readonly Task[]
  /** 正在执行这个任务的会话（任务会话或组长的协调会话），“查看过程”用它。 */
  readonly sessionId: string | null
  readonly activity: TaskActivity | null
  readonly childActivity: Readonly<Record<string, TaskActivity>>
  readonly ownerName: string | null
  readonly cost: number
  readonly tokens: number
  readonly waits: number
}
