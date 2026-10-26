import type { TurnProgress } from './progress.ts'
import type { PodNotification } from './routines.ts'

/**
 * 宿主推给页面的实时事件。大多数事件只说“什么变了”，页面据此重新拉对应的数据；
 * 高频的（打字流、实时动作、浏览器画面）直接带数据。
 */

export type PodEvent =
  | { readonly type: 'hello'; readonly seq: number }
  | { readonly type: 'resync' }
  | { readonly type: 'status' }
  | { readonly type: 'settings' }
  | { readonly type: 'bots' }
  | { readonly type: 'teams' }
  | { readonly type: 'rooms' }
  | { readonly type: 'room'; readonly roomId: string }
  | { readonly type: 'message'; readonly roomId: string; readonly messageId: string }
  | {
      readonly type: 'stream'
      readonly roomId: string
      readonly botId: string
      readonly sessionId: string
      /** 这一轮到目前为止的完整文字（不是增量），丢帧也不会错。 */
      readonly text: string
      readonly done: boolean
    }
  | { readonly type: 'task'; readonly taskId: string; readonly rootId: string }
  | {
      readonly type: 'activity'
      readonly sessionId: string
      readonly taskId: string | null
      /** 聊天会话所在的房间；任务会话为 null。 */
      readonly roomId?: string | null
      readonly botId?: string
      readonly running?: boolean
      /** 正在做的事，例如“正在读 posts.tsx”；空串表示在想。 */
      readonly label?: string
      /** 聊天会话这一轮的执行进度，回答下面那一块直接用它画。 */
      readonly progress?: TurnProgress | null
    }
  | { readonly type: 'waits' }
  | { readonly type: 'notifications' }
  /** 要弹出来的一条通知（勿扰和房间通知级别已经过滤过）。 */
  | { readonly type: 'notify'; readonly notification: PodNotification }
  | { readonly type: 'memory' }
  | { readonly type: 'routines' }
  | { readonly type: 'pages'; readonly pageId?: string }
  | { readonly type: 'skills' }
  /** aibot 接入的状态变了（开通、额度、停用、事件流）。 */
  | { readonly type: 'aibot' }
  | { readonly type: 'evolution' }
  | { readonly type: 'browser'; readonly tabId: string | null; readonly pointer?: { readonly x: number; readonly y: number; readonly label: string } }
  | { readonly type: 'frame'; readonly tabId: string; readonly data: string; readonly width: number; readonly height: number }

export type PodEventType = PodEvent['type']

/** SSE 里的一条：带递增序号，断线重连时用 Last-Event-ID 补发。 */
export interface PodEventEnvelope {
  readonly seq: number
  readonly time: number
  readonly event: PodEvent
}
