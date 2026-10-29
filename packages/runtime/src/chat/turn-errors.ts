import { POD, maskSecrets, t, type MessageKind, type PodSession, type RoomMessage } from 'pod-domain'
import type { TurnFailure } from '../agents/observer.ts'

/** 任务和例程的会话出错后还会被提醒继续：同一条会话同一种错，这么久之内只提示一次。 */
const REPEAT_MS = 10 * 60_000

/** 原始报错最多留这么多字，页面上点开看。 */
const DETAIL_MAX = 300

/** 消息里 data.turnError 的样子：页面据此画成红色的一行，单聊和群聊的可以重试。 */
export interface TurnErrorData {
  readonly code: string
  readonly status?: number
  readonly botId: string
  readonly detail: string
  readonly retry: boolean
}

export interface TurnErrorDeps {
  readonly post: (roomId: string, message: { readonly author: string; readonly kind: MessageKind; readonly body: string; readonly data?: Readonly<Record<string, unknown>> }) => RoomMessage | undefined
  readonly botName: (botId: string) => string
  readonly now: () => number
}

/** 模型服务的错按 code 说成人话；认不出的只说“模型服务出错了”，原始报错放在详情里。 */
export function failureReason(failure: TurnFailure): string {
  switch (failure.code) {
    case 'AUTH':
    case 'MISSING_CREDENTIAL':
      return t('模型服务认证失败，Key 可能填错了、过期了或者没填')
    case 'QUOTA':
      return t('模型服务的额度或余额用完了')
    case 'RATE_LIMIT':
      return t('模型服务限流了，过一会儿再试')
    case 'SERVER':
      return failure.status === undefined ? t('模型服务自己出错了，过一会儿再试') : t('模型服务自己出错了（{status}），过一会儿再试', { status: failure.status })
    case 'TRANSPORT':
    case 'TIMEOUT':
    case 'LLM_STREAM_IDLE_TIMEOUT':
    case 'STREAM_CLOSED':
      return t('连不上模型服务，或者等了太久没有回应；检查一下网络和代理')
    case 'NO_ADAPTER':
    case 'UNKNOWN_MODEL':
      return t('找不到要用的模型，检查一下模型设置')
    case 'CONTEXT_WINDOW_EXCEEDED':
      return t('对话太长，超出了模型能看的长度；开个新对话再试')
    case 'UNSUPPORTED_CONTENT':
      return t('模型不支持这条消息里的内容（比如图片）')
    case 'EMPTY_RESPONSE':
    case 'MALFORMED_RESPONSE':
    case 'INVALID_RESPONSE':
      return t('模型服务返回的内容不对')
    default:
      return t('模型服务出错了')
  }
}

/**
 * 一轮因为出错结束（dsh 自己的重试也没救回来）：在对话里留一条 dsh-bot 的提示，写明是谁、什么原因，
 * 不然页面上只看到 bot“正在思考”一下就没了。单聊和群聊的聊天会话可以点“重试”；任务和例程照旧由它们自己的提醒接着做。
 */
export class TurnErrors {
  private readonly deps: TurnErrorDeps
  private readonly recent = new Map<string, { readonly code: string; readonly at: number }>()

  constructor(deps: TurnErrorDeps) {
    this.deps = deps
  }

  report(session: PodSession, failure: TurnFailure): RoomMessage | undefined {
    if (session.roomId === null || (session.kind !== 'chat' && session.kind !== 'task' && session.kind !== 'routine')) return undefined
    const now = this.deps.now()
    for (const [id, seen] of this.recent) if (now - seen.at >= REPEAT_MS) this.recent.delete(id)
    const last = this.recent.get(session.id)
    if (session.kind !== 'chat' && last !== undefined && last.code === failure.code) return undefined
    this.recent.set(session.id, { code: failure.code, at: now })
    const data: TurnErrorData = {
      code: failure.code,
      ...(failure.status === undefined ? {} : { status: failure.status }),
      botId: session.botId,
      detail: maskSecrets(failure.message).text.slice(0, DETAIL_MAX),
      retry: session.kind === 'chat',
    }
    const body = t('{name}没回成：{reason}', { name: this.deps.botName(session.botId), reason: failureReason(failure) })
    return this.deps.post(session.roomId, { author: POD, kind: 'notice', body, data: { turnError: data } })
  }
}
