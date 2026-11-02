import { stageGroup, type MessageRoute, type Task, type TaskSnapshot, type TicketStage, type Wait } from 'pod-domain'
import { countRunning, latestDecisiveReport, openRootTasks, openTasksOf, routesFor } from 'pod-store'
import type { PodRuntime } from '../pod.ts'

/** 概览里“现在要我处理什么”的一条：任务卡要你处理的，或者不属于任务的等你。 */
export interface AttentionItem {
  readonly key: string
  /** 打开哪个任务页；不属于任务的等你为 null。 */
  readonly taskId: string | null
  readonly title: string
  readonly botId: string | null
  /** 不属于任务的等你为 null。 */
  readonly stage: TicketStage | null
  /** 从什么时候开始等你：按这个排，最久的在前。 */
  readonly since: number
  /** 发生了什么：汇报的摘要、发不出去的原因、等你的问题。 */
  readonly summary: string
  /** 要你答复的那件（只一件，最早的）。 */
  readonly wait: Wait | null
}

/** 概览里进行中的一条。 */
export interface ActiveItem {
  readonly taskId: string
  readonly title: string
  readonly botId: string | null
  readonly stage: TicketStage
  readonly since: number
  /** 最后一句进展：进展汇报的摘要，或者会话正在做的事。 */
  readonly progress: string | null
}

export interface Overview {
  readonly attention: readonly AttentionItem[]
  readonly active: readonly ActiveItem[]
  /** 任务名额：在跑的执行几个、能同时跑几个（另留 1 个给你的消息唤醒的任务）。 */
  readonly slots: { readonly used: number; readonly total: number }
}

/** 群顶团队状态里一个成员：空闲、在做（任务名和已用时间）、等你、受阻。 */
export type MemberState = 'idle' | 'working' | 'waiting' | 'blocked'

export interface MemberStatus {
  readonly botId: string
  readonly state: MemberState
  /** 点开进哪个任务页（根任务）。 */
  readonly taskId: string | null
  readonly title: string | null
  readonly since: number | null
}

export interface RouteView extends MessageRoute {
  readonly taskTitle: string | null
}

function oldestWait(waits: readonly Wait[], rootId: string): Wait | null {
  return waits.filter((wait) => wait.rootId === rootId).sort((left, right) => left.createdAt - right.createdAt)[0] ?? null
}

/** 要你处理的任务从什么时候开始等你、发生了什么。 */
function attentionOf(pod: PodRuntime, snapshot: TaskSnapshot, waits: readonly Wait[]): AttentionItem {
  const { task, stage } = snapshot
  const base = { key: task.id, taskId: task.id, title: task.title, botId: task.ownerBotId, stage }
  if (stage === 'undelivered') return { ...base, since: snapshot.undelivered?.since ?? task.updatedAt, summary: snapshot.undelivered?.error ?? '', wait: null }
  if (stage === 'waiting') {
    const wait = oldestWait(waits, task.rootId)
    return { ...base, since: wait?.createdAt ?? task.updatedAt, summary: wait?.title ?? '', wait }
  }
  const report = latestDecisiveReport(pod.db, task.id)
  return { ...base, since: report?.createdAt ?? task.updatedAt, summary: report?.summary ?? '', wait: null }
}

function activeOf(snapshot: TaskSnapshot): ActiveItem {
  const { task, run, lastReport, activity } = snapshot
  const since = run?.startedAt ?? run?.queuedAt ?? task.createdAt
  const reported = lastReport !== null && lastReport.status === 'progress' && lastReport.createdAt >= since ? lastReport.summary : null
  const doing = activity?.running === true ? activity.current : null
  return { taskId: task.id, title: task.title, botId: task.ownerBotId, stage: snapshot.stage, since, progress: reported ?? doing ?? null }
}

/**
 * 概览：现在要我处理什么（等你答复、等你验收、受阻、失败、消息没送到，按等了多久排，最久的在前；
 * 不属于任务的等你也在这里），进行中的，和任务名额。系统问题和暂停的开关另从 /health、设置拿。
 */
