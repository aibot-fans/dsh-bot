import { OWNER, POD, PAGE_KIND_LABELS, formatLocal, REPORT_STATUS_LABELS, ROUTE_LABELS, WAIT_KIND_LABELS, oneLine, truncate, type PodSession, type RoomMessage, type TaskReport, type TaskRun } from 'pod-domain'
import { getMessage, getReport, getRun, getTaskEvent, listTaskEvents, reportsFor, runsFor, type TaskEvent } from 'pod-store'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { failure, int, oneOf, podTool, str, success, text } from './define.ts'

/** 正文一页默认多少字、最多多少字；列表一页默认几条、最多几条。 */
const PAGE_CHARS = 4000
const PAGE_CHARS_MAX = 8000
const PAGE_ITEMS = 20
const PAGE_ITEMS_MAX = 50

/** 任务的几个部分：概要（默认）、事件、执行、汇报。 */
const PARTS = ['events', 'runs', 'reports'] as const
type Part = (typeof PARTS)[number]

interface Paging {
  readonly page: number
  readonly size: number | null
}

interface Request {
  readonly id: string
  readonly part: Part | null
  readonly paging: Paging
}

/** 正文按页切；不止一页时末尾说第几页、下一页怎么读。 */
function pageOf(body: string, paging: Paging, id: string): string {
  const size = Math.min(PAGE_CHARS_MAX, Math.max(500, paging.size ?? PAGE_CHARS))
  const pages = Math.max(1, Math.ceil(body.length / size))
  const page = Math.min(paging.page, pages)
  const slice = body.slice((page - 1) * size, page * size)
  if (pages === 1) return slice
  return `${slice}\n……（第 ${page}/${pages} 页${page < pages ? `，下一页：read ${id} page=${page + 1}` : ''}）`
}

/** 列表按页取（新的在前）；后面还有就说下一页怎么读。 */
function listOf<T>(items: readonly T[], paging: Paging, line: (item: T) => string, next: string): string {
  const size = Math.min(PAGE_ITEMS_MAX, Math.max(1, paging.size ?? PAGE_ITEMS))
  const start = (paging.page - 1) * size
  const shown = items.slice(start, start + size)
  if (shown.length === 0) return items.length === 0 ? '（没有）' : '（这一页没有了）'
  const more = start + size < items.length ? `\n……（共 ${items.length} 条，下一页：${next} page=${paging.page + 1}）` : ''
  return `${shown.map(line).join('\n')}${more}`
}

/** 按设置里的时区写时间。 */
function when(pod: PodRuntime, at: number | null): string {
  return at === null ? '—' : formatLocal(at, pod.settings.get().timezone)
}

function authorOf(pod: PodRuntime, author: string): string {
  if (author === OWNER) return '用户'
  if (author === POD) return 'dsh-bot'
  if (author === 'watchdog') return '看门狗'
  return pod.bots.get(author)?.name ?? author
}

