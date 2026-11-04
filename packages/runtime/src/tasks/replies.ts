import type { DatabaseSync } from 'node:sqlite'
import type { RoomMessage, Task } from 'pod-domain'
import { briefMessageOf, getMessage, taskConversationOf } from 'pod-store'
import type { Replies } from '../chat/replies.ts'
import type { RoomService } from '../chat/rooms.ts'
import type { TaskWake } from '../front/wakes.ts'

export interface TaskRepliesDeps {
  readonly db: DatabaseSync
  readonly replies: Replies
  readonly rooms: RoomService
  /** 任务的任务卡。 */
  readonly cardOf: (taskId: string) => RoomMessage | undefined
  /** 有任务对话的根任务交了回答、问了用户、没做成：叫开任务的前台在派活的聊天室说（不是前台开的不叫）。 */
  readonly wake: (task: Task, input: TaskWake) => void
}

/**
 * 任务对外说的话（都走回复队列）：结果回在每一处还没得到答复的提问下面；等你（受阻、失败、要你处理的故障）
 * 由干活的 bot 回复任务卡（没挂卡的回在交代那句下面）；任务里被问到的话回在问的那条下面。有任务对话（另开的单聊、任务群）的根任务，
 * 结果和等你都发在那段对话里；在派活的地方问的，再叫醒开任务的前台在那里说（你在任务对话里直接说的不叫）：
 * 回答由它照用户问的重写，问的事卡片挂在它那句下面；它几分钟没说，dsh-bot 以它的名义原样发。
 */
export class TaskReplies {
  private readonly deps: TaskRepliesDeps

  constructor(deps: TaskRepliesDeps) {
    this.deps = deps
  }

  /** 有人回在这条下面了，用途是答复或结果（排着还没发出去的也算）。 */
  private answered(messageId: string): boolean {
    const posted = this.deps.db
      .prepare("SELECT 1 AS found FROM messages WHERE reply_to = ? AND deleted_at IS NULL AND json_extract(data, '$.purpose') IN ('answer', 'result') LIMIT 1")
      .get(messageId)
    if (posted !== undefined) return true
    const queued = this.deps.db
      .prepare("SELECT 1 AS found FROM effects WHERE kind = 'reply' AND json_extract(payload, '$.replyTo') = ? AND json_extract(payload, '$.purpose') IN ('answer', 'result') LIMIT 1")
      .get(messageId)
    return queued !== undefined
  }

  /** 在这个聊天室里交代这件事的话（开任务的那句、之后接着问的），先的在前。 */
  private requests(task: Task, roomId: string): readonly RoomMessage[] {
    return task.replyTo
      .filter((target) => target.roomId === roomId && target.messageId !== null)
      .map((target) => getMessage(this.deps.db, target.messageId ?? ''))
      .filter((message): message is RoomMessage => message !== undefined && message.deletedAt === null)
  }

  /** 根任务自己的对话（另开的单聊、任务群、交进的群）。 */
  private conversationOf(task: Task): string | undefined {
    return task.parentId === null ? taskConversationOf(this.deps.db, task.id)?.id : undefined
  }

  /**
   * 在任务对话里回在哪条下面：单聊、任务群是这个任务专用的，不挂；交进的群是大家的，挂在那里最近一句还没得到答复的话上
   * （回复交代、结果接着问的），都答过了挂在交代下面，不散在群里。
   */
  private anchorIn(task: Task, conversation: string): string | null {
    const room = this.deps.rooms.get(conversation)
    if (room === undefined || room.kind === 'direct' || room.taskId === task.id) return null
    const asked = this.requests(task, conversation)
      .filter((message) => !this.answered(message.id))
      .at(-1)
    return asked?.id ?? briefMessageOf(this.deps.db, conversation, task.id) ?? null
  }

  /**
   * 要不要叫前台在派活的地方说：最近一次是在任务对话以外问的（开任务时、前台从主对话转来的后续）才叫；
   * 你在任务对话里直接接着说的，回答、问题都留在那段对话里，主对话不多出消息。
   */
  private relayed(task: Task, conversation: string): boolean {
    return task.replyTo.at(-1)?.roomId !== conversation
  }

