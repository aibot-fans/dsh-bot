import type { DatabaseSync } from 'node:sqlite'
import { OWNER, POD, PRIORITY, botFolder, t, truncate, oneLine, type Bot, type PodSession, type Room, type RoomMessage, type Task, type TurnProgress } from 'pod-domain'
import { getDelivery, getMessage, lastChatBreak, listMessages, listRoomMembers, missedFrontRoutes, pendingFor, transaction } from 'pod-store'
import { noticeSource, ownerSource } from '../agents/messages.ts'
import type { TurnFailure } from '../agents/observer.ts'
import type { SessionRegistry } from '../agents/registry.ts'
import { frontTitle, type SegmentManager } from '../agents/segments.ts'
import type { BotService } from '../bots/service.ts'
import type { PreparingState } from '../chat/rooms.ts'
import { failureKind, failureReason } from '../chat/turn-errors.ts'
import type { Dispatcher } from '../effects/delivery.ts'
import { Later, type Effects } from '../effects/queue.ts'
import type { Engine } from '../engine/index.ts'
import type { RelayKind } from '../tasks/replies.ts'
import { ModelRetries, RETRY_DELAYS_MS } from '../tasks/retries.ts'
import { FrontActivity, type ActivityCursor } from './activity.ts'
import { batchText, speakerOf, type BatchItem, type BatchRoom } from './batch.ts'

/** 一个聊天室第一次进前台（或换了一段）时带多少条最近的消息；之后只带前台没看过的，最多这么多。 */
const RECENT_FIRST = 8
const RECENT_MORE = 5

/** 转告里带的问题、结果最多多少字。 */
const RELAY_LIMIT = 1200

const RELAY_HEADS: Readonly<Record<RelayKind, string>> = { wait: '在任务对话里问用户', failed: '没做成' }

export interface FrontDeskDeps {
  readonly db: DatabaseSync
  readonly now: () => number
  readonly effects: Effects
  readonly engine: Engine
  readonly bots: BotService
  readonly registry: SessionRegistry
  readonly dispatcher: Dispatcher
  readonly segments: SegmentManager
  readonly room: (roomId: string) => Room | undefined
  readonly preparing: (key: string, state: PreparingState | null) => void
  /** dsh-bot 在聊天室里说一句（前台出错没处理成时）。 */
  readonly notice: (roomId: string, body: string, data: Readonly<Record<string, unknown>>) => void
  /** 以前台的名义回一句确认（开了任务却没回话时补上的那句）。 */
  readonly confirm: (input: { readonly roomId: string; readonly author: string; readonly sessionId: string; readonly replyTo: string; readonly body: string }) => void
  /** 前台漏掉消息记成系统问题；detail 为 null 时恢复。 */
  readonly problem: (detail: string | null) => void
  readonly warn: (message: string, error?: unknown) => void
}

/** 前台开了任务、还没回用户的那一句：回在哪条下面、没回就补哪句。 */
export interface Unconfirmed {
  readonly roomId: string
  readonly messageId: string
  readonly sessionId: string
  readonly body: string
}

/** 送进前台、还在等结果的那几批。 */
interface Flight {
  readonly sessionId: string
  readonly refs: readonly string[]
  readonly rooms: readonly string[]
}

/**
 * 前台：每个 bot 一个前台会话，跨聊天室。交给前台的消息先记下去向（待送），前台一轮没结束时攒着，
 * 这一轮结束后合成一批送进去（按聊天室分组，开头是在忙的任务和攒下的任务动静）。
 * 一轮结束还有没给去向的追问一次，再没有就记成漏掉。
 */
export class FrontDesk {
  private readonly opening = new Map<string, Promise<PodSession>>()
  /** 这次运行里给每条前台会话设过的标题：名字没变就不再改。 */
  private readonly titles = new Map<string, string>()
  private readonly cursors = new Map<string, ActivityCursor>()
  /** 每段前台会话在各聊天室看到了哪条（seq）。 */
  private readonly seen = new Map<string, Map<string, number>>()
  private readonly flights = new Map<string, Flight>()
  /** 追问过的消息：再没有去向就记成漏掉。 */
  private readonly nudged = new Map<string, ReadonlySet<string>>()
  /** 每个前台这一轮开了任务、还没在那个聊天室回话的。 */
  private readonly unconfirmed = new Map<string, readonly Unconfirmed[]>()
  private readonly retries = new ModelRetries()
  private readonly activity: FrontActivity
  private readonly startedAt: number
  private readonly deps: FrontDeskDeps

