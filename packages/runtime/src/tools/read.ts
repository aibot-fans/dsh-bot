import { OWNER, POD, PAGE_KIND_LABELS, REPORT_STATUS_LABELS, ROUTE_LABELS, WAIT_KIND_LABELS, type PodSession, type RoomMessage, type TaskReport, type TaskRun } from 'pod-domain'
import { getMessage, getReport, getRun, reportsFor, runsFor } from 'pod-store'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { failure, podTool, str, success, text } from './define.ts'

/** 读出来的正文最多多长；再长的读文件或页面。 */
const FULL_LIMIT = 4000

function clip(value: string, limit = FULL_LIMIT): string {
  return value.length > limit ? `${value.slice(0, limit)}…（还有 ${value.length - limit} 字没显示）` : value
}

function when(at: number | null): string {
  return at === null ? '—' : new Date(at).toISOString().replace('T', ' ').slice(0, 16)
}

function authorOf(pod: PodRuntime, author: string): string {
  if (author === OWNER) return '用户'
  if (author === POD) return 'dsh-bot'
  return pod.bots.get(author)?.name ?? author
}

function messageText(pod: PodRuntime, message: RoomMessage): string {
  const room = pod.rooms.get(message.roomId)
  const routes = pod.engine.topics.routes(message.id).map((route) => `${ROUTE_LABELS[route.route]}${route.taskId === null ? '' : ` ${route.taskId}`}${route.note === '' ? '' : `（${route.note}）`}`)
  return [
    `消息 ${message.id}：${authorOf(pod, message.author)}在「${room?.title ?? message.roomId}」，${when(message.createdAt)}${message.replyTo === null ? '' : `，回复 ${message.replyTo}`}`,
    routes.length === 0 ? undefined : `去向：${routes.join('；')}`,
    clip(message.body),
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n')
}

function runText(run: TaskRun): string {
  const messages = Array.isArray(run.detail.messages) ? run.detail.messages.length : 0
  return `执行 ${run.id}（任务 ${run.taskId}）：${run.status}，开工原因 ${run.reason}${run.outcome === null ? '' : `，结局 ${run.outcome}`}${run.error === null ? '' : `，出错：${run.error}`}；排队 ${when(run.queuedAt)}，开始 ${when(run.startedAt)}，结束 ${when(run.endedAt)}${messages === 0 ? '' : `；带了 ${messages} 条消息`}`
}

function reportText(report: TaskReport, full: boolean): string {
  const data = report.data
  const list = (key: string, label: string): string | undefined => (Array.isArray(data[key]) && data[key].length > 0 ? `${label}：${(data[key] as unknown[]).map(String).join('；')}` : undefined)
  return [
    `汇报 ${report.id}（任务 ${report.taskId}，${REPORT_STATUS_LABELS[report.status]}，${when(report.createdAt)}）：${report.summary}`,
    report.question === '' ? undefined : `问题：${report.question}`,
    report.report === '' ? undefined : full ? clip(report.report) : clip(report.report, 600),
    full ? list('files', '产出文件') : undefined,
    full ? list('unverified', '没核实') : undefined,
    full ? list('assumptions', '假设') : undefined,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n')
}

function taskText(pod: PodRuntime, id: string): string | undefined {
  const snapshot = pod.tasks.snapshotTextFor(id)
  const task = pod.tasks.get(id)
  if (snapshot === undefined || task === undefined) return undefined
  const quotes = (task.origin?.quotes ?? []).map((quote) => `- ${quote.author}${quote.messageId === null ? '' : `（${quote.messageId}）`}：${clip(quote.text, 1000)}`)
  const reports = reportsFor(pod.db, id, 3).map((report) => reportText(report, false))
  const runs = runsFor(pod.db, id, 3).map(runText)
  return [
    snapshot,
    quotes.length === 0 ? undefined : `来由（原话）：\n${quotes.join('\n')}`,
    reports.length === 0 ? undefined : `最近的汇报（新的在前，全文按汇报 id 读）：\n${reports.join('\n\n')}`,
    runs.length === 0 ? undefined : `最近的执行：\n${runs.join('\n')}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join('\n\n')
}

/** 按 id 读 dsh-bot 里的一样东西，读不到返回 undefined。 */
function describe(pod: PodRuntime, session: PodSession, id: string): string | undefined {
  if (id.startsWith('msg_')) {
    const message = getMessage(pod.db, id)
    return message === undefined || message.deletedAt !== null ? undefined : messageText(pod, message)
  }
  if (id.startsWith('task_')) return taskText(pod, id)
  if (id.startsWith('run_')) {
    const run = getRun(pod.db, id)
    return run === undefined ? undefined : runText(run)
  }
  if (id.startsWith('rep_')) {
    const report = getReport(pod.db, id)
    return report === undefined ? undefined : reportText(report, true)
  }
  if (id.startsWith('wait_')) {
    const wait = pod.waits.get(id)
    if (wait === undefined) return undefined
    return [`等你事项 ${wait.id}（${WAIT_KIND_LABELS[wait.kind]}，${wait.status}${wait.taskId === null ? '' : `，任务 ${wait.taskId}`}）：${wait.title}`, clip(wait.detail), wait.answer === null ? undefined : `用户的答复：${wait.answer}`]
      .filter((line): line is string => line !== undefined && line !== '')
      .join('\n')
  }
  if (id.startsWith('page_')) {
    const bot = pod.bots.get(session.botId)
    const page = pod.pages.get(id)
    if (bot === undefined || page === undefined || page.deletedAt !== null || !pod.pages.canSee(bot, page)) return undefined
    return `${PAGE_KIND_LABELS[page.kind]}「${page.title}」${page.id}，第 ${page.version} 版，更新于 ${when(page.updatedAt)}。内容用 get_page 读。`
  }
  return undefined
}

/** 读：按 id 读消息、任务、执行、汇报、等你事项、页面；卡片和开工说明里截断的地方都留着 id。 */
export function readTool(pod: PodRuntime, session: PodSession): ToolDefinition {
  return podTool({
    name: 'read',
    description: '按 id 读 dsh-bot 里的东西：消息（msg_）、任务（task_，含来由、最近的汇报和执行）、执行（run_）、汇报（rep_，全文）、等你事项（wait_）、页面（page_）。卡片和说明里截断的地方都留着 id，用它读全文。',
    properties: { id: str('要读的 id') },
    required: ['id'],
    concurrent: true,
    parse: (args) => (text(args, 'id') === '' ? '要写 id' : { id: text(args, 'id') }),
    run: ({ id }) => {
      const found = describe(pod, session, id)
      return found === undefined ? failure(`没有 id 为 ${id} 的东西，或者你看不到它`) : success(found)
    },
  })
}
