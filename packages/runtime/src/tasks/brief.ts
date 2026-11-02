import { REPORT_STATUS_LABELS, type RoutedMessage, type Task, type TaskReport, type TaskRun } from 'pod-domain'

export interface BriefContext {
  readonly fromName: string
  readonly assumptions: readonly string[]
  readonly conventions: readonly string[]
  /** 上游子任务的结果摘要和文件路径。 */
  readonly upstream: readonly { readonly title: string; readonly summary: string; readonly files: readonly string[] }[]
  readonly workspaceRoot: string
}

function numbered(items: readonly string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n')
}

/** 来由里你的原话，每条带消息 id；太长截断，留着 id 能读回全文。 */
const QUOTE_LIMIT = 600

function originLines(task: Task): string | undefined {
  const quotes = task.origin?.quotes ?? []
  if (quotes.length === 0) return undefined
  const lines = quotes.map((quote) => {
    const text = quote.text.length > QUOTE_LIMIT ? `${quote.text.slice(0, QUOTE_LIMIT)}…（截断了）` : quote.text
    return `- ${quote.author}${quote.messageId === null ? '' : `（${quote.messageId}）`}：${text}`
  })
  return `来由（原话）：\n${lines.join('\n')}`
}

const REPORT_HOWTO =
  '做完、卡住、做不成都用 report 汇报：做完是 ready（写报告，勾验收项），缺东西做不下去是 blocked（附一个问题），试过做不成是 failed，这一步做完等后续消息是 waiting，看过了不用做是 dismissed；中途想更新任务卡就报 progress。'

/** 交给任务会话的第一条消息：任务说明、交付物、验收项、文件夹和上游结果。 */
export function composeBrief(task: Task, context: BriefContext): string {
  const sections = [
    `[${context.fromName}交给你的任务]`,
    `任务：${task.title}（${task.id}）`,
    originLines(task),
    task.brief === '' ? undefined : `说明：\n${task.brief}`,
    task.deliverable === '' ? undefined : `交付物：${task.deliverable}`,
    task.acceptance.length === 0
      ? '还没有验收项：先按用户的原话列出 2–5 条，作为第一次汇报（report 的 acceptance，状态 progress）。'
      : `验收项（就绪时在 report 的 checks 里勾上，编号从 1 开始）：\n${numbered(task.acceptance.map((item) => item.text))}`,
    context.assumptions.length === 0 ? undefined : `已定下的前提：\n${context.assumptions.map((item) => `- ${item}`).join('\n')}`,
    context.conventions.length === 0 ? undefined : `任务约定（所有子任务都照着做）：\n${context.conventions.map((item) => `- ${item}`).join('\n')}`,
    context.upstream.length === 0
      ? undefined
      : `上游结果：\n${context.upstream
          .map((item) => `- ${item.title}：${item.summary}${item.files.length === 0 ? '' : `（文件：${item.files.join('、')}）`}`)
          .join('\n')}`,
    `任务文件夹：${context.workspaceRoot}/${task.folder}/（过程文件和产出都放这里）`,
    '开工原因：新任务。',
    REPORT_HOWTO,
  ]
  return sections.filter((section): section is string => section !== undefined).join('\n\n')
}

export interface RunBriefContext {
  /** 重试时附的上次汇报。 */
  readonly lastReport: TaskReport | undefined
  readonly workspaceRoot: string
  /** 只读跟进的话题里上次开工以后的新消息（只看不接）。 */
  readonly watching: readonly RoutedMessage[]
}

/** 直通、转来的消息怎么处理：确认了再做，不归这个任务的交还。 */
export const ROUTED_HOWTO = '这些消息直接送到了你这里：归这个任务的用 ack 确认再接着做；不归它的（超出范围、属于别的任务）用 handback 交还，写一句原因，整个话题都不归你就顺便取消跟进。'

function routedLine(message: RoutedMessage): string {
  const reply = message.replyTo === null ? '' : `（回复 ${message.replyTo}）`
  const note = message.note === undefined || message.note === '' ? '' : `\n转来时的说明：${message.note}`
  if (message.id !== null) return `[直通消息 ${message.id}] ${message.author}${reply}：${message.text}${note}`
  return message.author === '用户' ? `[用户原话] ${message.text}` : `[${message.author}补充] ${message.text}`
}

