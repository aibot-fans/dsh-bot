import type { DatabaseSync } from 'node:sqlite'
import { activityState, t, type ActivityEntry, type ActivityItem, type ActivityJob, type ActivityMark, type ActivityState, type Room, type RoomActivity, type Task, type TaskSnapshot } from 'pod-domain'
import { activityMessages, activityProgress, activityRoots, getMessage, memberLines, ownerLines, type ActivityMessage, type ActivityProgress } from 'pod-store'

export interface ActivityDeps {
  readonly db: DatabaseSync
  readonly room: (roomId: string) => Room | undefined
  readonly task: (taskId: string) => Task | undefined
  readonly snapshot: (taskId: string) => TaskSnapshot | undefined
  readonly botName: (botId: string) => string | undefined
}

/** 一段对话里最多列最近几件活。 */
const JOBS = 50

/** 一行最多这么长。 */
const LINE = 80

/** 结果、回答、等你这几句：进展点了跳到它之后的第一句。 */
const SPOKEN: ReadonlySet<string> = new Set(['result', 'answer', 'wait'])

/** 一棵任务树在一段对话里的事实：记的进展、在这里说的话。 */
interface Tree {
  readonly snapshot: TaskSnapshot
  readonly root: Task
  readonly progress: readonly ActivityProgress[]
  readonly messages: readonly ActivityMessage[]
}

