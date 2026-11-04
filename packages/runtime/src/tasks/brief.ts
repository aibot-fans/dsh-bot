import { REPORT_STATUS_LABELS, type RoutedMessage, type Task, type TaskReport, type TaskRun } from 'pod-domain'
import { CARD_LIMITS, clipCard } from '../core/cards.ts'

export interface BriefContext {
  readonly assumptions: readonly string[]
  readonly conventions: readonly string[]
  /** 上游子任务的结果摘要和文件路径。 */
  readonly upstream: readonly { readonly taskId?: string; readonly title: string; readonly summary: string; readonly files: readonly string[] }[]
}

function numbered(items: readonly string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n')
}

/** 开工说明里一段收短后最少留多少字。 */
const PART_MIN = 60

/**
 * 用户的原话每次都放在交代最前面，Super-agent 写的交代只写它的理解和背景，对不上时照原话。
 * 太长截断，截断处留着消息 id 能读回全文。limit 是这一段一共多少字。
 */
function originLines(task: Task, limit: number = CARD_LIMITS.message): string {
  const quotes = (task.origin?.quotes ?? []).filter((quote) => quote.text.trim() !== '')
  if (quotes.length === 0) return ''
  const each = Math.max(PART_MIN, Math.floor(limit / quotes.length) - 20)
  return quotes.map((quote) => `${quote.author}说：「${clipCard(quote.text.trim(), each, quote.messageId)}」`).join('\n')
}

/** 开工说明的一段：固定的直接是文字；能收短的给出收短的办法（截断处留 id）。 */
interface BriefPart {
  readonly text: string
  readonly shrink?: (limit: number) => string
}

/** 拼成一张；超过上限时按 order 依次收短能收短的段，最后才动你的原话。 */
function fitParts(parts: readonly BriefPart[], order: readonly number[], limit: number): string {
  const join = (texts: readonly string[]): string => texts.filter((text) => text !== '').join('\n\n')
  const fitted = order.reduce<readonly string[]>(
    (texts, index) => {
      const over = join(texts).length - limit
      const part = parts[index]
      const current = texts[index] ?? ''
      if (over <= 0 || part?.shrink === undefined || current === '') return texts
      const shrink = part.shrink
      return texts.map((text, at) => (at === index ? shrink(Math.max(PART_MIN, current.length - over)) : text))
    },
    parts.map((part) => part.text),
  )
  return join(fitted)
}

function bulletList(title: string, items: readonly string[], limit: number): string {
  if (items.length === 0) return ''
  const each = Math.max(PART_MIN, Math.floor(limit / items.length) - 4)
  return `${title}\n${items.map((item) => `- ${clipCard(item, each, null)}`).join('\n')}`
}

/**
 * 交给任务会话的第一条消息，就是任务对话里的那条交代：用户的原话在最前面，后面是 Super-agent 写的交代，子任务再带上
 * 要做到的几条、前提、约定和上游结果。任务 id、文件夹、汇报办法都在系统提示里，这里不写。整张不超过开工说明的上限：
 * 太长时依次收短上游结果、约定、前提、交代，最后才收短原话；截断处都留着 id，能用 read 读回全文。
 */
export function composeBrief(task: Task, context: BriefContext): string {
  const upstream = (limit: number): string => {
    if (context.upstream.length === 0) return ''
    const each = Math.max(PART_MIN, Math.floor(limit / context.upstream.length) - 30)
    const lines = context.upstream.map((item) => `- ${item.title}：${clipCard(item.summary, each, item.taskId ?? null)}${item.files.length === 0 ? '' : `（文件：${item.files.join('、')}）`}`)
    return `上游结果：\n${lines.join('\n')}`
  }
  const parts: readonly BriefPart[] = [
    { text: originLines(task), shrink: (limit) => originLines(task, limit) },
    { text: task.brief, shrink: (limit) => clipCard(task.brief, limit, task.id) },
    { text: task.deliverable === '' ? '' : `要交：${task.deliverable}` },
    { text: task.acceptance.length === 0 ? '' : `要做到：\n${numbered(task.acceptance.map((item) => item.text))}` },
    { text: bulletList('已定下的前提：', context.assumptions, 600), shrink: (limit) => bulletList('已定下的前提：', context.assumptions, limit) },
    { text: bulletList('任务约定（所有子任务都照着做）：', context.conventions, 600), shrink: (limit) => bulletList('任务约定（所有子任务都照着做）：', context.conventions, limit) },
    { text: upstream(CARD_LIMITS.message), shrink: upstream },
  ]
  const brief = fitParts(parts, [6, 5, 4, 1, 0], CARD_LIMITS.kickoff)
  return brief === '' ? task.title : brief
}