  constructor(deps: FrontDeskDeps) {
    this.deps = deps
    this.startedAt = deps.now()
    this.activity = new FrontActivity({
      db: deps.db,
      botName: (botId) => (botId === null ? '—' : (deps.bots.get(botId)?.name ?? botId)),
      roomTitle: (roomId) => (roomId === null ? '—' : (deps.room(roomId)?.title ?? roomId)),
    })
    deps.effects.handle('front', (_payload, row) => this.send(row.key), { limit: () => 4, retry: [2000, 30_000] })
  }

  /** 启动时：重启前没送出的接着送。 */
  start(): void {
    transaction(this.deps.db, () => {
      for (const botId of this.deps.engine.topics.frontsWithQueue()) this.deps.effects.enqueue('front', botId)
    })
    // dsh-bot 没开时可能改过名（比如主管改叫 Super-agent），前台会话的标题跟上。
    for (const bot of this.deps.bots.active()) this.retitle(bot)
  }

  /** bot 改了名：它前台会话在 dsh 里的标题跟着改；名字没变不动。 */
  retitle(bot: Bot): void {
    const session = this.deps.registry.activeFront(bot.id)
    if (session === undefined) return
    const title = frontTitle(bot.name, session.segment)
    if (this.titles.get(session.id) === title) return
    this.titles.set(session.id, title)
    void this.deps.registry.retitle(session.id, title)
  }

  dispose(): void {
    this.retries.dispose()
  }

  /** 交给这几个 bot 的前台：记下去向，排一次合批；页面上先显示“正在接收消息”。 */
  push(message: RoomMessage, bots: readonly Bot[], note = ''): void {
    transaction(this.deps.db, () => {
      for (const bot of bots) {
        this.deps.engine.topics.toFront(message.id, bot.id, note)
        this.deps.effects.enqueue('front', bot.id)
      }
    })
    for (const bot of bots) this.deps.preparing(this.key(bot.id, message.roomId), { roomId: message.roomId, botId: bot.id, label: t('接收消息') })
  }

  /** 这个 bot 现在的前台，没有就开一条（同时来的只开一条）。 */
  session(bot: Bot): Promise<PodSession> {
    const existing = this.deps.registry.activeFront(bot.id)
    if (existing !== undefined) return Promise.resolve(existing)
    const inflight = this.opening.get(bot.id)
    if (inflight !== undefined) return inflight
    const opening = this.deps.registry
      .open({ bot, kind: 'front', roomId: null, taskId: null, folder: botFolder(bot), title: frontTitle(bot.name, 1), ceiling: 'talk' })
      .then((session) => {
        this.titles.set(session.id, frontTitle(bot.name, session.segment))
        return session
      })
      .finally(() => this.opening.delete(bot.id))
    this.opening.set(bot.id, opening)
    return opening
  }

  /**
   * 转告：交给别的 bot 的任务在自己的对话里问了用户、没做成，叫开任务的前台在派活的聊天室说一句。
   * 前台正在跑就排在这一轮后面。
   */
  async relay(task: Task, kind: RelayKind, body: string): Promise<void> {
    const requester = task.requesterSession === null ? undefined : this.deps.registry.get(task.requesterSession)
    const room = task.roomId === null ? undefined : this.deps.room(task.roomId)
    if (requester?.kind !== 'front' || room === undefined || room.archivedAt !== null) return
    const bot = this.deps.bots.activeBot(requester.botId)
    if (bot === undefined) return
    const session = await this.session(bot)
    const owner = (task.ownerBotId === null ? undefined : this.deps.bots.get(task.ownerBotId)?.name) ?? t('干活的 bot')
    this.deps.dispatcher.enqueue({
      sessionId: session.id,
      mode: 'followup',
      priority: PRIORITY.owner,
      text: `[转告] 「${task.title}」（${task.id}，${owner}在做）${RELAY_HEADS[kind]}：\n${truncate(body, RELAY_LIMIT)}\n用 reply 在「${room.title}」（${room.id}）转告用户：purpose 写 relay，room 写 ${room.id}，task 写 ${task.id}。`,
      source: noticeSource(t('转告「{title}」的动静', { title: task.title })),
    })
  }

  /** 前台开了任务：记下来，这一轮结束还没在那个聊天室回话，就替它补一句，任务卡挂在这句下面。 */
  opened(botId: string, entry: Unconfirmed): void {
    this.unconfirmed.set(botId, [...(this.unconfirmed.get(botId) ?? []), entry])
  }

