import { OWNER, POD, truncate, type Task, type TaskRun } from 'pod-domain'
import { getRoom, getSession, listTaskTree, readState, reportsFor, runsFor, taskConversationOf, taskRoomOf } from 'pod-store'
import { textOf } from '../../agents/messages.ts'
import type { SessionEvent } from '../../dsh.ts'
import { flat, type RecordDeps } from './records.ts'
import type { DreamRecord, Mark, RecordLine } from './types.ts'

/** 第一次整理只回看最近这么久结束的任务。 */
const FIRST_LOOKBACK_MS = 30 * 86_400_000
/** 一件事最多带几段会话、一共多少句；多的只留每段的开头和结尾。 */
const SESSIONS_MAX = 5
const SESSION_LINES_MAX = 160
/** 群里的话、汇报各最多几句。 */
const CHAT_LINES_MAX = 30
const REPORTS_MAX = 10
const TEXT_MAX = 500
const CALL_MAX = 220
const RESULT_MAX = 260
/** 常开任务每隔这么久抽一轮正常的来读。 */
const SAMPLE_EVERY_MS = 7 * 86_400_000

/** 一次性任务读到了哪个结束时间。 */
const TASKS_KEY = 'memory.dream.tasks'

function runKey(taskId: string): string {
  return `memory.dream.runs.${taskId}`
}

function sampleKey(taskId: string): string {
  return `memory.dream.sample.${taskId}`
}

export interface TaskRecordDeps extends RecordDeps {
  /** 读一段会话在 from 到 to 之间的日志；读不了返回空的。 */
  readonly sessionEvents: (sessionId: string, from: number, to: number) => Promise<readonly SessionEvent[]>
  /** 任务交进了哪个群：群里定的事归它。 */
  readonly groupOf: (taskId: string) => string | undefined
}

type Loose = Omit<RecordLine, 'at'>

/** 记账用的工具（汇报、回话、记计划、定闹钟）：调用和结果都不算干活的过程，不放进回放。 */
const BOOKKEEPING = new Set(['report', 'complete_task', 'reply', 'todo_write', 'wake_me', 'task_status', 'remember', 'recall'])
/** dsh 自己塞进会话的环境说明（工作目录、时间）：不是谁说的话。 */
const HOST_CONTEXT = new Set(['runtime-context', 'time-context'])

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {}
}

/**
 * 一段会话日志排成一句句：送进会话的话、bot 说的话、它调用的工具、工具的结果。只要 from 到 to 之间的（常开任务一段会话里有很多轮）。
 * 工具结果截短；出错的结果标出来，踩过的坑多半在那里。
 */
