import type { DatabaseSync } from 'node:sqlite'
import { newId, t, type Room, type RoomMessage } from 'pod-domain'
import { getMessage, listMessages, type EffectRow } from 'pod-store'
import type { Auditor } from '../core/audit.ts'
import { FAILURES_BEFORE_PROBLEM, Later, type Effects } from '../effects/queue.ts'
import type { RoomService } from './rooms.ts'

/** 发到聊天室的话的用途：确认（前台）、答复（前台，或任务里被问到的 bot）、转告（前台转告任务的问题和结果）、结果（汇报就绪）、等你（受阻、失败、新的等你）。 */
export type ReplyPurpose = 'confirm' | 'answer' | 'relay' | 'result' | 'wait'

/** bot 说话前自己挂上的卡片：单聊里不算把要回的那句隔开。 */
const OWN_CARDS: ReadonlySet<string> = new Set(['task-card', 'page'])

export const REPLY_PURPOSES: readonly ReplyPurpose[] = ['confirm', 'answer', 'relay', 'result', 'wait']

export interface ReplyInput {
  readonly roomId: string
  /** 谁说的（bot id）。 */
  readonly author: string
  readonly purpose: ReplyPurpose
  readonly body: string
  /** 等你的卡片是 wait，其余是普通发言。 */
  readonly kind?: 'text' | 'wait'
  /** 挂在哪条消息下面。 */
  readonly replyTo?: string | null
  readonly sessionId?: string | null
  /** 哪个任务说的：回执记在任务上，发不出去时任务卡显示“消息没送到”。 */
  readonly taskId?: string | null
  readonly data?: Readonly<Record<string, unknown>>
}

export interface RepliesDeps {
  readonly db: DatabaseSync
  readonly effects: Effects
  readonly rooms: RoomService
  readonly audit: Auditor
  /** 发出去了（回执：发到哪、消息 id）。 */
  readonly sent: (input: ReplyInput, message: RoomMessage) => void
  /** 任务的一条回复连续失败到门槛，或者之后又发出去了：任务卡的阶段跟着变。 */
  readonly stuck: (taskId: string) => void
}

function readInput(payload: Readonly<Record<string, unknown>>): ReplyInput | undefined {
  const { roomId, author, purpose, body } = payload
  if (typeof roomId !== 'string' || typeof author !== 'string' || typeof body !== 'string') return undefined
  if (typeof purpose !== 'string' || !(REPLY_PURPOSES as readonly string[]).includes(purpose)) return undefined
  const data = typeof payload.data === 'object' && payload.data !== null && !Array.isArray(payload.data) ? (payload.data as Readonly<Record<string, unknown>>) : {}
  return {
    roomId,
    author,
    purpose: purpose as ReplyPurpose,
    body,
    kind: payload.kind === 'wait' ? 'wait' : 'text',
    replyTo: typeof payload.replyTo === 'string' ? payload.replyTo : null,
    sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : null,
    taskId: typeof payload.taskId === 'string' ? payload.taskId : null,
    data,
  }
}

/**
 * 回复队列：bot 发到聊天室的话都从这里走（副作用里的“回复”），一次发一条；处理暂停时排着，关掉后按原来的顺序出去。
 * 先登记再发：消息 id 登记时就定好，发出去留回执；一个任务（或一个 bot）发到同一个聊天室的话按登记顺序发，
 * 前面的没发出去后面的等着；失败从 5 秒退避到 300 秒一直重试，只有聊天室被删了才丢弃。
 */
export class Replies {
  private readonly deps: RepliesDeps

  constructor(deps: RepliesDeps) {
    this.deps = deps
    deps.effects.handle('reply', (payload, row) => this.deliver(row.key, payload), {
      retry: [5000, 300_000],
      // 任务的回复发不出去显示在任务卡上，不另记系统问题。
      quiet: (key) => typeof deps.effects.pending('reply', key)?.payload.taskId === 'string',
      settled: (row, outcome) => this.settled(row, outcome),
    })
  }

  /** 排进回复队列（在调用方的事务里，提交后才发）；返回这条消息将来的 id。 */
  send(input: ReplyInput): string {
    const id = newId('msg')
    const group = `${input.taskId ?? input.author}:${input.roomId}`
    this.deps.effects.enqueue('reply', id, { ...input, group })
    return id
  }