  /** 前台在这个聊天室回了话：开任务那句算回过了。 */
  confirmed(botId: string, roomId: string): void {
    const left = (this.unconfirmed.get(botId) ?? []).filter((entry) => entry.roomId !== roomId)
    if (left.length === 0) this.unconfirmed.delete(botId)
    else this.unconfirmed.set(botId, left)
  }

  /** 一轮结束还没回的：以前台的名义补上那一句。 */
  private confirmLeft(botId: string): void {
    const left = this.unconfirmed.get(botId) ?? []
    this.unconfirmed.delete(botId)
    for (const entry of left) this.deps.confirm({ roomId: entry.roomId, author: botId, sessionId: entry.sessionId, replyTo: entry.messageId, body: entry.body })
  }

  /** 前台说了话（reply）：这个聊天室的“正在……”收掉，这一轮后面的进度也不再写到这里。 */
  replied(botId: string, roomId: string): void {
    this.deps.preparing(this.key(botId, roomId), null)
    const flight = this.flights.get(botId)
    if (flight !== undefined) this.flights.set(botId, { ...flight, rooms: flight.rooms.filter((id) => id !== roomId) })
  }

  /** 前台这一轮在想什么、在做哪一步：它在看、还没回话的那几个聊天室最底下那一行跟着变。 */
  progressed(session: PodSession, label: string, progress: TurnProgress | null): void {
    const flight = this.flightOf(session)
    if (flight === undefined) return
    for (const roomId of flight.rooms) this.deps.preparing(this.key(session.botId, roomId), { roomId, botId: session.botId, label: label === '' ? t('看消息') : label, progress })
  }

  private key(botId: string, roomId: string): string {
    return `front:${botId}:${roomId}`
  }

  /** 合批：前台在跑、或者上一批还没交出去，就等这一轮结束再送。 */
  private async send(botId: string): Promise<void> {
    if (this.deps.engine.topics.frontQueue(botId).length === 0) return
    const bot = this.deps.bots.activeBot(botId)
    if (bot === undefined) {
      this.drop(botId)
      return
    }
    const current = await this.session(bot)
    if (this.deps.dispatcher.isRunning(current.id) || pendingFor(this.deps.db, current.id).length > 0) throw new Later()
    const session = this.deps.segments.needsRotation(current) ? await this.deps.segments.rotateFront(bot, current) : current
    const queue = this.deps.engine.topics.frontQueue(botId)
    const items = queue.flatMap((route) => {
      const message = getMessage(this.deps.db, route.messageId)
      return message === undefined || message.deletedAt !== null ? [] : [{ route, message }]
    })
    const rooms = this.group(session, items.map((item) => ({ message: item.message, note: item.route.note })))
    const now = this.deps.now()
    const cursor = this.cursors.get(botId) ?? this.activity.now(this.startedAt)
    const activity = this.activity.since(bot, cursor, now)
    const roomIds = new Set(rooms.map((group) => group.room.id))
    const text = batchText({
      rooms,
      tasks: this.activity.openTasks(bot, roomIds),
      activity: activity.lines,
      omitted: activity.omitted,
      speaker: (author) => speakerOf(author, (id) => this.deps.bots.get(id)?.name),
      quoted: (id) => getMessage(this.deps.db, id),
    })
    const fresh = session.steps === 0 && session.segment > 1 ? '[新的一段] 上一段前台对话太长或空闲太久，换成了新的一段；更早的事按 id 读，或者用 search_history 查。\n\n' : ''
    const fromOwner = items.some((item) => item.message.author === OWNER)
    const delivery = transaction(this.deps.db, () => {
      const created = this.deps.dispatcher.enqueue({
        sessionId: session.id,
        mode: 'followup',
        priority: fromOwner ? PRIORITY.owner : PRIORITY.consult,
        text: `${fresh}${text}`,
        source: fromOwner ? ownerSource() : noticeSource(t('群里的 bot 点了名')),
      })
      this.deps.engine.topics.bindFront(
        queue.map((route) => route.id),
        created.id,
      )
      return created
    })
    this.cursors.set(botId, activity.cursor)
    this.markSeen(session, rooms)
    const flight = this.flights.get(botId)
    const sameSession = flight?.sessionId === session.id
    this.flights.set(botId, {
      sessionId: session.id,
      refs: [...(sameSession ? flight.refs : []), delivery.id],
      rooms: [...new Set([...(sameSession ? flight.rooms : []), ...roomIds])],
    })
    for (const roomId of roomIds) this.deps.preparing(this.key(botId, roomId), { roomId, botId, label: t('看消息') })
  }