/** 一件活的开头：标题、你怎么说的、从什么时候算起。 */
interface Head {
  readonly key: string
  readonly title: string
  readonly said: string | null
  readonly saidMessageId: string | null
  readonly at: number
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

/** 你说的话：去掉开头点名的 @，取第一行。 */
function saidOf(text: string): string {
  return lineOf(text.replace(/^(?:@\S+\s+)+/, ''))
}

function treeOf(deps: ActivityDeps, roomId: string, snapshot: TaskSnapshot): Tree {
  return { snapshot, root: snapshot.task, progress: activityProgress(deps.db, snapshot.task.id), messages: activityMessages(deps.db, roomId, snapshot.task.id) }
}

/** 不是负责的 bot 记的、做的，名字写在前面。 */
function byline(deps: ActivityDeps, tree: Tree, botId: string | null, text: string): string {
  if (botId === null || botId === tree.root.ownerBotId) return text
  const name = deps.botName(botId)
  return name === undefined ? text : t('{name}：{text}', { name, text })
}

/**
 * 这段时间里的几行：记的进展（点了跳到它之后交的结果、回答或等你）、交给成员的、成员交上来的、成员那件停了的。
 */
function stepsOf(deps: ActivityDeps, tree: Tree, from: number, to: number): readonly ActivityEntry[] {
  const inside = (at: number | null): at is number => at !== null && at >= from && at < to
  const spoken = tree.messages.filter((message) => SPOKEN.has(message.purpose))
  const next = (taskId: string, at: number): string | null => spoken.find((message) => message.createdAt >= at && (message.taskId === taskId || message.taskId === tree.root.id))?.id ?? null
  const progress = tree.progress
    .filter((row) => inside(row.createdAt))
    .map((row): ActivityEntry => ({ at: row.createdAt, text: byline(deps, tree, row.author, lineOf(row.summary)), kind: 'step', state: null, botId: row.author, messageId: next(row.taskId, row.createdAt) }))
  const members = tree.snapshot.children.flatMap((child): readonly ActivityEntry[] => {
    const name = (child.ownerBotId === null ? undefined : deps.botName(child.ownerBotId)) ?? t('成员')
    const handoff: readonly ActivityEntry[] = inside(child.createdAt)
      ? [{ at: child.createdAt, text: t('交给{name}：{title}', { name, title: child.title }), kind: 'handoff', state: null, botId: child.ownerBotId, messageId: null }]
      : []
    const results = spoken
      .filter((message) => message.taskId === child.id && message.purpose === 'result' && inside(message.createdAt))
      .map((message): ActivityEntry => ({ at: message.createdAt, text: t('{name}交上来了：{title}', { name, title: child.title }), kind: 'step', state: 'done', botId: child.ownerBotId, messageId: message.id }))
    const stopped: readonly ActivityEntry[] =
      inside(child.endedAt) && child.endReason !== 'done' && child.status !== 'done'
        ? [
            {
              at: child.endedAt,
              text: child.endReason === 'dismissed' ? t('{name}那件不用做了：{title}', { name, title: child.title }) : t('{name}那件停了：{title}', { name, title: child.title }),
              kind: 'step',
              state: 'ended',
              botId: child.ownerBotId,
              messageId: null,
            },
          ]
        : []
    return [...handoff, ...results, ...stopped]
  })
  return [...progress, ...members].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
}

/** 现在这件活的最后一行：交的结果、等你的事、没做成的原因、停在哪，或者还在做。 */
function endOf(tree: Tree, state: ActivityState, from: number): ActivityEntry {
  const { snapshot, root } = tree
  const mine = tree.messages.filter((message) => message.taskId === root.id && message.createdAt >= from)
  const last = (test: (message: ActivityMessage) => boolean): ActivityMessage | undefined => mine.filter(test).at(-1)
  const entry = (at: number | null, text: string, messageId: string | null = null): ActivityEntry => ({ at, text, kind: 'end', state, botId: root.ownerBotId, messageId })
  switch (state) {
    case 'done': {
      const result = last((message) => message.purpose === 'result') ?? last((message) => message.purpose === 'answer')
      return result === undefined ? entry(root.endedAt ?? root.updatedAt, t('做完了')) : entry(result.createdAt, t('交了结果：{line}', { line: lineOf(result.body) }), result.id)
    }
    case 'ended':
      return entry(root.endedAt, root.endReason === 'dismissed' ? t('看过了，不用做') : t('停了'))
    case 'paused':
      return entry(root.pausedAt, t('暂停了'))
    case 'failed': {
      const why = last((message) => message.purpose === 'wait' && message.kind === 'text')
      const reason = why?.body ?? (snapshot.lastReport?.status === 'failed' ? snapshot.lastReport.summary : '')
      return entry(why?.createdAt ?? snapshot.lastReport?.createdAt ?? null, reason === '' ? t('没做成') : t('没做成：{reason}', { reason: lineOf(reason) }), why?.id ?? null)
    }
    case 'attention': {
      const card = last((message) => message.kind === 'wait')
      const question = snapshot.question?.title
      const text =
        question !== undefined
          ? t('等你：{question}', { question: lineOf(question) })
          : snapshot.stage === 'undelivered'
            ? t('消息没送到')
            : snapshot.stage === 'review'
              ? t('等你看一下结果')
              : t('等你')
      return entry(card?.createdAt ?? snapshot.question?.createdAt ?? null, text, card?.id ?? null)
    }
    case 'moving':
      return entry(null, snapshot.stage === 'queued' ? t('排队中') : snapshot.stage === 'idle' ? t('等成员交上来') : t('在做'))
    case 'still':
      return entry(null, snapshot.stage === 'scheduled' ? t('等到点') : t('等新消息'))
  }
}

/** 任务对话里早先的一段：最后说的那句就是它的结果（交的结果、回答、问你的、没做成）。 */
function pastEndOf(tree: Tree, from: number, to: number): ActivityEntry | undefined {
  const said = tree.messages.filter((message) => message.taskId === tree.root.id && SPOKEN.has(message.purpose) && message.createdAt >= from && message.createdAt < to).at(-1)
  if (said === undefined) return undefined
  const line = lineOf(said.body)
  const entry = (state: ActivityState, text: string): ActivityEntry => ({ at: said.createdAt, text, kind: 'end', state, botId: tree.root.ownerBotId, messageId: said.id })
  if (said.purpose === 'result') return entry('done', t('交了结果：{line}', { line }))
  if (said.purpose === 'answer') return entry('done', t('回了：{line}', { line }))
  if (said.kind === 'wait') return entry('done', t('问了你：{line}', { line }))
  return entry('failed', t('没做成：{reason}', { reason: line }))
}

/** 负责的 bot 在前，后面是这段时间里交给过的成员。 */
function botsOf(tree: Tree, from: number, to: number): readonly string[] {
  const members = tree.snapshot.children.filter((child) => child.createdAt >= from && child.createdAt < to).map((child) => child.ownerBotId)
  return [...new Set([tree.root.ownerBotId, ...members])].filter((id): id is string => id !== null)
}

/** 交代这件事时你的原话（开任务时带进来的最后一句）；不是你交代的是 undefined。 */
function ownerQuote(root: Task): { readonly text: string; readonly messageId: string | null } | undefined {
  if (root.origin?.kind !== 'owner') return undefined
  const quote = root.origin.quotes.at(-1)
  return quote === undefined ? undefined : { text: quote.text, messageId: quote.messageId }
}

function jobOf(deps: ActivityDeps, tree: Tree, head: Head, state: ActivityState, from: number, to: number, end: ActivityEntry | undefined): ActivityJob {
  const steps = stepsOf(deps, tree, from, to)
  return {
    kind: 'job',
    key: head.key,
    taskId: tree.root.id,
    title: head.title,
    state,
    at: head.at,
    botIds: botsOf(tree, from, to),
    said: head.said,
    saidMessageId: head.saidMessageId,
    entries: end === undefined ? steps : [...steps, end],
  }
}

/** 群里、单聊里交代的一件活：从开始到现在都在一组里。 */
function sharedJob(deps: ActivityDeps, roomId: string, snapshot: TaskSnapshot): ActivityJob {
  const tree = treeOf(deps, roomId, snapshot)
  const { root } = tree
  const quote = ownerQuote(root)
  const quoted = quote?.messageId === null || quote === undefined ? undefined : getMessage(deps.db, quote.messageId)
  const brief = tree.messages.find((message) => message.purpose === 'brief')
  const head: Head = {
    key: root.id,
    title: root.title,
    said: quote === undefined ? null : saidOf(quote.text),
    saidMessageId: quoted !== undefined && quoted.roomId === roomId ? quoted.id : (brief?.id ?? null),
    at: root.createdAt,
  }
  const state = activityState(snapshot)
  return jobOf(deps, tree, head, state, 0, Number.POSITIVE_INFINITY, endOf(tree, state, 0))
}

/**
 * 任务对话（另开的单聊、任务群）里的活：交代一组，之后你每接着说一次一组（Super-agent 转来的后续也算）。
 * 早先的几组以那段最后说的那句收尾；什么都没有的不列（交代那组和还没结束的最后一组除外）。
 */
function conversationJobs(deps: ActivityDeps, room: Room, rootId: string): readonly ActivityJob[] {
  const snapshot = deps.snapshot(rootId)
  if (snapshot === undefined) return []
  const tree = treeOf(deps, room.id, snapshot)
  const { root } = tree
  const state = activityState(snapshot)
  const brief = tree.messages.find((message) => message.purpose === 'brief')
  const start = brief?.createdAt ?? root.createdAt
  const quote = ownerQuote(root)
  const follows = [
    ...ownerLines(deps.db, room.id).map((line) => ({ id: line.id, body: line.body, at: line.createdAt })),
    ...tree.messages.filter((message) => message.purpose === 'followup').map((message) => ({ id: message.id, body: message.body, at: message.createdAt })),
  ]
    .filter((follow) => follow.at > start)
    .sort((a, b) => a.at - b.at)
  const heads: readonly Head[] = [
    { key: root.id, title: root.title, said: quote === undefined ? null : saidOf(quote.text), saidMessageId: brief?.id ?? null, at: start },
    ...follows.map((follow) => ({ key: follow.id, title: t('接着说'), said: saidOf(follow.body), saidMessageId: follow.id, at: follow.at })),
  ]
  const live = state !== 'done' && state !== 'ended'
  return heads.flatMap((head, index) => {
    const from = index === 0 ? 0 : head.at
    const to = heads[index + 1]?.at ?? Number.POSITIVE_INFINITY
    const last = index === heads.length - 1
    const past = last ? undefined : pastEndOf(tree, from, to)
    const job = jobOf(deps, tree, head, last ? state : (past?.state ?? 'ended'), from, to, last ? endOf(tree, state, from) : past)
    if (index === 0 || (last && live)) return [job]
    // 结束了的最后一组只有收尾那一行、这段时间里其实没说什么（比如你说了句谢谢），不列。
    const said = tree.messages.some((message) => SPOKEN.has(message.purpose) && message.createdAt >= from && message.createdAt < to)
    return job.entries.some((entry) => entry.kind !== 'end') || said ? [job] : []
  })
}

/** 一段对话的动态：任务对话按交代和接着说分组；群、单聊里一件活一组，群里加上建群、进群出群。 */
export function roomActivity(deps: ActivityDeps, roomId: string): RoomActivity | undefined {
  const room = deps.room(roomId)
  if (room === undefined) return undefined
  if (room.taskId !== null) return { roomId, items: conversationJobs(deps, room, room.taskId) }
  const marks: readonly ActivityMark[] =
    room.kind === 'direct'
      ? []
      : [
          { kind: 'mark', key: `created:${room.id}`, at: room.createdAt, text: t('建了群'), mark: 'created' },
          ...memberLines(deps.db, roomId).map((line): ActivityMark => ({ kind: 'mark', key: line.id, at: line.createdAt, text: line.body, mark: 'member' })),
        ]
  const jobs = activityRoots(deps.db, roomId, JOBS).flatMap((id) => {
    const snapshot = deps.snapshot(id)
    return snapshot === undefined ? [] : [sharedJob(deps, roomId, snapshot)]
  })
  const items: readonly ActivityItem[] = [...marks, ...jobs].sort((a, b) => a.at - b.at)
  return { roomId, items }
}

/** 任务详情里的动态：有自己任务对话的按那段对话分组，没有的就是它在派活的对话里那一组。 */
export function taskActivity(deps: ActivityDeps, taskId: string): readonly ActivityJob[] | undefined {
  const task = deps.task(taskId)
  const snapshot = task === undefined ? undefined : deps.snapshot(task.rootId)
  if (snapshot === undefined) return undefined
  const rooms = [snapshot.conversationId, snapshot.groupRoomId].flatMap((id) => (id === null ? [] : [deps.room(id)])).filter((room): room is Room => room !== undefined)
  const own = rooms.find((room) => room.taskId === snapshot.task.id)
  if (own !== undefined) return conversationJobs(deps, own, snapshot.task.id)
  const roomId = rooms[0]?.id ?? snapshot.task.roomId
  return roomId === null ? [] : [sharedJob(deps, roomId, snapshot)]
}
