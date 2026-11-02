import type { DatabaseSync } from 'node:sqlite'
import type { FollowKind, MessageKind, MessageRoute, Task, TaskReport, TaskRun, TopicKind, Wait } from 'pod-domain'
import {
  followHistoryOf,
  getDelivery,
  getMessage,
  getRoom,
  getRun,
  getTopic,
  listTaskEvents,
  reportsFor,
  routesForTask,
  runsFor,
  timelineMessages,
  waitsForRoot,
  type TaskEvent,
} from 'pod-store'
import { clipCard } from '../core/cards.ts'

/** 每类最多取几条（最近的），整条时间线最多几条。 */
const PER_KIND = 200
const TOTAL = 400
/** 消息正文在时间线里最多显示多少字（全文在聊天室里）。 */
const BODY_LIMIT = 600
const EXCERPT_LIMIT = 40

/** 送进任务的去向：直通、前台转来、前台开了这个任务。 */
const ROUTED_IN: ReadonlySet<string> = new Set(['direct', 'relayed', 'opened'])
/** 任务对消息的动作：确认、交还、没读退回，各单独一行。 */
const ROUTE_ACTIONS: ReadonlySet<string> = new Set(['acked', 'handed_back', 'returned'])
/** 执行和汇报另有一行，决策链里的这几种不重复列。 */
const SKIPPED_EVENTS: ReadonlySet<string> = new Set(['run_queued', 'run_started', 'run_ended', 'report_recorded'])

export interface TimelineMessage {
  readonly id: string
  readonly roomId: string
  readonly seq: number
  readonly author: string
  readonly kind: MessageKind
  readonly body: string
  readonly createdAt: number
  /** 送进这个任务的（直通、前台转来）读过没有；不是送进来的为 null。 */
  readonly read: boolean | null
}

export type TimelineItem =
  | { readonly kind: 'message'; readonly at: number; readonly message: TimelineMessage }
  | { readonly kind: 'run'; readonly at: number; readonly run: TaskRun }
  | { readonly kind: 'report'; readonly at: number; readonly report: TaskReport }
  | { readonly kind: 'wait'; readonly at: number; readonly wait: Wait }
  | { readonly kind: 'route'; readonly at: number; readonly route: MessageRoute; readonly excerpt: string }
  | { readonly kind: 'event'; readonly at: number; readonly event: TaskEvent }

/** 任务跟进的一个话题：哪种跟法、在哪个聊天室、从哪条消息开始。 */
export interface FollowView {
  readonly topicId: string
  readonly follow: FollowKind
  readonly topic: TopicKind
  readonly roomId: string | null
  readonly roomTitle: string | null
  readonly rootMessage: string | null
  readonly seq: number | null
  readonly excerpt: string
}

/** 送进任务的消息读过没有：开工说明那次投递收进了历史（一轮结束）才算；还排着的执行算没读。 */
function readOf(db: DatabaseSync, ref: string | null): boolean {
  if (ref === null) return false
  if (ref.startsWith('run_')) return getRun(db, ref)?.startedAt != null
  return getDelivery(db, ref)?.readAt != null
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= EXCERPT_LIMIT ? flat : `${flat.slice(0, EXCERPT_LIMIT)}…`
}

/**
 * 任务页的时间线：话题里的消息（送进来的标出读过没有）、每次执行、每次汇报、等你、看门狗的结论、交还和确认，
 * 加上决策链里别的事，按时间排，旧的在前。根任务带上整棵树的事件和等你；子任务只看自己的。
 */
export function taskTimeline(db: DatabaseSync, task: Task): readonly TimelineItem[] {
  const routes = routesForTask(db, task.id, PER_KIND * 2)
  const topicIds = followHistoryOf(db, task.id).map((follow) => follow.topicId)
  const routedIds = [...new Set(routes.filter((route) => ROUTED_IN.has(route.route) || ROUTE_ACTIONS.has(route.route)).map((route) => route.messageId))]
  const latestIn = new Map(routes.filter((route) => ROUTED_IN.has(route.route) && route.route !== 'opened').map((route) => [route.messageId, route]))
  const messages: readonly TimelineItem[] = timelineMessages(db, topicIds, routedIds, PER_KIND)
    .filter((message) => message.kind !== 'task-card')
    .map((message) => {
      const routed = latestIn.get(message.id)
      return {
        kind: 'message',
        at: message.createdAt,
        message: {
          id: message.id,
          roomId: message.roomId,
          seq: message.seq,
          author: message.author,
          kind: message.kind,
          body: clipCard(message.body, BODY_LIMIT, null),
          createdAt: message.createdAt,
          read: routed === undefined ? null : readOf(db, routed.ref),
        },
      }
    })
  const actions: readonly TimelineItem[] = routes
    .filter((route) => ROUTE_ACTIONS.has(route.route))
    .map((route) => ({ kind: 'route', at: route.createdAt, route, excerpt: excerpt(getMessage(db, route.messageId)?.body ?? '') }))
  const runs: readonly TimelineItem[] = runsFor(db, task.id, PER_KIND).map((run) => ({ kind: 'run', at: run.startedAt ?? run.queuedAt, run }))
  const reports: readonly TimelineItem[] = reportsFor(db, task.id, PER_KIND).map((report) => ({ kind: 'report', at: report.createdAt, report }))
  const root = task.parentId === null
  const waits: readonly TimelineItem[] = waitsForRoot(db, task.rootId)
    .filter((wait) => root || wait.taskId === task.id)
    .map((wait) => ({ kind: 'wait', at: wait.createdAt, wait }))
  const events: readonly TimelineItem[] = listTaskEvents(db, task.rootId)
    .filter((event) => !SKIPPED_EVENTS.has(event.kind) && (root || event.taskId === task.id))
    .slice(-PER_KIND)
    .map((event) => ({ kind: 'event', at: event.createdAt, event }))
  return [...messages, ...actions, ...runs, ...reports, ...waits, ...events].sort((left, right) => left.at - right.at).slice(-TOTAL)
}

/** 任务正在跟进的话题，带上所在聊天室和开头那条消息的摘录。 */
export function followViews(db: DatabaseSync, task: Task): readonly FollowView[] {
  return followHistoryOf(db, task.id)
    .filter((follow) => follow.endedAt === null)
    .flatMap((follow) => {
      const topic = getTopic(db, follow.topicId)
      if (topic === undefined) return []
      const root = topic.rootMessage === null ? undefined : getMessage(db, topic.rootMessage)
      return [
        {
          topicId: topic.id,
          follow: follow.kind,
          topic: topic.kind,
          roomId: topic.roomId,
          roomTitle: topic.roomId === null ? null : (getRoom(db, topic.roomId)?.title ?? null),
          rootMessage: topic.rootMessage,
          seq: root?.seq ?? null,
          excerpt: excerpt(root?.body ?? ''),
        },
      ]
    })
}
