import type { DatabaseSync } from 'node:sqlite'
import { activityState, t, type Activity, type ActivityGroup, type ActivityRequest, type Room, type RoomActivity, type Task, type TaskSnapshot, type Wait } from 'pod-domain'
import { activityMessages, activityReports, activityRoots, activityRuns, getMessage, waitsForRoot, type ActivityMessage, type ActivityReport } from 'pod-store'

export interface ActivityDeps {
  readonly db: DatabaseSync
  readonly room: (roomId: string) => Room | undefined
  readonly task: (taskId: string) => Task | undefined
  readonly snapshot: (taskId: string) => TaskSnapshot | undefined
  readonly botName: (botId: string) => string | undefined
}

/** 一段对话里最多看最近动过的几件事。 */
const ROOTS = 50

/** 一行最多这么长。 */
const LINE = 80

/** 结果、回答、等你这几句：做成的一步点了跳到它之后的第一句。 */
const SPOKEN: ReadonlySet<string> = new Set(['result', 'answer', 'wait'])

/** 一件事（一棵任务树）在一段对话里的几样：做成的几步、在这里说的话。 */
interface Tree {
  readonly snapshot: TaskSnapshot
  readonly root: Task
  readonly reports: readonly ActivityReport[]
  readonly messages: readonly ActivityMessage[]
}

/** 一组的开头：按哪句话认（同一句话叫起来的几件事并成一组）、写什么。 */
interface Head {
  readonly key: string
  readonly request: ActivityRequest
}

