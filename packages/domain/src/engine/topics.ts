/**
 * 话题：一条消息和回复、引用它的那一串（任务卡也是一条消息），以后还有任务群和 X 上的一串对话。
 * 有自己的 id，和任务多对多：话题里你的后续消息直接送进每个跟进它的任务。
 */
export type TopicKind = 'thread' | 'team' | 'x'

export interface Topic {
  readonly id: string
  readonly kind: TopicKind
  readonly roomId: string | null
  /** 这一串最早的那条消息。 */
  readonly rootMessage: string | null
  readonly taskId: string | null
  readonly createdAt: number
}

/** 任务跟进话题的方式：自带的（开任务时就有）、挂上的（前台转来、任务产出）、只读的（只看不接）。 */
export type FollowKind = 'own' | 'attached' | 'readonly'

export interface TopicFollow {
  readonly topicId: string
  readonly taskId: string
  readonly kind: FollowKind
  readonly startedAt: number
  readonly endedAt: number | null
}

/**
 * 一条消息的去向，每一步记一行：直通了哪个任务、交给前台、前台转给任务、任务确认、任务交还、
 * 任务结束时没读退回前台、被挡掉。
 */
export type RouteKind = 'direct' | 'front' | 'relayed' | 'acked' | 'handed_back' | 'returned' | 'blocked'

export interface MessageRoute {
  readonly id: number
  readonly messageId: string
  readonly route: RouteKind
  readonly taskId: string | null
  /** 谁定的：code（代码规则）、bot 的 id、owner。 */
  readonly decidedBy: string
  readonly note: string
  /** 送进任务时的那次投递或执行（判断读没读过）。 */
  readonly ref: string | null
  readonly createdAt: number
}

export const ROUTE_LABELS: Readonly<Record<RouteKind, string>> = {
  direct: '直通任务',
  front: '交给前台',
  relayed: '前台转给任务',
  acked: '任务确认',
  handed_back: '任务交还',
  returned: '没读，退回前台',
  blocked: '挡掉',
}

/** 送进任务会话的一条消息（直通或转来的），开工说明和直通提醒里都按这个写。 */
export interface RoutedMessage {
  readonly id: string | null
  readonly author: string
  readonly replyTo: string | null
  readonly text: string
  /** 前台转来时附的一句说明。 */
  readonly note?: string
}
