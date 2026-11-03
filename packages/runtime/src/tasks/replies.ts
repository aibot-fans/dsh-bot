import type { DatabaseSync } from 'node:sqlite'
import { t, type RoomMessage, type Task, type TaskResult } from 'pod-domain'
import { getMessage, taskConversationOf } from 'pod-store'
import type { Replies } from '../chat/replies.ts'
import type { RoomService } from '../chat/rooms.ts'

export interface TaskRepliesDeps {
  readonly db: DatabaseSync
  readonly replies: Replies
  readonly rooms: RoomService
  /** 任务的任务卡。 */
  readonly cardOf: (taskId: string) => RoomMessage | undefined
}

/** 结果消息怎么收尾：做完了（交付或交给组长）、等你验收、常开任务这一次的结果。 */
export type ResultEnding = 'done' | 'review' | 'standing'

/**
 * 结果消息：汇报的摘要，产出文件附在后面；不挂在任务卡下时带上任务标题，等你验收时说一句看过再收下（按钮挂在这句话后面）。
 * 常开任务每次到点都发，只发摘要，产出文件在任务页里看。
 */
export function resultText(task: Task, result: TaskResult, onCard: boolean, ending: ResultEnding): string {
  const head = onCard ? result.summary : t('「{title}」做完了：{summary}', { title: task.title, summary: result.summary })
  const files = result.files.length === 0 || ending === 'standing' ? '' : `\n\n${t('文件：{files}', { files: result.files.map((file) => `\`${file}\``).join(t('、')) })}`
  const accept = ending === 'review' ? `\n\n${t('有没核实的地方，看过再点下面的“收下”。')}` : ''
  return `${head}${files}${accept}`
}

/**
 * 任务对外说的话（都走回复队列）：结果回在每一处还没得到答复的提问下面；等你（受阻、失败、要你处理的故障）
 * 由干活的 bot 回复任务卡；任务里被问到的话回在问的那条下面。有任务对话（另开的单聊、任务群）的根任务，
 * 结果和等你都发在那段对话里，主对话里只有任务卡跟着变。
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
   * 结果：有任务对话的根任务只发在那里（那段对话就是这个任务，不用再写标题）。没有的一个聊天室一条：任务卡所在的聊天室
   * 挂在任务卡下（之后又在那里问过、还没答的，挂在最近那条下面）；别的聊天室里问过的，回在最近一条还没答的下面。
   * 干活的 bot 不在那个聊天室也照样以它的名义发，看得出是谁做的。
   */
  result(task: Task, author: string, sessionId: string | null, body: (onCard: boolean) => string): number {
    const conversation = this.conversationOf(task)
    if (conversation !== undefined) {
      this.deps.replies.send({ roomId: conversation, author, purpose: 'result', body: body(true), replyTo: null, sessionId, taskId: task.id })
      return 1
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
      this.deps.replies.send({ roomId, author, purpose: 'result', body: body(here !== undefined && anchor === here.id), replyTo: anchor, sessionId, taskId: task.id })
      sent += 1
    }
    return sent
  }

  /** 等你：干活的 bot 回复任务卡，说卡在哪、要你做什么；有任务对话的根任务直接在那里说。 */
  wait(task: Task, author: string, input: { readonly body: string; readonly kind?: 'text' | 'wait'; readonly sessionId?: string | null; readonly data?: Readonly<Record<string, unknown>> }): string | undefined {
    const conversation = this.conversationOf(task)
    const card = conversation === undefined ? this.deps.cardOf(task.id) : undefined
    const roomId = conversation ?? card?.roomId ?? task.roomId
    if (roomId === null) return undefined
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

  /** 答复：任务里被问到时，回在问的那条下面。 */
  answer(task: Task, author: string, sessionId: string, message: RoomMessage, body: string): string {
    return this.deps.replies.send({ roomId: message.roomId, author, purpose: 'answer', body, replyTo: message.id, sessionId, taskId: task.id })
  }
}
