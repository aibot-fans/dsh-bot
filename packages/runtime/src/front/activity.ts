import type { DatabaseSync } from 'node:sqlite'
import { TICKET_STAGE_LABELS, isTerminal, oneLine, truncate, type Bot, type Task } from 'pod-domain'
import { getTask, lastTaskEventId, openRootTasks, routesSince, taskEventsAfter } from 'pod-store'
import { isTicket } from '../engine/index.ts'

/** 批开头最多列几个在忙的任务、几件动静。 */
const TASKS_LISTED = 15
const ACTIVITY_LISTED = 20

const EVENT_KINDS = ['task_opened', 'report_recorded', 'task_ended'] as const

const REPORT_WORDS: Readonly<Record<string, string>> = {
  ready: '就绪',
  blocked: '受阻',
  failed: '失败',
  waiting: '这一步做完，等新消息',
  dismissed: '无需处理',
}

const END_WORDS: Readonly<Record<string, string>> = {
  done: '完成',
  stopped: '停掉了',
}

/** 前台看过的动静到哪：任务事件按 id，直通的去向按时间。 */
export interface ActivityCursor {
  readonly eventId: number
  readonly at: number
}

export interface ActivityDeps {
  readonly db: DatabaseSync
  readonly botName: (botId: string | null) => string
  readonly roomTitle: (roomId: string | null) => string
}

interface Line {
  readonly at: number
  readonly text: string
}

/** 开着的任务和任务动静：Super-agent 看全部，成员看自己的（在忙的还加上这一批涉及的聊天室里的）。 */
export class FrontActivity {
  private readonly deps: ActivityDeps

  constructor(deps: ActivityDeps) {
    this.deps = deps
  }

  /** 从现在开始攒：启动和开新前台时用，之前的动静不补。 */
  now(at: number): ActivityCursor {
    return { eventId: lastTaskEventId(this.deps.db), at }
  }

  private mine(bot: Bot, task: Task): boolean {
    return bot.role === 'lead' || task.ownerBotId === bot.id
  }

  private label(task: Task): string {
    return `${task.id}「${truncate(task.title, 40)}」（${this.deps.botName(task.ownerBotId)}）`
  }

  /** 在忙的任务，每个一行：id、标题、哪个 bot、哪个聊天室、阶段。 */
  openTasks(bot: Bot, rooms: ReadonlySet<string>): readonly string[] {
    const tasks = openRootTasks(this.deps.db, 60)
      .filter((task) => isTicket(task) || !isTerminal(task.status))
      .filter((task) => this.mine(bot, task) || (task.roomId !== null && rooms.has(task.roomId)))
    const stage = (task: Task): string => (isTicket(task) && task.ticketStage !== null ? TICKET_STAGE_LABELS[task.ticketStage] : task.status)
    const lines = tasks.slice(0, TASKS_LISTED).map((task) => `- ${this.label(task)} · ${this.deps.roomTitle(task.roomId)} · ${stage(task)}`)
    return tasks.length > TASKS_LISTED ? [...lines, `（还有 ${tasks.length - TASKS_LISTED} 个没列出，用 task_status 查）`] : lines
  }

  /** 游标之后的动静，每件一行；返回新的游标。 */
  since(bot: Bot, cursor: ActivityCursor, now: number): { readonly lines: readonly string[]; readonly omitted: number; readonly cursor: ActivityCursor } {
    const events = taskEventsAfter(this.deps.db, cursor.eventId, EVENT_KINDS, 300)
    const lastEvent = events.at(-1)?.id ?? cursor.eventId
    const readyIn = new Set(events.filter((event) => event.kind === 'report_recorded' && event.data.status === 'ready').map((event) => event.taskId))
    const lines: Line[] = []
    for (const event of events) {
      const task = getTask(this.deps.db, event.taskId)
      if (task === undefined || task.parentId !== null || !this.mine(bot, task)) continue
      const text = this.eventText(event.kind, event.data, task, readyIn)
      if (text !== undefined) lines.push({ at: event.createdAt, text })
    }
    for (const route of routesSince(this.deps.db, ['direct'], cursor.at, 100)) {
      const task = route.taskId === null ? undefined : getTask(this.deps.db, route.taskId)
      if (task === undefined || !this.mine(bot, task)) continue
      lines.push({ at: route.createdAt, text: `- ${route.messageId} 直通了 ${this.label(task)}` })
    }
    const ordered = [...lines].sort((left, right) => left.at - right.at)
    const kept = ordered.slice(-ACTIVITY_LISTED)
    return { lines: kept.map((line) => line.text), omitted: ordered.length - kept.length, cursor: { eventId: lastEvent, at: now } }
  }

  private eventText(kind: string, data: Readonly<Record<string, unknown>>, task: Task, readyIn: ReadonlySet<string>): string | undefined {
    if (kind === 'task_opened') return `- ${this.label(task)} 开了`
    if (kind === 'report_recorded') {
      const word = typeof data.status === 'string' ? REPORT_WORDS[data.status] : undefined
      if (word === undefined) return undefined
      const summary = typeof data.summary === 'string' && data.summary !== '' ? `：${truncate(oneLine(data.summary), 120)}` : ''
      return `- ${this.label(task)} ${word}${summary}`
    }
    const reason = typeof data.reason === 'string' ? data.reason : ''
    // 就绪后直接完成的，就绪那行已经说了。
    if (reason === 'done' && readyIn.has(task.id)) return undefined
    const word = END_WORDS[reason]
    return word === undefined ? undefined : `- ${this.label(task)} ${word}`
  }
}
