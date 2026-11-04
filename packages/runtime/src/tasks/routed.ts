import type { DatabaseSync } from 'node:sqlite'
import { PRIORITY, type RoutedMessage, type Task } from 'pod-domain'
import { taskConversationOf, transaction } from 'pod-store'
import { ownerSource } from '../agents/messages.ts'
import type { Dispatcher } from '../effects/delivery.ts'
import { isTicket, type Engine } from '../engine/index.ts'
import { routedText } from './brief.ts'

export interface RouteInDeps {
  readonly db: DatabaseSync
  readonly engine: Engine
  readonly dispatcher: Dispatcher
}

/**
 * 把你的一条消息送进工单（直通或前台转来的）：结束了的重新打开，你停掉的不送；
 * 正在执行就交进会话，没在执行就开一次执行带上它（已经排着的并进去）。
 * 返回那次投递或执行的 id，用来判断它读没读过。
 */
export function routeIn(deps: RouteInDeps, task: Task, message: RoutedMessage): string | undefined {
  if (!isTicket(task)) return undefined
  const { engine, dispatcher } = deps
  return transaction(deps.db, () => {
    // 结束了的重新打开；记下原来怎么结束的，它交还了这条消息就恢复原样。
    const reopened = task.endedAt === null ? undefined : task.endReason
    if (reopened !== undefined) {
      if (reopened === 'stopped') return undefined
      engine.tickets.reopen(task.id, 'owner')
    }
    const run = engine.runs.current(task.id)
    if (run?.status === 'running' && run.sessionId !== null) {
      const delivery = dispatcher.enqueue({
        sessionId: run.sessionId,
        mode: dispatcher.isRunning(run.sessionId) ? 'steer' : 'followup',
        priority: PRIORITY.owner,
        text: routedText(engine.tickets.get(task.id) ?? task, message, taskConversationOf(deps.db, task.rootId) !== undefined),
        source: ownerSource(),
      })
      return delivery.id
    }
    return engine.runs.queue(task.id, 'message', { messages: [message], ...(reopened == null ? {} : { reopened }) })?.id
  })
}