export function sessionLines(events: readonly SessionEvent[], session: { readonly id: string; readonly botId: string; readonly botName: string }, window: { readonly from: number; readonly to: number }): readonly Loose[] {
  const lines: Loose[] = []
  const ref = `session:${session.id}`
  const quiet = new Set<string>()
  for (const event of events) {
    if (event.time > 0 && (event.time < window.from || event.time > window.to)) continue
    const data = record(event.data)
    if (event.type === 'user/message') {
      const text = flat(textOf(data.content))
      const kind = record(data.source).kind
      if (text === '' || (typeof kind === 'string' && HOST_CONTEXT.has(kind))) continue
      const typed = kind === 'user'
      lines.push({ ref, by: typed ? 'owner' : 'pod', name: typed ? '用户' : 'dsh-bot 送进会话的', botId: session.botId, text: truncate(text, TEXT_MAX) })
    } else if (event.type === 'assistant/message') {
      const text = flat(textOf(record(data.message).content))
      if (text !== '') lines.push({ ref, by: 'bot', name: session.botName, botId: session.botId, text: truncate(text, TEXT_MAX) })
    } else if (event.type === 'tool/call') {
      const name = typeof data.name === 'string' ? data.name : 'tool'
      const args = typeof data.arguments === 'string' ? flat(data.arguments) : ''
      if (BOOKKEEPING.has(name)) {
        if (typeof data.callId === 'string') quiet.add(data.callId)
        continue
      }
      lines.push({ ref, by: 'bot', name: `${session.botName} 调用 ${name}`, botId: session.botId, text: truncate(args, CALL_MAX) })
    } else if (event.type === 'tool/result') {
      const message = record(data.message)
      const text = flat(textOf(message.content))
      if (text === '' || (typeof message.toolCallId === 'string' && quiet.has(message.toolCallId))) continue
      const failed = message.isError === true || /^\s*\{"ok":false\b/.test(text) || /\[exit code: [1-9]\d*\]/.test(text)
      lines.push({ ref, by: 'tool', name: failed ? '工具结果（出错）' : '工具结果', botId: session.botId, text: truncate(text, RESULT_MAX) })
    }
  }
  return lines
}

/** 太长的一段会话只留开头几句和结尾的大半：开头是交代，结尾是怎么收的。 */
function trim(lines: readonly Loose[], max: number): readonly Loose[] {
  if (lines.length <= max) return lines
  const head = Math.floor(max / 4)
  const cut = lines.length - max
  return [...lines.slice(0, head), { ...(lines[head] as Loose), by: 'pod', name: 'dsh-bot', text: `（中间 ${cut} 句没有放进来）` }, ...lines.slice(lines.length - (max - head - 1))]
}

function number(lines: readonly Loose[]): readonly RecordLine[] {
  return lines.map((line, index) => ({ ...line, at: `m${index + 1}` }))
}

interface Piece {
  readonly task: Task
  readonly runs: readonly TaskRun[]
}

/**
 * 一件事拼成一份记录：交代、群里的话、各成员的任务会话（只取 runs 里那几次执行的时段）、汇报和结果。
 * 读过网页的会话在里面，这份记录就算带污点。
 */
async function compose(deps: TaskRecordDeps, root: Task, pieces: readonly Piece[], id: string, marks: readonly Mark[], whole: boolean): Promise<DreamRecord | undefined> {
  const { db } = deps
  // 一次性任务看它从建到结束的整段；常开任务的一轮只看那一轮的时段。
  const starts = pieces.flatMap((piece) => piece.runs.map((run) => run.startedAt ?? run.queuedAt))
  const ends = pieces.flatMap((piece) => piece.runs.map((run) => run.endedAt ?? run.startedAt ?? run.queuedAt))
  const from = Math.min(...starts, ...(whole || starts.length === 0 ? [root.createdAt] : []))
  const to = Math.max(...ends, ...(whole || ends.length === 0 ? [root.endedAt ?? root.updatedAt] : [])) + 5 * 60_000
  const lines: Loose[] = []
  // 你当时的原话单独成句：从里面找到的规矩算你亲口说的。
  for (const quote of root.origin?.quotes ?? []) {
    if (quote.author === OWNER && quote.text.trim() !== '') lines.push({ ref: quote.messageId === null ? `task:${root.id}` : `message:${quote.messageId}`, by: 'owner', name: '用户', botId: null, text: truncate(flat(quote.text), 1200) })
  }
  const brief = [root.title, root.brief].filter((part) => part !== '').join('；')
  lines.push({ ref: `task:${root.id}`, by: 'pod', name: '交代', botId: root.ownerBotId, text: truncate(flat(brief), 900) })

  // 群里的话：任务交进的群、任务群或它自己的对话里，这段时间说过的。
  const roomId = taskRoomOf(db, root.id)?.id ?? taskConversationOf(db, root.id)?.id ?? root.roomId
  const room = roomId === null ? undefined : getRoom(db, roomId)
  if (room !== undefined) {
    const rows = db
      .prepare("SELECT id, author, body FROM messages WHERE room_id = ? AND kind = 'text' AND deleted_at IS NULL AND created_at BETWEEN ? AND ? ORDER BY seq DESC LIMIT ?")
      .all(room.id, from - 60_000, to, CHAT_LINES_MAX) as unknown as readonly { readonly id: string; readonly author: string; readonly body: string }[]
    for (const row of [...rows].reverse()) {
      if (row.author === POD || row.body.trim() === '') continue
      const owner = row.author === OWNER
      lines.push({ ref: `message:${row.id}`, by: owner ? 'owner' : 'bot', name: owner ? '用户' : (deps.botName(row.author) ?? 'bot'), botId: owner ? null : row.author, text: truncate(flat(row.body), owner ? 1200 : 320) })
    }
  }

  // 各成员的任务会话。
  let tainted = pieces.some((piece) => piece.task.tainted)
  const sessions = new Map<string, { from: number; to: number }>()
  for (const piece of pieces) {
    for (const run of piece.runs) {
      if (run.sessionId === null) continue
      const start = run.startedAt ?? run.queuedAt
      const end = (run.endedAt ?? start) + 60_000
      const known = sessions.get(run.sessionId)
      sessions.set(run.sessionId, known === undefined ? { from: start, to: end } : { from: Math.min(known.from, start), to: Math.max(known.to, end) })
    }
  }
  const picked = [...sessions.entries()].slice(-SESSIONS_MAX)
  const each = Math.max(30, Math.floor(SESSION_LINES_MAX / Math.max(1, picked.length)))
  for (const [sessionId, window] of picked) {
    const session = getSession(db, sessionId)
    if (session === undefined) continue
    if (session.tainted) tainted = true
    const events = await deps.sessionEvents(sessionId, window.from, window.to)
    lines.push(...trim(sessionLines(events, { id: sessionId, botId: session.botId, botName: deps.botName(session.botId) ?? 'bot' }, window), each))
  }

  // 汇报和结果。
  for (const piece of pieces) {
    for (const report of [...reportsFor(db, piece.task.id, REPORTS_MAX)].reverse()) {
      if (report.status === 'progress' || report.createdAt < from || report.createdAt > to) continue
      const text = [report.summary, report.report, report.question].filter((part) => part !== '').join('；')
      if (text === '') continue
      const author = report.author === 'pod' ? null : report.author
      lines.push({ ref: `task:${piece.task.id}`, by: author === null ? 'pod' : 'bot', name: `${author === null ? 'dsh-bot' : (deps.botName(author) ?? 'bot')} 的汇报（${report.status}）`, botId: author ?? piece.task.ownerBotId, text: truncate(flat(text), 700) })
    }
  }
  if (whole && root.endReason !== null) lines.push({ ref: `task:${root.id}`, by: 'pod', name: '怎么结束的', botId: root.ownerBotId, text: root.endReason === 'done' ? '做完了' : root.endReason === 'stopped' ? '用户停掉了' : '不用处理了' })
  if (lines.length <= 2) return undefined
  const group = deps.groupOf(root.id)
  return {
    id,
    kind: 'task',
    title: `任务「${truncate(root.title, 40)}」`,
    time: to - 5 * 60_000,
    roomId: group ?? null,
    botId: root.ownerBotId,
    tainted,
    lines: number(lines),
    marks,
  }
}

function standing(deps: TaskRecordDeps): readonly string[] {
  const rows = deps.db.prepare('SELECT DISTINCT task_id FROM triggers WHERE closed_at IS NULL').all() as unknown as readonly { readonly task_id: string }[]
  return rows.map((row) => row.task_id)
}

/**
 * 挑任务：上次整理之后结束的一次性任务，一件事一份记录；常开任务只挑出过问题的、你插过话的那几轮，另外每周抽一轮正常的。
 * 还开着的一次性任务跳过，结束了再读。最多 limit 份，剩下的下次读。
 */
export async function taskRecords(deps: TaskRecordDeps, limit: number): Promise<{ readonly records: readonly DreamRecord[]; readonly skipped: readonly Mark[] }> {
  const { db } = deps
  const now = deps.now()
  const records: DreamRecord[] = []
  const skipped: Mark[] = []
  const repeating = new Set(standing(deps))

  const since = readState<number>(db, TASKS_KEY, now - FIRST_LOOKBACK_MS)
  const ended = db
    .prepare('SELECT id, ended_at FROM tasks WHERE parent_id IS NULL AND deleted_at IS NULL AND ended_at IS NOT NULL AND ended_at > ? ORDER BY ended_at ASC LIMIT ?')
    .all(since, limit * 2) as unknown as readonly { readonly id: string; readonly ended_at: number }[]
  for (const row of ended) {
    if (records.length >= limit) break
    const mark: Mark = { key: TASKS_KEY, value: row.ended_at }
    if (repeating.has(row.id)) {
      skipped.push(mark)
      continue
    }
    const tree = listTaskTree(db, row.id)
    const root = tree.find((task) => task.id === row.id)
    if (root === undefined) continue
    const pieces = tree.map((task) => ({ task, runs: runsFor(db, task.id, 20).filter((run) => run.status === 'ended') }))
    const made = await compose(deps, root, pieces, `task:${root.id}`, [mark], true)
    if (made === undefined) skipped.push(mark)
    else records.push(made)
  }

  for (const taskId of repeating) {
    if (records.length >= limit) break
    const tree = listTaskTree(db, taskId)
    const root = tree.find((task) => task.id === taskId)
    if (root === undefined) continue
    const read = readState<number>(db, runKey(taskId), now - FIRST_LOOKBACK_MS)
    const runs = [...runsFor(db, taskId, 200)].reverse().filter((run) => run.status === 'ended' && (run.endedAt ?? 0) > read)
    if (runs.length === 0) continue
    const last = runs.at(-1)?.endedAt ?? read
    const troubled = runs.filter((run) => run.reason === 'message' || (run.outcome !== 'reported' && run.outcome !== null) || reportsFor(db, taskId, 100).some((report) => report.runId === run.id && (report.status === 'blocked' || report.status === 'failed')))
    const sampled = now - readState<number>(db, sampleKey(taskId), 0) >= SAMPLE_EVERY_MS ? runs.filter((run) => !troubled.includes(run)).at(-1) : undefined
    const chosen = [...troubled.slice(-3), ...(sampled === undefined ? [] : [sampled])]
    const marks: Mark[] = [{ key: runKey(taskId), value: last }, ...(sampled === undefined ? [] : [{ key: sampleKey(taskId), value: now }])]
    if (chosen.length === 0) {
      skipped.push(...marks)
      continue
    }
    for (const [index, run] of chosen.entries()) {
      if (records.length >= limit) break
      const made = await compose(deps, root, [{ task: root, runs: [run] }], `run:${run.id}`, index === chosen.length - 1 ? marks : [], false)
      if (made !== undefined) records.push({ ...made, title: `常开任务「${truncate(root.title, 36)}」的一轮` })
      else if (index === chosen.length - 1) skipped.push(...marks)
    }
  }
  return { records, skipped }
}
