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
 * 任务结束时没读退回前台、被挡掉；前台的判断：开了任务、停了、暂停了、让它接着做、让例程现在跑一次、不用处理、直接答，
 * 一轮结束还没判断的记成漏掉。
 */
export type RouteKind =
  | 'direct'
  | 'front'
  | 'relayed'
  | 'acked'
  | 'handed_back'
  | 'returned'
  | 'blocked'
  | 'opened'
  | 'stopped'
  | 'paused'
  | 'resumed'
  | 'ran'
  | 'ignored'
  | 'answered'
  | 'missed'

/** 前台给出的判断：交给前台以后有了其中一条，这条消息在这个前台就算有去向了。 */
export const FRONT_DECISIONS: readonly RouteKind[] = ['opened', 'relayed', 'stopped', 'paused', 'resumed', 'ran', 'ignored', 'answered', 'missed']

export interface MessageRoute {
  readonly id: number
  readonly messageId: string
  readonly route: RouteKind
  readonly taskId: string | null
  /** 谁定的：code（代码规则）、bot 的 id、owner。 */
  readonly decidedBy: string
  readonly note: string
  /** 送进任务时的那次投递或执行（判断读没读过）；交给前台的是送出那一批的投递，还没送出时为空。 */
  readonly ref: string | null
  /** 交给哪个 bot 的前台（交给前台和前台的判断才有）。 */
  readonly botId: string | null
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
  opened: '前台开了任务',
  stopped: '前台停了任务',
  paused: '前台暂停了任务',
  resumed: '前台让任务接着做',
  ran: '前台让例程现在跑一次',
  ignored: '前台判断不用处理',
  answered: '前台直接答了',
  missed: '前台漏掉',
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
