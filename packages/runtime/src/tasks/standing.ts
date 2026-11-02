import type { DatabaseSync } from 'node:sqlite'
import { newAcceptance, newId, ok, fail, rootTaskFolder, type Bot, type OriginQuote, type PodResult, type ReplyTarget, type Task, type TaskOrigin, type Trigger } from 'pod-domain'
import { transaction } from 'pod-store'
import type { RoomService } from '../chat/rooms.ts'
import type { Engine } from '../engine/index.ts'
import type { TriggerClock, TriggerInput } from '../engine/triggers.ts'

export interface AutoTaskDeps {
  readonly db: DatabaseSync
  readonly engine: Engine
  readonly rooms: RoomService
  readonly triggers: TriggerClock
}

export interface AutoTaskInput {
  readonly bot: Bot
  readonly title: string
  readonly brief: string
  /** 任务卡放在哪个聊天室；null 是不放卡（后台悄悄做）。 */
  readonly roomId: string | null
  readonly replyTo: readonly ReplyTarget[]
  readonly origin: Pick<TaskOrigin, 'kind' | 'rule' | 'requester'> & { readonly quotes?: readonly OriginQuote[]; readonly note?: string }
  /** 挂上的触发器：有就等到点再开工，没有就马上排第一次执行。 */
  readonly trigger?: TriggerInput
  /** 自带的话题：这些消息所在的回复串（比如 X 事件那条消息），回复它们的话直接进任务。 */
  readonly follow?: readonly string[]
  readonly actor: string
}

/**
 * 不是前台分派来的任务：例程、每日简报（常开，挂时间触发器）和自动来源开的后台任务。
 * 有触发器的不排第一次执行，到点才开工；放了任务卡的，任务卡就是它的话题，回复它的话直接进任务。
 */
export function openAutoTask(deps: AutoTaskDeps, input: AutoTaskInput): PodResult<{ readonly task: Task; readonly trigger: Trigger | undefined }> {
  const { engine } = deps
  const id = newId('task')
  const origin: TaskOrigin = {
    kind: input.origin.kind,
    quotes: input.origin.quotes ?? [],
    requester: input.origin.requester,
    roomId: input.roomId,
    rule: input.origin.rule,
    title: input.title,
    note: input.origin.note ?? '',
  }
  const opened = transaction(deps.db, () => {
    const task = engine.tickets.open({
      id,
      rootId: id,
      parentId: null,
      roomId: input.roomId,
      teamId: null,
      title: input.title,
      brief: input.brief,
      kind: '',
      deliverable: '',
      acceptance: newAcceptance([]),
      dependsOn: [],
      needs: { browser: false, shell: false },
      ownerBotId: input.bot.id,
      level: input.bot.role === 'lead' ? 'L0' : 'L1',
      folder: rootTaskFolder({ id, title: input.title }),
      urgent: false,
      tainted: false,
      createdBy: input.actor,
      requesterSession: null,
      origin,
      replyTo: input.replyTo,
      actor: input.actor,
    })
    engine.tickets.event(task, 'delegated', input.actor, { to: input.bot.id, reason: input.origin.rule ?? '' })
    for (const messageId of input.follow ?? []) engine.topics.followMessage(task.id, messageId, 'own')
    if (input.trigger === undefined) engine.runs.queue(task.id, 'new', {})
    return task
  })
  let trigger: Trigger | undefined
  if (input.trigger !== undefined) {
    const set = deps.triggers.set(opened, input.trigger)
    if (typeof set === 'string') {
      engine.tickets.end(opened.id, 'stopped', input.actor)
      return fail('invalid-input', set)
    }
    trigger = set
  }
  if (input.roomId !== null) {
    const card = deps.rooms.post(input.roomId, { author: input.bot.id, kind: 'task-card', body: input.title, data: { taskId: id, rootId: id, standing: input.trigger !== undefined } })
    if (card !== undefined) engine.topics.followMessage(id, card.id, 'own')
  }
  return ok({ task: engine.tickets.get(id) ?? opened, trigger })
}
