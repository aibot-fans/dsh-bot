/** Pod 管理的 dsh 会话：哪个 bot、哪种用途、属于哪个房间或任务，以及累计用量。 */

import type { SessionKind } from './persona.ts'
import type { ToolProfile } from './bots.ts'

export type SessionStatus = 'active' | 'retired'

export interface PodSession {
  readonly id: string
  readonly botId: string
  readonly kind: SessionKind
  readonly roomId: string | null
  readonly taskId: string | null
  /** 换段后的第几段；每段是一条新的 dsh 会话。 */
  readonly segment: number
  readonly preset: string
  /** 工作目录，相对 Pod 工作区。 */
  readonly folder: string
  readonly status: SessionStatus
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheTokens: number
  /** 最近一次请求的输入 token，约等于当前上下文长度，换段用它判断。 */
  readonly contextTokens: number
  readonly cost: number
  readonly steps: number
  readonly tainted: boolean
  readonly createdAt: number
  readonly lastActiveAt: number | null
  readonly retiredAt: number | null
}

/** 工具档案对应的 agent 预设，组合包里声明，id 必须一致。 */
export const PROFILE_PRESETS: Readonly<Record<ToolProfile, string>> = {
  talk: 'pod-talk',
  research: 'pod-research',
  exec: 'pod',
}

/** 这条会话能不能用共用浏览器：对话档案没有；组长的协调会话和咨询也不需要。 */
export function sessionBrowses(session: Pick<PodSession, 'preset' | 'kind'>): boolean {
  return session.preset !== PROFILE_PRESETS.talk && (session.kind === 'chat' || session.kind === 'task' || session.kind === 'routine')
}

/** 这条会话能不能做页面（save_page 一类工具）：咨询只回答问题，不做成品。 */
export function sessionMakesPages(session: Pick<PodSession, 'kind'>): boolean {
  return session.kind !== 'consult'
}

export const SESSION_KIND_LABELS: Readonly<Record<SessionKind, string>> = {
  chat: '聊天',
  task: '任务',
  coord: '协调',
  consult: '咨询',
  routine: '例程',
}

/** 并发通道：聊天有自己保留的名额；任务和协调走任务通道；咨询、例程、整理走后台。 */
export type Lane = 'chat' | 'task' | 'background'

export function laneOf(kind: SessionKind): Lane {
  if (kind === 'chat') return 'chat'
  if (kind === 'task' || kind === 'coord') return 'task'
  return 'background'
}

/** 排队优先级，数小的先投：你的对话 > 标了急的任务 > 普通任务 > 例程 > 夜间整理。 */
export const PRIORITY = {
  owner: 0,
  urgent: 10,
  task: 20,
  consult: 25,
  routine: 30,
  maintenance: 40,
} as const
