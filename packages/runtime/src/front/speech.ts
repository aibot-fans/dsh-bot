import type { MessageRoute, RoomMessage, RouteKind } from 'pod-domain'
import type { ReplyPurpose } from '../chat/replies.ts'
import type { Wake } from './wakes.ts'

/** 前台判过这条（开了任务、转进任务、改了状态）以后回的那句是确认。 */
const ACKED: ReadonlySet<RouteKind> = new Set<RouteKind>(['opened', 'relayed', 'stopped', 'paused', 'resumed', 'ran'])

/** 前台说的这句是什么、挂什么。 */
export interface Speech {
  readonly purpose: ReplyPurpose
  /** 消息开头挂哪个任务的记号。 */
  readonly taskId: string | undefined
  readonly replyTo: string | null
  /** 叫醒它说的那件：说了就撤掉兜底。 */
  readonly wake: Wake | undefined
  /** 挂在这句下面的等你卡片。 */
  readonly waitId: string | undefined
  readonly reportId: string | undefined
}

export interface SpeechInput {
  readonly botId: string
  readonly roomId: string
  readonly replied: RoomMessage | undefined
  /** reply 写的任务（根任务 id）。 */
  readonly task: string | undefined
}

export interface SpeechDeps {
  /** 叫醒的那条已经交给这个前台、还没说的：这个任务最早的那件。 */
  readonly pending: (botId: string, taskId: string) => Wake | undefined
  /** 没写 task 时：这个前台在这个聊天室还没说的只有一件就是它。 */
  readonly onlyIn: (botId: string, roomId: string) => Wake | undefined
  readonly routes: (messageId: string) => readonly MessageRoute[]
  readonly rootOf: (taskId: string) => string | undefined
  /** 这个前台在这个聊天室刚开、还没回话的任务。 */
  readonly openedIn: (botId: string, roomId: string) => string | undefined
  readonly waitOpen: (waitId: string) => boolean
}

/**
 * 前台不写用途，按它在回什么定：
 * - 叫醒它说的那件（写了 task 是这个任务的，没写时这个聊天室只有一件）：交结果算结果，回在用户问的那句上；
 *   问用户、没做成算转告，问的事卡片挂在这句下面。
 * - 回的是它判过的消息（开了任务、转进任务、改了状态）算确认，挂那个任务的记号；没写 to 时，这个聊天室刚开、还没回话的任务也算。
 * - 其余算答复，写了 task 的挂那个任务的记号。
 */
export function speechOf(input: SpeechInput, deps: SpeechDeps): Speech {
  const { botId, roomId, replied, task } = input
  const plain = { wake: undefined, waitId: undefined, reportId: undefined, replyTo: replied?.id ?? null }
  const found = task === undefined ? deps.onlyIn(botId, roomId) : deps.pending(botId, task)
  const wake = found?.roomId === roomId ? found : undefined
  if (wake !== undefined) {
    const base = { taskId: wake.taskId, wake, reportId: wake.reportId ?? undefined }
    if (wake.kind === 'result') return { ...base, purpose: 'result', replyTo: replied?.id ?? wake.anchor, waitId: undefined }
    const waitId = wake.waitId !== null && deps.waitOpen(wake.waitId) ? wake.waitId : undefined
    return { ...base, purpose: 'relay', replyTo: replied?.id ?? null, waitId }
  }
  const routed = replied === undefined ? undefined : deps.routes(replied.id).findLast((route) => route.botId === botId && route.taskId !== null && ACKED.has(route.route))
  const routedRoot = routed?.taskId === null || routed === undefined ? undefined : deps.rootOf(routed.taskId)
  if (routedRoot !== undefined && (task === undefined || task === routedRoot)) return { ...plain, purpose: 'confirm', taskId: routedRoot }
  const opened = replied === undefined ? deps.openedIn(botId, roomId) : undefined
  if (opened !== undefined && (task === undefined || task === opened)) return { ...plain, purpose: 'confirm', taskId: opened }
  return { ...plain, purpose: 'answer', taskId: task }
}