  /** 按聊天室分组（按第一条新消息的先后），每组带前台没看过的最近几条。 */
  private group(session: PodSession, items: readonly BatchItem[]): readonly BatchRoom[] {
    const order: string[] = []
    const byRoom = new Map<string, BatchItem[]>()
    for (const item of items) {
      const list = byRoom.get(item.message.roomId)
      if (list === undefined) {
        order.push(item.message.roomId)
        byRoom.set(item.message.roomId, [item])
      } else list.push(item)
    }
    const seen = this.seen.get(session.id)
    return order.flatMap((roomId) => {
      const room = this.deps.room(roomId)
      const list = byRoom.get(roomId) ?? []
      if (room === undefined) return []
      const first = Math.min(...list.map((item) => item.message.seq))
      const since = Math.max(seen?.get(roomId) ?? 0, lastChatBreak(this.deps.db, roomId))
      const ids = new Set(list.map((item) => item.message.id))
      const recent = listMessages(this.deps.db, roomId, { before: first, limit: seen?.has(roomId) === true ? RECENT_MORE : RECENT_FIRST })
        .filter((message) => message.seq > since && !ids.has(message.id) && message.author !== POD && (message.kind === 'text' || message.kind === 'task-card'))
      const members = room.kind === 'direct' ? [] : listRoomMembers(this.deps.db, roomId).flatMap((member) => this.deps.bots.get(member.botId)?.name ?? [])
      return [{ room, members, recent, items: list }]
    })
  }

  private markSeen(session: PodSession, rooms: readonly BatchRoom[]): void {
    const seen = new Map(this.seen.get(session.id) ?? [])
    for (const group of rooms) seen.set(group.room.id, Math.max(seen.get(group.room.id) ?? 0, ...group.items.map((item) => item.message.seq)))
    this.seen.set(session.id, seen)
  }

  /** bot 不在了：交给它的消息没人接，记成漏掉。 */
  private drop(botId: string): void {
    const queue = this.deps.engine.topics.frontQueue(botId)
    transaction(this.deps.db, () => {
      this.deps.engine.topics.bindFront(
        queue.map((route) => route.id),
        'dropped',
      )
      for (const route of queue) this.deps.engine.topics.decide(route.messageId, botId, 'missed', null, t('bot 已经不在了'))
    })
  }

  /** 你点了系统问题上的“重试”：这段时间记成漏掉的消息重新交给各自的前台（bot 还在的），返回几条。 */
  retryMissed(since: number): number {
    const routes = missedFrontRoutes(this.deps.db, since).filter((route) => route.botId !== null && this.deps.bots.get(route.botId)?.archivedAt === null)
    transaction(this.deps.db, () => {
      for (const route of routes) this.deps.engine.topics.toFront(route.messageId, route.botId ?? '', t('漏掉后重试'))
      for (const botId of new Set(routes.map((route) => route.botId ?? ''))) this.deps.effects.enqueue('front', botId)
    })
    return routes.length
  }

  /** 前台一轮结束：开了任务没回话的补一句，收掉“正在……”，查没去向的；有排着的消息就送下一批。 */
  onTurnEnd(session: PodSession, reason: string, failure?: TurnFailure): void {
    if (session.kind !== 'front') return
    this.confirmLeft(session.botId)
    const flight = this.flightOf(session)
    if (flight !== undefined) {
      for (const roomId of flight.rooms) this.deps.preparing(this.key(session.botId, roomId), null)
      const taken = flight.refs.filter((ref) => getDelivery(this.deps.db, ref)?.takenAt != null)
      const waiting = flight.refs.filter((ref) => !taken.includes(ref))
      const kind = failure === undefined ? undefined : failureKind(failure)
      if (failure !== undefined && kind === 'transient' && taken.length > 0) this.retryLater(session, failure, flight)
      else {
        this.retries.clear(session.botId)
        if (failure !== undefined) this.failed(session, failure, taken)
        else if (reason !== 'aborted') this.check(session, taken)
      }
      const left = [...waiting, ...this.unsettled(session.botId, taken)]
      if (left.length === 0) this.flights.delete(session.botId)
      else this.flights.set(session.botId, { ...flight, refs: left })
    }
    this.deps.effects.enqueue('front', session.botId)
  }