/** 第一行有字的，去掉列表、标题、加粗这些记号，太长截断。 */
function lineOf(text: string): string {
  const line =
    text
      .split('\n')
      .map((part) =>
        part
          .replace(/^\s*(?:#+|>+|[-*+]|\d+[.)])\s+/, '')
          .replace(/\*\*|__|`/g, '')
          .trim(),
      )
      .find((part) => part !== '') ?? ''
  return line.length > LINE ? `${line.slice(0, LINE - 1)}…` : line
}

/** 说的一句：去掉开头点名的 @，取第一行。 */
function saidOf(text: string): string {
  return lineOf(text.replace(/^(?:@\S+\s+)+/, ''))
}

function treeOf(deps: ActivityDeps, roomId: string | null, snapshot: TaskSnapshot): Tree {
  return {
    snapshot,
    root: snapshot.task,
    reports: activityReports(deps.db, snapshot.task.id),
    messages: roomId === null ? [] : activityMessages(deps.db, roomId, snapshot.task.id),
  }
}

/**
 * 这件事怎么开始的：任务自己的动态里是“创建了任务”；群里、单聊里是交代它的那句话
 * （你说的原话；Super-agent、组长转来的是交代的第一行，没有就是任务名）。
 */
function startOf(deps: ActivityDeps, tree: Tree, own: boolean): Head {
  const { root } = tree
  if (own) return { key: root.id, request: { kind: 'task', text: '', at: root.createdAt } }
  const quote = root.origin?.kind === 'owner' ? root.origin.quotes.at(-1) : undefined
  if (quote !== undefined) {
    const quoted = quote.messageId === null ? undefined : getMessage(deps.db, quote.messageId)
    return { key: quoted?.id ?? root.id, request: { kind: 'said', text: saidOf(quote.text), at: Math.min(quoted?.createdAt ?? root.createdAt, root.createdAt) } }
  }
  const brief = lineOf(tree.messages.find((message) => message.purpose === 'brief')?.body ?? '')
  return { key: root.id, request: { kind: 'said', text: brief === '' ? root.title : brief, at: root.createdAt } }
}

/** 回答等你的事那一轮，送进来的是“问的事：回答”：只写你的回答（点了不用管是“不用处理”，跳过的是“跳过了”）。 */
function answerOf(waits: readonly Wait[], text: string): string | undefined {
  const wait = waits.find((item) => item.title !== '' && text.startsWith(`${item.title}：`))
  if (wait === undefined) return undefined
  return lineOf(wait.answer !== null && wait.answer !== '' ? wait.answer : text.slice(wait.title.length + 1))
}

/** 后来叫起这件事的每一轮：一句话（你接着说的、转来的、你的回答）开一组，到点跑的一轮开一组。 */
function followsOf(deps: ActivityDeps, root: Task): readonly Head[] {
  const runs = activityRuns(deps.db, root.id)
  const waits = runs.some((run) => run.said !== null && run.said.id === null) ? waitsForRoot(deps.db, root.id) : []
  return runs.flatMap((run): readonly Head[] => {
    if (run.reason === 'trigger') return [{ key: run.id, request: { kind: 'run', text: '', at: run.at } }]
    if (run.said === null) return []
    const text = (run.said.id === null ? answerOf(waits, run.said.text) : undefined) ?? saidOf(run.said.text)
    return [{ key: run.said.id ?? run.id, request: { kind: 'said', text, at: run.at } }]
  })
}

/** 不是这件事负责的 bot 记的，名字写在前面。 */
function titleOf(deps: ActivityDeps, tree: Tree, report: ActivityReport): string {
  const text = lineOf(report.summary)
  if (report.author === '' || report.author === tree.root.ownerBotId) return text
  const name = deps.botName(report.author)
  return name === undefined ? text : t('{name}：{text}', { name, text })
}

/** 这一步点了跳到哪：之后这件事交的结果、回答、等你（到下一组开始为止），没有就是这一步之前这件事在这里说的最后一句。 */
function linkOf(tree: Tree, at: number, until: number): string | null {
  const after = tree.messages.find((message) => SPOKEN.has(message.purpose) && message.createdAt >= at && message.createdAt < until)
  return after?.id ?? tree.messages.filter((message) => message.createdAt <= at).at(-1)?.id ?? null
}

/**
 * 一件事的几组：开头一组，之后每一轮一组；做成的每一步归在它之前最近开始的那一组。
 * 还在干的话，最后一组多一行“正在处理…”。own 是任务自己的动态（开头写“创建了任务”）。
 */
function treeGroups(deps: ActivityDeps, tree: Tree, own: boolean): readonly ActivityGroup[] {
  const heads = [startOf(deps, tree, own), ...followsOf(deps, tree.root)]
  const placeOf = (at: number): number => Math.max(0, heads.findLastIndex((head) => head.request.at <= at))
  const placed = tree.reports.map((report) => ({ report, index: placeOf(report.createdAt) }))
  const live = activityState(tree.snapshot) === 'moving'
  return heads.map((head, index) => {
    const until = heads[index + 1]?.request.at ?? Number.POSITIVE_INFINITY
    const steps = placed
      .filter((item) => item.index === index)
      .map(({ report }) => ({ title: titleOf(deps, tree, report), at: report.createdAt, messageId: linkOf(tree, report.createdAt, until) }))
    return { key: head.key, request: head.request, steps, live: live && index === heads.length - 1 }
  })
}

/** 同一句话叫起来的几件事并成一组，按开始的先后排。 */
function merged(groups: readonly ActivityGroup[]): readonly ActivityGroup[] {
  const keys = [...new Set(groups.map((group) => group.key))]
  return keys
    .map((key): ActivityGroup => {
      const same = groups.filter((group) => group.key === key)
      const first = same[0] as ActivityGroup
      const steps = same.flatMap((group) => group.steps).sort((a, b) => a.at - b.at)
      return { key, request: first.request, steps, live: same.some((group) => group.live) }
    })
    .sort((a, b) => a.request.at - b.request.at)
}

/** 一步都没有、也不在干的组不列；建群、创建任务那一行总在。 */
function kept(groups: readonly ActivityGroup[]): readonly ActivityGroup[] {
  return groups.filter((group) => group.steps.length > 0 || group.live || group.request.kind === 'group' || group.request.kind === 'task')
}

/** 一件事自己的动态：开头是创建了任务，之后每次接着说、每一轮一组。 */
function ownActivity(deps: ActivityDeps, roomId: string | null, snapshot: TaskSnapshot): Activity {
  return { groups: kept(treeGroups(deps, treeOf(deps, roomId, snapshot), true)) }
}

/** 一段对话的动态：任务自己的对话就是这件任务的；群、单聊里是在这里交代的每件事，群的最上面是建群。 */
export function roomActivity(deps: ActivityDeps, roomId: string): RoomActivity | undefined {
  const room = deps.room(roomId)
  if (room === undefined) return undefined
  if (room.taskId !== null) {
    const snapshot = deps.snapshot(room.taskId)
    return { roomId, groups: snapshot === undefined ? [] : ownActivity(deps, roomId, snapshot).groups }
  }
  const trees = activityRoots(deps.db, roomId, ROOTS).flatMap((id) => {
    const snapshot = deps.snapshot(id)
    return snapshot === undefined ? [] : [treeOf(deps, roomId, snapshot)]
  })
  const created: readonly ActivityGroup[] = room.kind === 'direct' ? [] : [{ key: room.id, request: { kind: 'group', text: '', at: room.createdAt }, steps: [], live: false }]
  return { roomId, groups: [...created, ...kept(merged(trees.flatMap((tree) => treeGroups(deps, tree, false))))] }
}

/** 任务详情里的动态，和任务对话里的一样。 */
export function taskActivity(deps: ActivityDeps, taskId: string): Activity | undefined {
  const task = deps.task(taskId)
  const snapshot = task === undefined ? undefined : deps.snapshot(task.rootId)
  if (snapshot === undefined) return undefined
  const rooms = [snapshot.conversationId, snapshot.groupRoomId].flatMap((id) => (id === null ? [] : [deps.room(id)])).filter((room): room is Room => room !== undefined)
  const roomId = rooms.find((room) => room.taskId === snapshot.task.id)?.id ?? rooms[0]?.id ?? snapshot.task.roomId
  return ownActivity(deps, roomId, snapshot)
}