export function overviewOf(pod: PodRuntime): Overview {
  const waits = pod.waits.open()
  const snapshots = openRootTasks(pod.db, 300)
    .map((task) => pod.tasks.snapshot(task.id))
    .filter((snapshot): snapshot is TaskSnapshot => snapshot !== undefined)
  const asking = snapshots.filter((snapshot) => stageGroup(snapshot.stage) === 'attention')
  const covered = new Set(asking.filter((snapshot) => snapshot.stage === 'waiting').map((snapshot) => snapshot.task.rootId))
  const loose: readonly AttentionItem[] = waits
    .filter((wait) => wait.rootId === null || !covered.has(wait.rootId))
    .map((wait) => ({ key: wait.id, taskId: wait.rootId, title: wait.title, botId: wait.botId, stage: null, since: wait.createdAt, summary: wait.detail, wait }))
  return {
    attention: [...asking.map((snapshot) => attentionOf(pod, snapshot, waits)), ...loose].sort((left, right) => left.since - right.since),
    active: snapshots
      .filter((snapshot) => stageGroup(snapshot.stage) === 'active')
      .map(activeOf)
      .sort((left, right) => left.since - right.since),
    slots: { used: countRunning(pod.db), total: pod.settings.get().taskConcurrency },
  }
}

const STATE_RANK: Readonly<Record<MemberState, number>> = { blocked: 3, waiting: 2, working: 1, idle: 0 }

function memberState(task: Task, stage: TicketStage): MemberState {
  if (stage === 'blocked' || stage === 'failed' || stage === 'undelivered') return 'blocked'
  // 子任务等组长验收还算团队在做。
  if (stage === 'waiting' || (stage === 'review' && task.parentId === null)) return 'waiting'
  if (stage === 'running' || stage === 'queued' || stage === 'review') return 'working'
  return 'idle'
}

/** 群顶的团队状态：每个成员手上最要紧的那件（受阻 > 等你 > 在做），这个群里的任务优先。 */
export function teamStatusOf(pod: PodRuntime, roomId: string): readonly MemberStatus[] {
  const room = pod.rooms.get(roomId)
  if (room === undefined) return []
  const inRoom = (task: Task): boolean => task.roomId === room.id || (room.taskId !== null && task.rootId === room.taskId)
  return pod.rooms.members(room.id).map(({ botId }) => {
    const candidates = openTasksOf(pod.db, botId)
      .map((task) => {
        const stage = pod.engine.tickets.stageOf(task)
        return { task, stage, state: memberState(task, stage) }
      })
      .filter((item) => item.state !== 'idle')
      .sort((left, right) => STATE_RANK[right.state] - STATE_RANK[left.state] || Number(inRoom(right.task)) - Number(inRoom(left.task)))
    const top = candidates[0]
    if (top === undefined) return { botId, state: 'idle', taskId: null, title: null, since: null }
    const since = top.state === 'working' ? (pod.engine.runs.current(top.task.id)?.startedAt ?? top.task.startedAt ?? top.task.createdAt) : top.task.updatedAt
    return { botId, state: top.state, taskId: top.task.id, title: top.task.title, since }
  })
}

/** 一条消息的去向，每一步一行，带上任务名。 */
export function routesOf(pod: PodRuntime, messageId: string): readonly RouteView[] {
  return routesFor(pod.db, messageId).map((route) => ({ ...route, taskTitle: route.taskId === null ? null : (pod.tasks.get(route.taskId)?.title ?? null) }))
}

/** 消息开了或送进了哪个任务（搜索结果里“打开任务页”用）：最早的那次。 */
export function taskOfMessage(pod: PodRuntime, messageId: string): string | null {
  return routesFor(pod.db, messageId).find((route) => route.taskId !== null && (route.route === 'opened' || route.route === 'direct' || route.route === 'relayed'))?.taskId ?? null
}
