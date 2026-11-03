import type { DatabaseSync } from 'node:sqlite'
import type { RoomMessage, Task } from 'pod-domain'
import { getMessage, getWait, taskConversationOf } from 'pod-store'
import type { Replies } from '../chat/replies.ts'
import type { RoomService } from '../chat/rooms.ts'

export interface TaskRepliesDeps {
  readonly db: DatabaseSync
  readonly replies: Replies
  readonly rooms: RoomService
  /** 任务的任务卡。 */
  readonly cardOf: (taskId: string) => RoomMessage | undefined
  /** 有任务对话的根任务问了用户、没做成：叫开任务的前台在派活的聊天室转告一句。 */
  readonly relay: (task: Task, kind: RelayKind, body: string) => void
  /** 开这个任务的前台（bot 和会话）；不是前台开的返回 undefined。 */
  readonly requester: (task: Task) => { readonly botId: string; readonly sessionId: string } | undefined
}

/** 转告的几种：任务问用户、没做成。交的结果不用转告，以前台的名义原样发。 */
export type RelayKind = 'wait' | 'failed'

/**
 * 任务对外说的话（都走回复队列）：结果回在每一处还没得到答复的提问下面；等你（受阻、失败、要你处理的故障）
 * 由干活的 bot 回复任务卡；任务里被问到的话回在问的那条下面。有任务对话（另开的单聊、任务群）的根任务，
 * 结果和等你都发在那段对话里；在派活的地方问的，结果以开任务的前台的名义原样回在那句话上，
 * 等你由前台转告一句（你在任务对话里直接说的不转告）。
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

  /** 根任务自己的对话（另开的单聊、任务群）。 */
  private conversationOf(task: Task): string | undefined {
    return task.parentId === null ? taskConversationOf(this.deps.db, task.id)?.id : undefined
  }

  /**
   * 要不要由前台在派活的地方转告：最近一次是在任务对话以外问的（开任务时、前台从主对话转来的后续）才转告；
   * 你在任务对话里直接接着说的，回答、问题都留在那段对话里，主对话不多出消息。
   */
  private relayed(task: Task, conversation: string): boolean {
    return task.replyTo.at(-1)?.roomId !== conversation
  }

  /**
   * 结果就是干活的 bot 交的那条回答。有任务对话的根任务发在那里；最近一次是在派活的地方问的，再以开任务的前台的名义
   * 原样回在那句话上（两处是同一段话）。没有任务对话的一个聊天室一条：任务卡所在的聊天室挂在任务卡下（之后又在那里问过、
   * 还没答的，挂在最近那条下面）；别的聊天室里问过的，回在最近一条还没答的下面。干活的 bot 不在那个聊天室也照样以它的名义发。
   */
  result(task: Task, author: string, sessionId: string | null, body: string): number {
    const conversation = this.conversationOf(task)
    if (conversation !== undefined) {
      this.deps.replies.send({ roomId: conversation, author, purpose: 'result', body, replyTo: null, sessionId, taskId: task.id })
      return this.relayed(task, conversation) ? 1 + this.deliver(task, body) : 1
    }
    const card = this.deps.cardOf(task.id)
    const roomIds = [...new Set([card?.roomId, ...task.replyTo.map((target) => target.roomId)].filter((id): id is string => typeof id === 'string'))]
    let sent = 0
    for (const roomId of roomIds) {
      const room = this.deps.rooms.get(roomId)
      if (room === undefined || room.archivedAt !== null) continue
      const here = card?.roomId === roomId ? card : undefined
      const asked = task.replyTo
        .filter((target) => target.roomId === roomId && target.messageId !== null)
        .map((target) => getMessage(this.deps.db, target.messageId ?? ''))
        .filter((message): message is RoomMessage => message !== undefined && message.deletedAt === null && (here === undefined || message.seq > here.seq) && !this.answered(message.id))
      const latest = asked.at(-1)
      let anchor: string | null
      if (here !== undefined) anchor = latest?.id ?? here.id
      else if (latest !== undefined) anchor = latest.id
      else if (task.replyTo.some((target) => target.roomId === roomId && target.messageId === null)) anchor = null
      else continue
      this.deps.replies.send({ roomId, author, purpose: 'result', body, replyTo: anchor, sessionId, taskId: task.id })
      sent += 1
    }
    return sent
  }

  /** 以开任务的前台的名义，把回答原样发到派活的聊天室，回在那里最近一句还没得到答复的话上。 */
  private deliver(task: Task, body: string): number {
    const front = this.deps.requester(task)
    const room = task.roomId === null ? undefined : this.deps.rooms.get(task.roomId)
    if (front === undefined || room === undefined || room.archivedAt !== null) return 0
    const asked = task.replyTo
      .filter((target) => target.roomId === room.id && target.messageId !== null)
      .map((target) => getMessage(this.deps.db, target.messageId ?? ''))
      .filter((message): message is RoomMessage => message !== undefined && message.deletedAt === null && !this.answered(message.id))
    this.deps.replies.send({ roomId: room.id, author: front.botId, purpose: 'result', body, replyTo: asked.at(-1)?.id ?? null, sessionId: front.sessionId, taskId: task.id, data: { relayed: true } })
    return 1
  }

  /** 等你：干活的 bot 回复任务卡，说卡在哪、要你做什么；有任务对话的根任务直接在那里说。 */
  wait(task: Task, author: string, input: { readonly body: string; readonly kind?: 'text' | 'wait'; readonly sessionId?: string | null; readonly data?: Readonly<Record<string, unknown>> }): string | undefined {
    const conversation = this.conversationOf(task)
    const card = conversation === undefined ? this.deps.cardOf(task.id) : undefined
    const roomId = conversation ?? card?.roomId ?? task.roomId
    if (roomId === null) return undefined
    if (conversation !== undefined && this.relayed(task, conversation)) this.deps.relay(task, input.kind === 'wait' ? 'wait' : 'failed', `${input.body}${this.optionsOf(input.data)}`)
    return this.deps.replies.send({
      roomId,
      author,
      purpose: 'wait',
      kind: input.kind ?? 'text',
      body: input.body,
      replyTo: card?.id ?? null,
      sessionId: input.sessionId ?? null,
      taskId: task.id,
      ...(input.data === undefined ? {} : { data: input.data }),
    })
  }

  /** 等你事项带的选项，转告时一起说。 */
  private optionsOf(data: Readonly<Record<string, unknown>> | undefined): string {
    const wait = typeof data?.waitId === 'string' ? getWait(this.deps.db, data.waitId) : undefined
    const options = Array.isArray(wait?.data.options) ? wait.data.options.filter((option): option is string => typeof option === 'string') : []
    return options.length === 0 ? '' : `（选项：${options.join(' / ')}）`
  }

  /** 答复：任务里被问到时，回在问的那条下面。 */
  answer(task: Task, author: string, sessionId: string, message: RoomMessage, body: string): string {
    return this.deps.replies.send({ roomId: message.roomId, author, purpose: 'answer', body, replyTo: message.id, sessionId, taskId: task.id })
  }
}
