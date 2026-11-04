import type { DatabaseSync } from 'node:sqlite'
import { TICKET_STAGE_LABELS, isTerminal, truncate, type Bot, type Task } from 'pod-domain'
import { openRootTasks } from 'pod-store'
import { isTicket } from '../engine/index.ts'

/** 批开头最多列几个在忙的任务。 */
const TASKS_LISTED = 15

export interface ActivityDeps {
  readonly db: DatabaseSync
  readonly botName: (botId: string | null) => string
  readonly roomTitle: (roomId: string | null) => string
}

/** 开着的任务：Super-agent 看全部，成员看自己的（加上这一批涉及的聊天室里的）。 */
export class FrontActivity {
  private readonly deps: ActivityDeps

  constructor(deps: ActivityDeps) {
    this.deps = deps
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
}