/** 开工原因里的消息：直通或转来的（带消息 id）和你直接对任务说的、答复的（只有原话）。 */
function runMessages(run: TaskRun): readonly RoutedMessage[] {
  const raw = Array.isArray(run.detail.messages) ? run.detail.messages : []
  return raw.flatMap((item): RoutedMessage[] => {
    if (typeof item === 'string') return [{ id: null, author: '用户', replyTo: null, text: item }]
    if (typeof item !== 'object' || item === null) return []
    const value = item as Record<string, unknown>
    if (typeof value.text !== 'string') return []
    return [
      {
        id: typeof value.id === 'string' ? value.id : null,
        author: typeof value.author === 'string' ? value.author : '用户',
        replyTo: typeof value.replyTo === 'string' ? value.replyTo : null,
        text: value.text,
        ...(typeof value.note === 'string' ? { note: value.note } : {}),
      },
    ]
  })
}

/** 会话正在跑时直通进来的一条消息。 */
export function routedText(task: Task, message: RoutedMessage): string {
  return [`[dsh-bot] 任务「${task.title}」的话题里有一条新消息。`, routedLine(message), ROUTED_HOWTO].join('\n')
}

/** 同一个任务的又一次执行：同一个会话、同一个文件夹，开工说明写明原因。 */
export function runBrief(task: Task, run: TaskRun, context: RunBriefContext): string {
  const messages = runMessages(run)
  const routed = messages.some((message) => message.id !== null)
  const head = `[dsh-bot] 任务「${task.title}」（${task.id}）开始新的一次执行。`
  const reason = ((): string => {
    switch (run.reason) {
      case 'message':
        return ['开工原因：用户的新消息。', ...messages.map(routedLine), ...(routed ? [ROUTED_HOWTO] : [])].join('\n')
      case 'retry': {
        const last = context.lastReport
        return [
          '开工原因：用户让你重试。',
          last === undefined ? '' : `上次汇报（${REPORT_STATUS_LABELS[last.status]}）：${last.summary}${last.report === '' ? '' : `\n${last.report.slice(0, 1200)}`}`,
        ]
          .filter(Boolean)
          .join('\n')
      }
      case 'recover':
        return '开工原因：dsh web 重启过，上一次执行被打断了，在后台跑的命令也跟着停了。重启前可能做到一半：对外的操作（发帖、发消息、改远程的东西）先核对做没做过，再决定要不要做。看一下任务文件夹里已有的产出，从停下的地方接着做。'
      case 'resume':
        return `开工原因：用户点了继续。${task.note === '' ? '' : `你最近的进度说明是：「${task.note}」。`}从停下的地方接着做，已完成的部分不用重做。`
      case 'trigger':
        return `开工原因：触发器${typeof run.detail.trigger === 'string' ? `「${run.detail.trigger}」` : ''}到点了。${typeof run.detail.note === 'string' ? run.detail.note : ''}`
      default:
        return `开工原因：${typeof run.detail.note === 'string' ? run.detail.note : '接着做'}`
    }
  })()
  const watching =
    context.watching.length === 0 ? undefined : ['只读跟进的话题里的新消息（只看不接，不用确认或交还）：', ...context.watching.map((message) => `- ${message.id ?? ''} ${message.author}：${message.text}`)].join('\n')
  return [head, reason, watching, `任务文件夹：${context.workspaceRoot}/${task.folder}/`, REPORT_HOWTO].filter((part): part is string => part !== undefined).join('\n\n')
}

/** 一轮结束却没汇报时的提醒。 */
export function nudgeText(task: Task, count: number): string {
  const lead = count >= 2 ? '这已经是第 ' + String(count) + ' 次提醒。' : ''
  return [
    `[dsh-bot 提醒] 任务「${task.title}」这一轮结束了，但还没有汇报。${lead}`,
    '- 已经做完：report 报 ready，写报告。',
    '- 缺东西做不下去（登录、权限、你的决定）：report 报 blocked，附一个问题。',
    '- 这一步做完了，等后续消息：report 报 waiting。',
    '- 还没做完：继续做下一步，可以先报一次 progress 更新任务卡。',
  ].join('\n')
}

/** 停止或暂停后继续时发给任务会话的话。 */
export function resumeText(task: Task, after: 'paused' | 'stopped'): string {
  const why = after === 'paused' ? '任务暂停后继续了' : '任务被停止后，用户让它继续'
  const note = task.note === '' ? '' : `你最近的进度说明是：「${task.note}」。`
  return `[dsh-bot] ${why}。${note}从停下的地方接着做；已完成的部分不用重做。`
}