  /** 这条前台会话在等结果的那几批；重启后内存里没有，按库里送给它、还没去向的补上。 */
  private flightOf(session: PodSession): Flight | undefined {
    const flight = this.flights.get(session.botId)
    if (flight !== undefined && flight.sessionId === session.id) return flight
    const refs = this.deps.engine.topics.inFlight(session.botId).filter((ref) => getDelivery(this.deps.db, ref)?.sessionId === session.id)
    if (refs.length === 0) return undefined
    const rooms = new Set(this.deps.engine.topics.undecided(session.botId, refs).flatMap((route) => getMessage(this.deps.db, route.messageId)?.roomId ?? []))
    return { sessionId: session.id, refs, rooms: [...rooms] }
  }

  /** 还有没去向的消息的那几批（追问过的等下一轮再查）。 */
  private unsettled(botId: string, refs: readonly string[]): readonly string[] {
    const open = new Set(this.deps.engine.topics.undecided(botId, refs).map((route) => route.ref))
    return refs.filter((ref) => open.has(ref))
  }

  /** 每条都要有去向：第一次追问，追问过还没有记成漏掉，显示在系统问题里。 */
  private check(session: PodSession, refs: readonly string[]): void {
    const undecided = this.deps.engine.topics.undecided(session.botId, refs)
    const asked = this.nudged.get(session.botId) ?? new Set<string>()
    const stale = undecided.filter((route) => asked.has(route.messageId))
    const fresh = undecided.filter((route) => !asked.has(route.messageId))
    if (stale.length > 0) {
      transaction(this.deps.db, () => {
        for (const route of stale) this.deps.engine.topics.decide(route.messageId, session.botId, 'missed', null, t('追问后还是没有去向'))
      })
      const name = this.deps.bots.get(session.botId)?.name ?? session.botId
      this.deps.problem(t('{name}的前台漏掉了 {count} 条消息：{ids}', { name, count: stale.length, ids: stale.map((route) => route.messageId).join('、') }))
    } else if (undecided.length === 0 && refs.length > 0) this.deps.problem(null)
    this.nudged.set(session.botId, new Set([...[...asked].filter((id) => !stale.some((route) => route.messageId === id)), ...fresh.map((route) => route.messageId)]))
    if (fresh.length === 0) return
    const lines = fresh.map((route) => {
      const message = getMessage(this.deps.db, route.messageId)
      return `- ${route.messageId}：${message === undefined ? '' : truncate(oneLine(message.body), 60)}`
    })
    this.deps.dispatcher.enqueue({
      sessionId: session.id,
      mode: 'followup',
      priority: PRIORITY.owner,
      text: `[dsh-bot] 这几条还没有去向：\n${lines.join('\n')}\n用 dispatch 给每条记去向；要答的用 reply 发出去（你写在这里的文字用户看不到）。`,
      source: noticeSource(t('提醒前台给消息记去向')),
    })
  }

  /** 模型临时出错：等一会儿叫它接着处理这一批；几次都不行就当作处理失败。 */
  private retryLater(session: PodSession, failure: TurnFailure, flight: Flight): void {
    const count = this.retries.schedule(session.botId, (attempt) => {
      if (this.deps.dispatcher.isRunning(session.id)) return
      this.deps.dispatcher.enqueue({
        sessionId: session.id,
        mode: 'followup',
        priority: PRIORITY.owner,
        text: '[dsh-bot] 刚才模型服务出错，上一批消息还没处理完。接着处理：每条用 dispatch 记去向，要答的用 reply 发出去。',
        source: noticeSource(t('模型服务出错，第 {attempt} 次重试', { attempt })),
      })
    })
    if (count !== undefined) return
    this.failed(session, failure, flight.refs, t('自动重试了 {count} 次都没成', { count: RETRY_DELAYS_MS.length }))
  }

  /** 处理失败：没去向的记成漏掉，在涉及的聊天室说一句原因。 */
  private failed(session: PodSession, failure: TurnFailure, refs: readonly string[], extra?: string): void {
    const undecided = this.deps.engine.topics.undecided(session.botId, refs)
    if (undecided.length === 0) return
    const reason = extra === undefined ? failureReason(failure) : `${failureReason(failure)}（${extra}）`
    transaction(this.deps.db, () => {
      for (const route of undecided) this.deps.engine.topics.decide(route.messageId, session.botId, 'missed', null, reason)
    })
    const name = this.deps.bots.get(session.botId)?.name ?? session.botId
    const rooms = new Set(undecided.flatMap((route) => getMessage(this.deps.db, route.messageId)?.roomId ?? []))
    for (const roomId of rooms) {
      this.deps.notice(roomId, t('{name}没回成：{reason}', { name, reason }), { turnError: { code: failure.code, botId: session.botId, detail: '', retry: true } })
    }
  }
}