function messageText(pod: PodRuntime, message: RoomMessage, paging: Paging): string {
  const room = pod.rooms.get(message.roomId)
  const routes = pod.engine.topics.routes(message.id).map((route) => `${ROUTE_LABELS[route.route]}${route.taskId === null ? '' : ` ${route.taskId}`}${route.note === '' ? '' : `（${route.note}）`}`)
  return [
    `消息 ${message.id}：${authorOf(pod, message.author)}在「${room?.title ?? message.roomId}」，${when(pod, message.createdAt)}${message.replyTo === null ? '' : `，回复 ${message.replyTo}`}`,
    routes.length === 0 ? undefined : `去向：${routes.join('；')}`,
    pageOf(message.body, paging, message.id),
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n')
}

function runText(pod: PodRuntime, run: TaskRun): string {
  const messages = Array.isArray(run.detail.messages) ? run.detail.messages.length : 0
  return `执行 ${run.id}（任务 ${run.taskId}）：${run.status}，开工原因 ${run.reason}${run.outcome === null ? '' : `，结局 ${run.outcome}`}${run.error === null ? '' : `，出错：${run.error}`}；排队 ${when(pod, run.queuedAt)}，开始 ${when(pod, run.startedAt)}，结束 ${when(pod, run.endedAt)}${messages === 0 ? '' : `；带了 ${messages} 条消息`}`
}

/** 一条汇报：摘要、问题、回的哪条消息；全文时带报告（按页）和附带的文件、没核实的、假设。 */
function reportText(pod: PodRuntime, report: TaskReport, paging: Paging | null): string {
  const data = report.data
  const list = (key: string, label: string): string | undefined => (Array.isArray(data[key]) && data[key].length > 0 ? `${label}：${(data[key] as unknown[]).map(String).join('；')}` : undefined)
  const about = [report.aboutMessage === null ? '' : `问题针对 ${report.aboutMessage}`, report.replyMessage === null ? '' : `回的是 ${report.replyMessage}`].filter(Boolean).join('，')
  return [
    `汇报 ${report.id}（任务 ${report.taskId}，${authorOf(pod, report.author)}，${REPORT_STATUS_LABELS[report.status]}，${when(pod, report.createdAt)}）：${report.summary}`,
    report.question === '' ? undefined : `问题：${report.question}`,
    about === '' ? undefined : about,
    report.report === '' ? undefined : paging === null ? `报告：${truncate(oneLine(report.report), 200)}（全文：read ${report.id}）` : pageOf(report.report, paging, report.id),
    paging === null ? undefined : list('files', '产出文件'),
    paging === null ? undefined : list('unverified', '没核实'),
    paging === null ? undefined : list('assumptions', '假设'),
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n')
}

function eventText(pod: PodRuntime, event: TaskEvent): string {
  const data = Object.entries(event.data)
    .filter(([, value]) => value !== null && value !== '' && !(Array.isArray(value) && value.length === 0))
    .map(([key, value]) => `${key}=${typeof value === 'string' ? truncate(oneLine(value), 160) : JSON.stringify(value)}`)
    .join(' ')
  return `#${event.id} ${when(pod, event.createdAt)} ${authorOf(pod, event.actor)} ${event.kind}${data === '' ? '' : ` ${data}`}（任务 ${event.taskId}）`
}

/** 任务的概要：快照、说明、来由（原话带消息 id）、最近 3 次汇报和执行；更多按部分读。 */
function taskOverview(pod: PodRuntime, id: string, paging: Paging): string | undefined {
  const snapshot = pod.tasks.snapshotTextFor(id)
  const task = pod.tasks.get(id)
  if (snapshot === undefined || task === undefined) return undefined
  const quotes = (task.origin?.quotes ?? []).map((quote) => `- ${quote.author}${quote.messageId === null ? '' : `（${quote.messageId}）`}：${quote.text}`)
  const reports = reportsFor(pod.db, id, 3).map((report) => reportText(pod, report, null))
  const runs = runsFor(pod.db, id, 3).map((run) => runText(pod, run))
  const body = [
    snapshot,
    task.brief === '' ? undefined : `说明：\n${task.brief}`,
    quotes.length === 0 ? undefined : `来由（原话）：\n${quotes.join('\n')}`,
    reports.length === 0 ? undefined : `最近的汇报（新的在前；全文按汇报 id 读，全部用 read ${id} part=reports）：\n${reports.join('\n\n')}`,
    runs.length === 0 ? undefined : `最近的执行（全部用 read ${id} part=runs）：\n${runs.join('\n')}`,
    `事件（决策链）用 read ${id} part=events。`,
  ]
    .filter((part): part is string => part !== undefined)
    .join('\n\n')
  return pageOf(body, paging, id)
}

function taskPart(pod: PodRuntime, id: string, part: Part, paging: Paging): string | undefined {
  const task = pod.tasks.get(id)
  if (task === undefined) return undefined
  const next = `read ${id} part=${part}`
  if (part === 'events') {
    const events = listTaskEvents(pod.db, task.rootId).filter((event) => event.taskId === id).reverse()
    return `任务 ${id} 的事件（新的在前）：\n${listOf(events, paging, (event) => eventText(pod, event), next)}`
  }
  if (part === 'runs') return `任务 ${id} 的执行（新的在前）：\n${listOf(runsFor(pod.db, id, 500), paging, (run) => runText(pod, run), next)}`
  return `任务 ${id} 的汇报（新的在前，全文按汇报 id 读）：\n${listOf(reportsFor(pod.db, id, 500), paging, (report) => reportText(pod, report, null), next)}`
}

/** 按 id 读 dsh-bot 里的一样东西，读不到返回 undefined。 */
function describe(pod: PodRuntime, session: PodSession, request: Request): string | undefined {
  const { id, paging } = request
  if (id.startsWith('msg_')) {
    const message = getMessage(pod.db, id)
    return message === undefined || message.deletedAt !== null ? undefined : messageText(pod, message, paging)
  }
  if (id.startsWith('task_')) return request.part === null ? taskOverview(pod, id, paging) : taskPart(pod, id, request.part, paging)
  if (id.startsWith('run_')) {
    const run = getRun(pod.db, id)
    return run === undefined ? undefined : runText(pod, run)
  }
  if (id.startsWith('rep_')) {
    const report = getReport(pod.db, id)
    return report === undefined ? undefined : reportText(pod, report, paging)
  }
  if (/^#?\d+$/.test(id)) {
    const event = getTaskEvent(pod.db, Number(id.replace('#', '')))
    return event === undefined ? undefined : eventText(pod, event)
  }
  if (id.startsWith('wait_')) {
    const wait = pod.waits.get(id)
    if (wait === undefined) return undefined
    return [`等你事项 ${wait.id}（${WAIT_KIND_LABELS[wait.kind]}，${wait.status}${wait.taskId === null ? '' : `，任务 ${wait.taskId}`}）：${wait.title}`, pageOf(wait.detail, paging, wait.id), wait.answer === null ? undefined : `用户的答复：${wait.answer}`]
      .filter((line): line is string => line !== undefined && line !== '')
      .join('\n')
  }
  if (id.startsWith('page_')) {
    const bot = pod.bots.get(session.botId)
    const page = pod.pages.get(id)
    if (bot === undefined || page === undefined || page.deletedAt !== null || !pod.pages.canSee(bot, page)) return undefined
    return `${PAGE_KIND_LABELS[page.kind]}「${page.title}」${page.id}，第 ${page.version} 版，更新于 ${when(pod, page.updatedAt)}。内容用 get_page 读。`
  }
  return undefined
}

function readRequest(args: Readonly<Record<string, unknown>>): Request | string {
  const id = text(args, 'id')
  if (id === '') return '要写 id'
  const part = text(args, 'part')
  if (part !== '' && !(PARTS as readonly string[]).includes(part)) return 'part 只能是 events、runs、reports'
  const page = typeof args.page === 'number' && Number.isInteger(args.page) && args.page >= 1 ? args.page : 1
  const size = typeof args.size === 'number' && Number.isInteger(args.size) && args.size >= 1 ? args.size : null
  return { id, part: part === '' ? null : (part as Part), paging: { page, size } }
}

/** 读：按 id 读消息、任务（概要、事件、执行、汇报）、执行、汇报、任务事件、等你事项、页面；卡片和开工说明里截断的地方都留着 id。 */
export function readTool(pod: PodRuntime, session: PodSession): ToolDefinition {
  return podTool({
    name: 'read',
    description: [
      '按 id 读 dsh-bot 里的东西：消息（msg_）、任务（task_，概要含说明、来由、最近的汇报和执行；part 读全部事件、执行或汇报）、执行（run_）、汇报（rep_，全文）、任务事件（#12）、等你事项（wait_）、页面（page_）。',
      `卡片和说明里截断的地方都留着 id，用它读全文；读回来的东西又带 id，顺着往下读。正文一页默认 ${PAGE_CHARS} 字（size 最多 ${PAGE_CHARS_MAX}），列表一页默认 ${PAGE_ITEMS} 条（最多 ${PAGE_ITEMS_MAX}），用 page 往下翻。`,
    ].join(''),
    properties: {
      id: str('要读的 id'),
      part: oneOf('只对任务：events 事件 / runs 执行 / reports 汇报；不填读概要', [...PARTS]),
      page: int('第几页，从 1 开始'),
      size: int('一页多少字（正文）或多少条（列表）'),
    },
    required: ['id'],
    concurrent: true,
    parse: readRequest,
    run: (request) => {
      const found = describe(pod, session, request)
      return found === undefined ? failure(`没有 id 为 ${request.id} 的东西，或者你看不到它`) : success(found)
    },
  })
}
