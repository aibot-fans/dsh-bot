import type { DatabaseSync } from 'node:sqlite'
import type { Task } from 'pod-domain'
import type { Effects } from '../effects/queue.ts'
import { Runs } from './runs.ts'
import { Tickets } from './tickets.ts'
import { Topics } from './topics.ts'

export { isTicket } from './facts.ts'
export type { OpenTaskInput } from './tickets.ts'
export type { ReportInput, ReportOutcome } from './runs.ts'

export interface EngineDeps {
  readonly db: DatabaseSync
  readonly now: () => number
  readonly effects: Effects
  /** 任务变了（推页面）。 */
  readonly changed: (task: Task) => void
  /** 任务刚结束（在结束的事务里）：没读的消息退回前台。 */
  readonly ended: (task: Task) => void
}

/**
 * 引擎：核心表（任务、执行、汇报、任务事件）的唯一写入者。命令同步、一个命令一个事务，
 * 事务里不调 dsh、不发网络请求；要对外做的（开工）登记成副作用，提交后才做。
 */
export class Engine {
  readonly tickets: Tickets
  readonly runs: Runs
  readonly topics: Topics

  constructor(deps: EngineDeps) {
    const released = (): void => deps.effects.release('open')
    this.topics = new Topics({ db: deps.db, now: deps.now })
    this.tickets = new Tickets({
      db: deps.db,
      now: deps.now,
      changed: deps.changed,
      cancelLaunch: (taskId) => deps.effects.cancel('open', taskId),
      released,
      ended: deps.ended,
    })
    this.runs = new Runs({
      db: deps.db,
      now: deps.now,
      tickets: this.tickets,
      launch: (_task, run) => deps.effects.enqueue('open', run.taskId, { runId: run.id, owner: run.reason === 'message' || run.reason === 'retry' || run.reason === 'resume' }),
      released,
    })
  }
}

/** 按角色的入口：调用的一方只拿到它该用的命令。 */
export type HumanEntry = Pick<Runs, 'queue'> & Pick<Tickets, 'end' | 'reopen'>
export type TaskSessionEntry = Pick<Runs, 'report' | 'nudged'>
