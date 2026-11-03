import type { DatabaseSync } from 'node:sqlite'
import { fail, ok, t, type PodResult, type RoomMessage, type RoutedMessage, type Task } from 'pod-domain'
import { getDelivery, getMessage, getRun, transaction } from 'pod-store'
import { CARD_LIMITS, clipCard } from '../core/cards.ts'
import type { Effects } from '../effects/queue.ts'
import { isTicket } from './facts.ts'
import type { Topics } from './topics.ts'

/** 直通的消息每条最多带多少字；截断的留着 id，能读回全文。 */
export const ROUTED_LIMIT = CARD_LIMITS.message

export interface IntakeDeps {
  readonly db: DatabaseSync
  readonly now: () => number
  readonly topics: Topics
  readonly effects: Effects
  readonly task: (id: string) => Task | undefined
  /** 把一条消息送进任务：在跑就交进会话，没在跑就开一次执行（结束了的重新打开）；返回那次投递或执行的 id。 */
  readonly deliver: (task: Task, message: RoutedMessage) => string | undefined
  /** 结果回到问的地方：记下你是在哪条消息问的。 */
  readonly askedAt: (task: Task, message: RoomMessage) => void
  /** 直通了哪些任务，记在消息上给页面看。 */
  readonly marked: (message: RoomMessage, tasks: readonly Task[]) => void
  /** 交给前台（交还、退回的消息）；note 是交给前台时附的说明。 */
  readonly toFront: (message: RoomMessage, note: string) => Promise<void>
  /** 任务群里还开着的子任务（@ 成员时它只有一个子任务就直通那个）。 */
  readonly childrenIn: (roomId: string) => readonly Task[]
  /** 任务自己的对话（另开的单聊、任务群）；自己干的、例程没有。 */
  readonly conversationOf: (task: Task) => string | undefined
}

/** 送进任务会话的那条消息：带 id、谁说的、回的是哪条，正文截断。 */
export function routedOf(message: Pick<RoomMessage, 'id' | 'body' | 'replyTo'>, author: string): RoutedMessage {
  return { id: message.id, author, replyTo: message.replyTo, text: clipCard(message.body, ROUTED_LIMIT, message.id) }
}

/**
 * 接收：你在聊天室里说的话先看属于哪个话题，有任务跟进就直接送进每个跟进它的任务（直通），
 * 没有才交给前台。任务会话确认或交还直通进来的消息；任务结束时没读的退回前台。每一步都记在消息的去向上。
 */
export class Intake {
  private readonly deps: IntakeDeps