  /**
   * 结果就是干活的 bot 交的那条回答。有任务对话的根任务原样发在那里；最近一次是在派活的地方问的，再叫醒开任务的前台，
   * 由它照用户问的写好回在那句话上。没有任务对话的一个聊天室一条，回在那里最近一句还没得到答复的话上（开任务的那句、
   * 之后接着问的）；都答过了挂在任务卡下，没挂卡的（群里、成员单聊里开的，子任务）在开它的聊天室里回在最近交代的那句下面，
   * 没有就直接发。常开任务每次的结果挂在任务卡下（之后又在那里问过、还没答的，挂在最近那条下面）。
   * 干活的 bot 不在那个聊天室也照样以它的名义发。
   */
  result(task: Task, author: string, sessionId: string | null, body: string, reportId: string | null = null): number {
    const conversation = this.conversationOf(task)
    if (conversation !== undefined) {
      this.deps.replies.send({ roomId: conversation, author, purpose: 'result', body, replyTo: this.anchorIn(task, conversation), sessionId, taskId: task.id, ...(reportId === null ? {} : { data: { reportId } }) })
      if (this.relayed(task, conversation)) this.deps.wake(task, { kind: 'result', body, anchor: this.askedIn(task)?.id ?? null, reportId })
      return 1
    }
    const card = this.deps.cardOf(task.id)
    const home = card?.roomId ?? task.roomId
    const roomIds = [...new Set([home, ...task.replyTo.map((target) => target.roomId)].filter((id): id is string => typeof id === 'string'))]
    let sent = 0
    for (const roomId of roomIds) {
      const room = this.deps.rooms.get(roomId)
      if (room === undefined || room.archivedAt !== null) continue
      const here = card?.roomId === roomId ? card : undefined
      const standing = here?.data.standing === true
      const requests = this.requests(task, roomId).filter((message) => !standing || message.seq > (here?.seq ?? 0))
      const latest = requests.filter((message) => !this.answered(message.id)).at(-1)
      let anchor: string | null
      if (here !== undefined) anchor = latest?.id ?? here.id
      else if (latest !== undefined) anchor = latest.id
      else if (roomId === home) anchor = requests.at(-1)?.id ?? null
      else if (task.replyTo.some((target) => target.roomId === roomId && target.messageId === null)) anchor = null
      else continue
      this.deps.replies.send({ roomId, author, purpose: 'result', body, replyTo: anchor, sessionId, taskId: task.id })
      sent += 1
    }
    return sent
  }

  /** 派活的聊天室里最近一句还没得到答复的话（开任务的那句、之后从那里转来的）：前台的回答回在它上面。 */
  private askedIn(task: Task): RoomMessage | undefined {
    if (task.roomId === null) return undefined
    return this.requests(task, task.roomId)
      .filter((message) => !this.answered(message.id))
      .at(-1)
  }

  /** 等你：干活的 bot 回复任务卡（没挂卡的回在最近交代的那句下面），说卡在哪、要你做什么；有任务对话的根任务直接在那里说。 */
  wait(task: Task, author: string, input: { readonly body: string; readonly kind?: 'text' | 'wait'; readonly sessionId?: string | null; readonly data?: Readonly<Record<string, unknown>> }): string | undefined {
    const conversation = this.conversationOf(task)
    const card = conversation === undefined ? this.deps.cardOf(task.id) : undefined
    const roomId = conversation ?? card?.roomId ?? task.roomId
    if (roomId === null) return undefined
    if (conversation !== undefined && this.relayed(task, conversation)) this.deps.wake(task, this.waitWake(input))
    return this.deps.replies.send({
      roomId,
      author,
      purpose: 'wait',
      kind: input.kind ?? 'text',
      body: input.body,
      replyTo: conversation === undefined ? (card?.id ?? this.requests(task, roomId).at(-1)?.id ?? null) : this.anchorIn(task, conversation),
      sessionId: input.sessionId ?? null,
      taskId: task.id,
      ...(input.data === undefined ? {} : { data: input.data }),
    })
  }

  /** 等你事项（问题、批准、登录）叫前台说是谁在问什么；其余的是没做成。 */
  private waitWake(input: { readonly body: string; readonly kind?: 'text' | 'wait'; readonly data?: Readonly<Record<string, unknown>> }): TaskWake {
    const waitId = typeof input.data?.waitId === 'string' ? input.data.waitId : null
    return input.kind === 'wait' && waitId !== null ? { kind: 'question', body: input.body, anchor: null, waitId } : { kind: 'failed', body: input.body, anchor: null }
  }

  /** 答复：任务里被问到时，回在问的那条下面。 */
  answer(task: Task, author: string, sessionId: string, message: RoomMessage, body: string): string {
    return this.deps.replies.send({ roomId: message.roomId, author, purpose: 'answer', body, replyTo: message.id, sessionId, taskId: task.id })
  }
}