export interface RunBriefContext {
  /** 重试时附的上次汇报。 */
  readonly lastReport: TaskReport | undefined
  /** 只读跟进的话题里上次开工以后的新消息（只看不接）。 */
  readonly watching: readonly RoutedMessage[]
  /** 任务有自己的对话：送进来的话都是在那段对话里接着说的。 */
  readonly talking: boolean
}

/** 别处跟着这个任务的话题里直通进来的消息（比如群里回复任务卡的）：确认了再做，不归这个任务的交还。 */
const ROUTED_HOWTO = '这些消息直接送到了你这里：归这个任务的用 ack 确认再接着做；不归它的（超出范围、属于别的任务）用 handback 交还，写一句原因，整个话题都不归你就顺便取消跟进。'

/** 任务对话里接着说的话（用户说的、Super-agent 转来的后续）：当成接着交代的照做，不用先确认。 */
const TALK_HOWTO = '这是任务对话里接着说的话：当成接着交代的照做，不用先确认；问你的用 reply 答在那条下面。不是这个任务的事（另一件事、属于别的任务）用 handback 交还，写一句原因，它会当成新的事重新判断。'

function routedLine(message: RoutedMessage, talking: boolean): string {
  const reply = message.replyTo === null ? '' : `（回复 ${message.replyTo}）`
  const note = message.note === undefined || message.note === '' ? '' : `\n转来时的说明：${message.note}`
  if (message.id !== null) return `[${talking ? '接着说' : '直通消息'} ${message.id}] ${message.author}${reply}：${message.text}${note}`
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

/** 会话正在跑时送进来的一条消息：任务对话里接着说的，或者别处话题里直通的。 */
export function routedText(task: Task, message: RoutedMessage, talking: boolean): string {
  if (talking) return ['[dsh-bot] 任务对话里有一条新消息。', routedLine(message, true), TALK_HOWTO].join('\n')
  return [`[dsh-bot] 任务「${task.title}」的话题里有一条新消息。`, routedLine(message, false), ROUTED_HOWTO].join('\n')
}

/** 子任务汇报后送给组长的那几段。 */
function runNotices(run: TaskRun): readonly string[] {
  return Array.isArray(run.detail.notices) ? run.detail.notices.filter((item): item is string => typeof item === 'string') : []
}

/** 暂停着的时候你对它说话：只回话，不接着做。 */
const PAUSED_REPLY = '[dsh-bot] 这个任务暂停着（用户让你先等等）：只回用户这几句话，问的就答，交代的记下、接着做时照办；不接着做，也不对外操作。答完用 report 报 waiting。用户说接着做或点继续以后再接着做。'

/**
 * 同一个任务的又一次执行：同一个会话、同一个文件夹，开工说明写明原因。接着说的话（你在任务对话里说的、Super-agent
 * 转来的后续）只送那几句话本身；文件夹和汇报办法在系统提示里。暂停着时你说的话开头写明只回话。
 */
export function runBrief(task: Task, run: TaskRun, context: RunBriefContext): string {
  const messages = runMessages(run)
  const notices = runNotices(run)
  const routed = messages.some((message) => message.id !== null)
  const paused = run.detail.replyOnly === true ? PAUSED_REPLY : undefined
  const howto = context.talking ? TALK_HOWTO : ROUTED_HOWTO
  const said = messages.length === 0 ? undefined : [...messages.map((message) => routedLine(message, context.talking)), ...(routed ? [howto] : [])].join('\n')
  const watching =
    context.watching.length === 0 ? undefined : ['只读跟进的话题里的新消息（只看不接，不用确认或交还）：', ...context.watching.map((message) => `- ${message.id ?? ''} ${message.author}：${message.text}`)].join('\n')
  if (run.reason === 'message' && said !== undefined) return [paused, said, watching].filter((part): part is string => part !== undefined).join('\n\n')
  const head = `[dsh-bot] 任务「${task.title}」开始新的一次执行。`
  const reason = ((): string => {
    switch (run.reason) {
      case 'message':
        return '开工原因：用户的新消息。'
      case 'retry': {
        const last = context.lastReport
        return [
          '开工原因：用户让你重试。',
          last === undefined ? '' : `上次汇报 ${last.id}（${REPORT_STATUS_LABELS[last.status]}）：${last.summary}${last.report === '' ? '' : `\n${clipCard(last.report, CARD_LIMITS.report, last.id)}`}`,
        ]
          .filter(Boolean)
          .join('\n')
      }
      case 'recover':
        return '开工原因：dsh web 重启过，上一次执行被打断了，在后台跑的命令也跟着停了。重启前可能做到一半：对外的操作（发帖、发消息、改远程的东西）先核对做没做过，再决定要不要做。看一下任务文件夹里已有的产出，从停下的地方接着做。'
      case 'resume':
        return `开工原因：用户让你接着做。${task.note === '' ? '' : `你最近的进度说明是：「${task.note}」。`}从停下的地方接着做，已完成的部分不用重做。`
      case 'trigger':
        return `开工原因：触发器${typeof run.detail.trigger === 'string' ? `「${run.detail.trigger}」` : ''}到点了。${typeof run.detail.note === 'string' ? run.detail.note : ''}`
      case 'review': {
        const round = typeof run.detail.round === 'number' ? run.detail.round : 1
        const feedback = typeof run.detail.feedback === 'string' ? run.detail.feedback : ''
        return `开工原因：组长验收没通过（第 ${round} 次返工）。要改的地方：\n${feedback}\n在原来的产出上改，改好后再报 ready。`
      }
      case 'subtask':
        return '开工原因：子任务有了新进展（见下面）。'
      default:
        return `开工原因：${typeof run.detail.note === 'string' ? run.detail.note : '接着做'}`
    }
  })()
  const subtasks = notices.length === 0 ? undefined : notices.join('\n\n')
  // 排着的时候又来了话（并进这一次的），一起带上。
  return [paused, head, reason, subtasks, said, watching].filter((part): part is string => part !== undefined).join('\n\n')
}

/** 一轮结束却没汇报时的提醒。 */
export function nudgeText(task: Task, count: number): string {
  const lead = count >= 2 ? '这已经是第 ' + String(count) + ' 次提醒。' : ''
  return [
    `[dsh-bot 提醒] 任务「${task.title}」这一轮结束了，但还没有汇报。${lead}`,
    '- 已经做完：report 报 ready，写报告。',
    '- 缺东西做不下去（登录、权限、你的决定）：report 报 blocked，附一个问题。',
    '- 这一步做完了，等后续消息：report 报 waiting。',
    '- 还没做完：继续做下一步；刚做成了关键的一步，可以先报一次 progress 记进动态。',
  ].join('\n')
}

/** 停止或暂停后继续时发给任务会话的话。 */
export function resumeText(task: Task, after: 'paused' | 'stopped'): string {
  const why = after === 'paused' ? '任务暂停后继续了' : '任务被停止后，用户让它继续'
  const note = task.note === '' ? '' : `你最近的进度说明是：「${task.note}」。`
  return `[dsh-bot] ${why}。${note}从停下的地方接着做；已完成的部分不用重做。`
}