  constructor(deps: IntakeDeps) {
    this.deps = deps
    deps.effects.handle('relay', (payload, row) => this.relay(row.key, payload), { limit: () => 2, retry: [3000, 120_000] })
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  /**
   * 你的一条消息：直通跟进它所在话题的任务，返回直通了哪些；空的就由调用方交给前台。
   * 在任务群里 @ 了成员：它在这个群里只有一个子任务就直通那个，否则照话题走（交给组长）。
   */
  owner(message: RoomMessage, mentioned: readonly string[] = []): readonly Task[] {
    const topic = message.topicId == null ? undefined : this.deps.topics.get(message.topicId)
    const called = this.calledChildren(message, mentioned)
    const targets = called.length > 0 ? called : topic === undefined ? [] : this.targets(topic.id, message)
    const delivered = transaction(this.db, () => {
      const done: Task[] = []
      for (const task of targets) {
        const ref = this.deps.deliver(task, routedOf(message, '用户'))
        if (ref === undefined) continue
        this.deps.topics.route(message.id, 'direct', task.id, 'code', '', ref)
        this.deps.askedAt(task, message)
        done.push(task)
      }
      return done
    })
    if (delivered.length > 0) this.deps.marked(message, delivered)
    return delivered
  }

  /** 被 @ 的成员各自在这个任务群里只有一个开着的子任务时，就是那几个子任务。回复了别的消息的不算。 */
  private calledChildren(message: RoomMessage, mentioned: readonly string[]): readonly Task[] {
    if (mentioned.length === 0 || message.replyTo !== null) return []
    const children = this.deps.childrenIn(message.roomId)
    return mentioned.flatMap((botId) => {
      const mine = children.filter((child) => child.ownerBotId === botId)
      return mine.length === 1 && !this.deps.topics.handedBack(message.id, mine[0]?.id ?? '') ? mine : []
    })
  }

  /**
   * 跟进这个话题、能收这条消息的任务：只读跟进的不收，你停掉的不收，交还过这条的不再给它。
   * 有自己对话的任务只收那段对话里的话；在别处（比如主对话）接着它说的，由前台认出来写成完整的后续再转进去。
   */
  private targets(topicId: string, message: RoomMessage): readonly Task[] {
    return this.deps.topics
      .followers(topicId)
      .filter((follow) => follow.kind !== 'readonly')
      .map((follow) => this.deps.task(follow.taskId))
      .filter((task): task is Task => task !== undefined && isTicket(task) && task.endReason !== 'stopped' && !this.deps.topics.handedBack(message.id, task.id))
      .filter((task) => (this.deps.conversationOf(task) ?? message.roomId) === message.roomId)
  }

  /**
   * 前台把你的一条消息转给任务：同时让任务跟进这条所在的话题，之后在那里说的话直接到它。
   * followUp 是前台写的完整后续，送进去的就是这一条，以前台的名义。任务交还过的不能再转回去。返回送进去时的投递或执行 id。
   */
  forward(task: Task, message: RoomMessage, by: string, note = '', followUp?: { readonly author: string; readonly text: string }): PodResult<string> {
    if (this.deps.topics.handedBack(message.id, task.id)) return fail('conflict', t('「{title}」已经交还过这条消息，不能再转给它', { title: task.title }))
    return transaction(this.db, () => {
      const routed = followUp === undefined ? { ...routedOf(message, '用户'), ...(note === '' ? {} : { note }) } : { id: message.id, author: followUp.author, replyTo: message.replyTo, text: followUp.text }
      const ref = this.deps.deliver(task, routed)
      if (ref === undefined) return fail('conflict', t('任务已经停掉了；要接着做，先点继续'))
      this.deps.topics.followMessage(task.id, message.id, 'attached')
      // 记在转它的那个前台名下：这条在那个前台就算有去向了。
      this.deps.topics.route(message.id, 'relayed', task.id, by, note, ref, by)
      this.deps.askedAt(task, message)
      return ok(ref)
    })
  }

  /**
   * 前台把接着说的话转进任务自己的对话：发在那段对话里的后续（posted，前台写的）送进任务，干活的 bot 回在它下面；
   * 用户在别处说的那几句记成前台转走了，也记成后来问的地方，结果出来由前台在那里转告。返回送进去时的投递或执行 id。
   */
  followUp(task: Task, posted: RoomMessage, author: string, originals: readonly RoomMessage[], by: string): PodResult<string> {
    return transaction(this.db, () => {
      const ref = this.deps.deliver(task, { id: posted.id, author, replyTo: null, text: clipCard(posted.body, ROUTED_LIMIT, posted.id) })
      if (ref === undefined) return fail('conflict', t('任务已经停掉了；要接着做，先点继续'))
      this.deps.topics.route(posted.id, 'relayed', task.id, by, '', ref, by)
      for (const message of originals) this.deps.topics.route(message.id, 'relayed', task.id, by, '', ref, by)
      const last = originals.at(-1)
      if (last !== undefined) this.deps.askedAt(task, last)
      return ok(ref)
    })
  }

  /** 任务会话确认直通进来的消息归它。 */
  ack(task: Task, messageIds: readonly string[], by: string): PodResult<number> {
    const pending = new Set(this.deps.topics.pending(task.id).map((route) => route.messageId))
    const known = messageIds.filter((id) => pending.has(id))
    if (known.length === 0) return fail('not-found', t('这些消息没有送给这个任务，或者已经确认、交还过了'))
    transaction(this.db, () => {
      for (const id of known) this.deps.topics.route(id, 'acked', task.id, by)
    })
    return ok(known.length)
  }

  /** 任务会话交还一条消息：记下原因，整个话题都不归它就同时取消跟进；消息交给前台重新判断。每条只能交还一次。 */
  handback(task: Task, messageId: string, reason: string, unfollow: boolean, by: string): PodResult<{ readonly unfollowed: boolean }> {
    const pending = this.deps.topics.pending(task.id).some((route) => route.messageId === messageId)
    if (!pending) return fail('not-found', t('这条消息没有送给这个任务，或者已经确认、交还过了'))
    const message = getMessage(this.db, messageId)
    if (message === undefined) return fail('not-found', t('找不到这条消息'))
    return transaction(this.db, () => {
      this.deps.topics.route(messageId, 'handed_back', task.id, by, reason)
      const unfollowed = unfollow && message.topicId != null ? this.deps.topics.unfollow(task.id, message.topicId) : false
      this.deps.effects.enqueue('relay', messageId, { note: `[dsh-bot] 这条原本送给了任务「${task.title}」，它交还了：${reason}。当成新的事判断。` })
      return ok({ unfollowed })
    })
  }

  /**
   * 任务结束：送进去还没读、也没确认或交还的消息退回前台；读过没动作的（比如“谢谢”）不退，
   * 还有别的任务在管的也不退。在结束任务的事务里调。
   */
  returnUnread(task: Task): number {
    let count = 0
    for (const route of this.deps.topics.pending(task.id)) {
      if (!this.unread(route.ref) || this.heldElsewhere(route.messageId, task.id)) continue
      this.deps.topics.route(route.messageId, 'returned', task.id, 'code')
      this.deps.effects.enqueue('relay', route.messageId, { note: `[dsh-bot] 这条原本送给了任务「${task.title}」，任务结束时它还没读到。当成新的事判断。` })
      count += 1
    }
    return count
  }

  private unread(ref: string | null): boolean {
    if (ref === null) return false
    if (ref.startsWith('run_')) {
      const run = getRun(this.db, ref)
      return run === undefined || run.startedAt === null
    }
    const delivery = getDelivery(this.db, ref)
    return delivery === undefined || delivery.readAt === null
  }

  /** 别的还开着的任务也收到了这条、没交还。 */
  private heldElsewhere(messageId: string, taskId: string): boolean {
    const routes = this.deps.topics.routes(messageId)
    return routes.some((route) => {
      if (route.taskId === null || route.taskId === taskId || (route.route !== 'direct' && route.route !== 'relayed')) return false
      const other = this.deps.task(route.taskId)
      return other !== undefined && other.endedAt === null && !this.deps.topics.handedBack(messageId, other.id)
    })
  }

  private async relay(messageId: string, payload: Readonly<Record<string, unknown>>): Promise<void> {
    const message = getMessage(this.db, messageId)
    if (message === undefined || message.deletedAt !== null) return
    await this.deps.toFront(message, typeof payload.note === 'string' ? payload.note : '')
  }
}