  /** 这个任务连续失败到门槛的那条回复。 */
  stuckFor(taskId: string): { readonly error: string; readonly attempts: number; readonly since: number } | undefined {
    const row = this.deps.db
      .prepare("SELECT error, attempts, since FROM effects WHERE kind = 'reply' AND attempts >= ? AND json_extract(payload, '$.taskId') = ? ORDER BY seq LIMIT 1")
      .get(FAILURES_BEFORE_PROBLEM, taskId) as { readonly error: string; readonly attempts: number; readonly since: number } | undefined
    return row
  }

  /** 你点了“重试”：这个任务排着的回复马上再试，返回几条。 */
  retryTask(taskId: string): number {
    const rows = this.deps.db.prepare("SELECT key FROM effects WHERE kind = 'reply' AND json_extract(payload, '$.taskId') = ?").all(taskId) as unknown as readonly { readonly key: string }[]
    return rows.filter((row) => this.deps.effects.retry('reply', row.key)).length
  }

  private async deliver(id: string, payload: Readonly<Record<string, unknown>>): Promise<void> {
    const input = readInput(payload)
    if (input === undefined) return
    const group = typeof payload.group === 'string' ? payload.group : ''
    const row = this.deps.effects.pending('reply', id)
    if (row !== undefined && this.earlier(row.seq, group)) throw new Later()
    // 上次发出去了、没来得及记下：不再发一遍。
    if (getMessage(this.deps.db, id) !== undefined) return
    const room = this.deps.rooms.get(input.roomId)
    if (room === undefined || room.archivedAt !== null) {
      this.deps.audit.record('reply.dropped', input.author, id, { roomId: input.roomId, taskId: input.taskId ?? null, purpose: input.purpose })
      return
    }
    const posted = this.deps.rooms.post(room.id, {
      id,
      author: input.author,
      kind: input.kind ?? 'text',
      body: input.body,
      sessionId: input.sessionId ?? null,
      replyTo: this.anchor(input, room),
      // 不挂在那条下面时也算进它所在的话题（比如任务卡下面的话：回复它们的消息照样直通任务）。
      topicFrom: this.sameRoom(input, room),
      data: { ...input.data, purpose: input.purpose, ...(input.taskId === null || input.taskId === undefined ? {} : { taskId: input.taskId }) },
    })
    if (posted === undefined) throw new Error(t('聊天室不在了'))
    this.deps.sent(input, posted)
  }

  /** 同一组里排在前面、还没发出去的。 */
  private earlier(seq: number, group: string): boolean {
    const row = this.deps.db.prepare("SELECT 1 AS found FROM effects WHERE kind = 'reply' AND seq < ? AND json_extract(payload, '$.group') = ? LIMIT 1").get(seq, group)
    return row !== undefined
  }

  /** 要回的那条在同一个聊天室：算进它的话题。 */
  private sameRoom(input: ReplyInput, room: Room): string | null {
    if (input.replyTo === null || input.replyTo === undefined) return null
    return getMessage(this.deps.db, input.replyTo)?.roomId === room.id ? input.replyTo : null
  }

  /**
   * 挂在哪条下面：那条还在、在同一个聊天室才挂；单聊里回的正是最新一条就不挂，对话照常往下走。
   * 说话的 bot 自己刚挂上的卡片（开任务时的任务卡、存好的页面）不算隔开。
   */
  private anchor(input: ReplyInput, room: Room): string | null {
    if (input.replyTo === null || input.replyTo === undefined) return null
    const target = getMessage(this.deps.db, input.replyTo)
    if (target === undefined || target.deletedAt !== null || target.roomId !== room.id) return null
    if (room.kind === 'direct') {
      const said = listMessages(this.deps.db, room.id, { limit: 5 }).filter((message) => !(message.author === input.author && OWN_CARDS.has(message.kind)))
      if (said.at(-1)?.id === target.id) return null
    }
    return target.id
  }

  /** 任务的回复第三次失败起任务卡显示“消息没送到”，之后发出去了就恢复。 */
  private settled(row: EffectRow, outcome: 'done' | 'later' | 'failed'): void {
    const taskId = row.payload.taskId
    if (typeof taskId !== 'string') return
    if ((outcome === 'failed' && row.attempts + 1 === FAILURES_BEFORE_PROBLEM) || (outcome === 'done' && row.attempts >= FAILURES_BEFORE_PROBLEM)) this.deps.stuck(taskId)
  }
}
