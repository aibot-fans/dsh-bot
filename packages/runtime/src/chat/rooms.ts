import type { DatabaseSync } from 'node:sqlite'
import {
  BOT_CALL_LIMIT,
  LEAD_ALIASES,
  OWNER,
  POD,
  ROOM_TITLE_MAX,
  MESSAGE_MAX,
  botCallsSinceOwner,
  botFolder,
  charLength,
  fail,
  isTemporaryRoom,
  maskSecrets,
  newId,
  ok,
  oneLine,
  readBool,
  readEnum,
  readId,
  readInt,
  readObject,
  readString,
  roomFolder,
  t,
  truncate,
  type Bot,
  type MessageKind,
  type PodResult,
  type PodSession,
  type Room,
  type RoomMessage,
  type RoomSummary,
  type RunSummary,
  type TurnProgress,
} from 'pod-domain'
import {
  addRoomMember,
  appendMessage,
  clearRoomMessages,
  findDirectRooms,
  firstOwnerLine,
  firstOwnerLines,
  getMessage,
  getRoom,
  insertRoom,
  lastChatBreak,
  lastMessages,
  listMessages,
  listRoomMembers,
  listRooms,
  markRoomRead,
  pinnedMessages,
  transaction,
  updateMessage,
  updateRoom,
  type MessagePatch,
  type RoomPatch,
} from 'pod-store'
import type { Dispatcher } from '../effects/delivery.ts'
import type { SessionRegistry } from '../agents/registry.ts'
import type { BotService } from '../bots/service.ts'
import type { Auditor } from '../core/audit.ts'
import type { PodBus } from '../core/bus.ts'
import { resolveMembers, stripMentions } from './group.ts'
import { GroupService } from './groups.ts'

const PAGE = 50

/** 对话记录里的标题：你说的第一句话，压成一行截短。 */
export function chatSubject(text: string, max = 24): string {
  return truncate(oneLine(text).replace(/^\/\S+\s*/, ''), max)
}

/** 你的话还没交到 bot 手上时，页面上那一行“正在……”在哪个房间、是谁、在做什么；前台在看这个房间的消息时带上它这一轮的进度。 */
export interface PreparingState {
  readonly roomId: string
  readonly botId: string
  readonly label: string
  readonly progress?: TurnProgress | null
}

export interface RoomServiceDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly bots: BotService
  readonly registry: SessionRegistry
  readonly dispatcher: Dispatcher
  readonly audit: Auditor
  readonly now: () => number
  /** 房间里有任务在跑吗（房间列表的状态点）。 */
  readonly busy: (room: Room) => boolean
  /** 每个聊天室里在跑的任务数。 */
  readonly runningTasks: () => ReadonlyMap<string, number>
  /** 房间里还开着的等你事项数。 */
  readonly openWaits: (roomId: string) => number
  /** 消息写入或更新后进搜索索引。 */
  readonly indexed: (message: RoomMessage) => void
  /** 没另记组长的群里谁先接：正式团队是团队组长，任务群是负责的 bot。 */
  readonly leaderFor: (room: Room) => Bot | undefined
  /** 你在房间里说了话（自我优化据此认出“以后别这样”之类的纠正）。 */
  readonly onOwnerText?: (message: RoomMessage) => void
  /** 接收：你的话在有任务跟进的话题里就直通那些任务（任务群里 @ 了成员的先看它的子任务），返回直通了几个；0 才交给前台。 */
  readonly intake?: (message: RoomMessage, mentioned: readonly Bot[]) => number
  /** 引用回复的是还开着的等你：这句话就是答复；答上了返回 true。 */
  readonly answerWait?: (waitId: string, answer: string) => boolean
  /** 交给这几个 bot 的前台（每个 bot 一个，跨聊天室）；note 是交给前台时附的说明。 */
  readonly front: (message: RoomMessage, bots: readonly Bot[], note: string) => void
  /** 这个 bot 现在的前台。 */
  readonly frontOf: (botId: string) => PodSession | undefined
  /** 停掉一条会话正在跑的这一轮（停止回复、清空记录、开新对话时用）。 */
  readonly stopSession: (sessionId: string) => void
  /** 临时对话删掉时，把 dsh 里对应的会话也归档，dsh 的会话列表里就不再出现。 */
  readonly hideSession?: (sessionId: string) => void
}

/**
 * 房间和消息：你的话先看话题，有任务跟进就直通任务；没有就交给前台（每个 bot 一个，跨聊天室）：
 * 单聊是那个 bot 的，群里被 @ 或被引用的成员是它自己的，其他没点名的是组长的（普通群建群时定，任务群是负责的 bot，
 * 正式团队是团队组长）。Super-agent 在群里只在被点名、被引用时接。前台用 reply 说话；房间记录是唯一的事实来源。
 */
export class RoomService {
  private readonly opening = new Map<string, Promise<PodSession>>()
  /** 每个 bot 在每个群里最近一次是谁叫起来的：用户（OWNER）或 @ 了它的 bot。用来拦住“被 @ 了又 @ 回去”。 */
  private readonly triggers = new Map<string, string>()
  private readonly deps: RoomServiceDeps
  /** 群：建群、加人移人和组长。 */
  readonly groups: GroupService

  constructor(deps: RoomServiceDeps) {
    this.deps = deps
    this.groups = new GroupService({ db: deps.db, bus: deps.bus, bots: deps.bots, registry: deps.registry, audit: deps.audit, now: deps.now, stopSession: deps.stopSession, rooms: this })
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  get(roomId: string): Room | undefined {
    return getRoom(this.db, roomId)
  }

  /** 和主管最近的那段对话：默认置顶，是交代任务的主入口；日报、周报这些也发到这里。没有就建一个。 */
  ensureLeadRoom(): Room {
    const lead = this.deps.bots.lead()
    const existing = this.threads(lead.id).find((room) => room.topic === '')
    if (existing !== undefined) {
      if (!existing.pinned) return updateRoom(this.db, existing.id, { pinned: true }) ?? existing
      return existing
    }
    return this.createDirect(lead, { topic: '', pinned: true, incognito: false })
  }

  private createDirect(bot: Bot, options: { readonly topic: string; readonly pinned: boolean; readonly incognito: boolean; readonly taskId?: string }): Room {
    const now = this.deps.now()
    const room = transaction(this.db, () => {
      const created = insertRoom(this.db, {
        id: newId('room'),
        kind: 'direct',
        title: options.topic === '' ? bot.name : truncate(options.topic, ROOM_TITLE_MAX),
        botId: bot.id,
        taskId: options.taskId ?? null,
        topic: options.topic,
        pinned: options.pinned,
        incognito: options.incognito,
        now,
      })
      addRoomMember(this.db, created.id, bot.id, now)
      return created
    })
    this.deps.bus.emit({ type: 'rooms' })
    return room
  }

  /** 任务单聊：把任务交给这个 bot 时和它另开的一段单聊，标题是任务名，进它的对话记录。 */
  createTaskChat(bot: Bot, title: string, taskId: string): Room {
    return this.createDirect(bot, { topic: title, pinned: false, incognito: false, taskId })
  }

  /** 你和一个 bot 的每一段对话（单聊），最近的在前；不含临时对话和删掉的。 */
  threads(botId: string): readonly Room[] {
    return findDirectRooms(this.db, botId).filter((room) => room.archivedAt === null && !isTemporaryRoom(room))
  }

  /**
   * 开新对话。单聊另开一段：之前的那段原样留着，在对话记录里能回去接着聊；现在这段还没说过话就不再另开一段。
   * 群聊还是这个群，见 newGroupConversation。bot 在新的这段里不带之前的上下文，需要时自己去查。
   */
  newConversation(input: unknown): PodResult<Room> {
    const roomId = readId(input, 'roomId')
    const current = roomId === undefined ? undefined : this.get(roomId)
    if (current !== undefined && current.kind !== 'direct') return this.newGroupConversation(current)
    const bot = this.deps.bots.activeBot(current?.botId ?? readId(input, 'botId') ?? '')
    if (bot === undefined) return fail('not-found', t('找不到这个 bot'))
    const threads = this.threads(bot.id)
    const latest = current !== undefined && current.archivedAt === null && !isTemporaryRoom(current) ? current : threads[0]
    if (latest !== undefined && latest.lastSeq === 0) return ok(latest)
    const room = this.createDirect(bot, { topic: '', pinned: bot.role === 'lead' || threads.some((thread) => thread.pinned), incognito: false })
    this.deps.audit.record('room.new-conversation', OWNER, room.id, { botId: bot.id })
    return ok(room)
  }

  /**
   * 群聊开新对话：还是这个群，时间线上留一条分隔线；正在回答的成员停下，每个成员换一条新会话，之前的群聊不再转给它们。
   * 刚开过、还没人说话就不再加一条。任务群跟着任务走，不开新对话。
   */
  private newGroupConversation(room: Room): PodResult<Room> {
    if (room.archivedAt !== null) return fail('not-found', t('找不到这个群聊'))
    if (room.taskId !== null) return fail('invalid-input', t('任务群不开新对话，直接接着说就行'))
    if (room.lastSeq === 0 || lastChatBreak(this.db, room.id) === room.lastSeq) return ok(room)
    for (const session of this.chatsIn(room.id)) {
      this.deps.stopSession(session.id)
      this.deps.registry.retire(session.id)
    }
    const marker = this.post(room.id, { author: POD, kind: 'notice', body: t('新对话'), data: { segment: true } })
    if (marker !== undefined) markRoomRead(this.db, room.id, marker.seq)
    this.deps.audit.record('room.new-conversation', OWNER, room.id, {})
    return ok(this.get(room.id) ?? room)
  }

  /** 删掉一段对话：先进回收站，30 天内能恢复；正在回答的停下来。 */
  deleteConversation(input: unknown): PodResult<null> {
    const found = this.room(input)
    if (!found.ok) return found
    const room = found.value
    if (room.kind !== 'direct') return fail('invalid-input', t('群聊在侧栏的“…”里删除'))
    for (const session of this.chatsIn(room.id)) {
      this.deps.stopSession(session.id)
      this.deps.registry.retire(session.id)
    }
    updateRoom(this.db, room.id, { archivedAt: this.deps.now() })
    this.deps.audit.record('room.delete-conversation', OWNER, room.id, {})
    this.deps.bus.emit({ type: 'rooms' })
    this.deps.bus.emit({ type: 'room', roomId: room.id })
    return ok(null)
  }

  /** 打开和某个 bot 的单聊：默认回到最近那个；fresh 表示按新话题另开一个。 */
  openDirect(input: unknown): PodResult<Room> {
    const botId = readId(input, 'botId')
    if (botId === undefined) return fail('invalid-input', t('缺少 bot 的 id'))
    const bot = this.deps.bots.activeBot(botId)
    if (bot === undefined) return fail('not-found', t('找不到这个 bot'))
    const fresh = readBool(input, 'fresh') === true
    const incognito = readBool(input, 'incognito') === true
    const topic = readString(input, 'topic')
    if (!fresh && !incognito) {
      const latest = findDirectRooms(this.db, bot.id).find((room) => room.archivedAt === null && room.topic === topic)
      if (latest !== undefined) return ok(latest)
    }
    const title = topic === '' && fresh ? t('{name} · 新话题', { name: bot.name }) : topic
    return ok(this.createDirect(bot, { topic: title, pinned: false, incognito }))
  }

  /** 建一个任务记录（群聊）。 */
  createTaskRoom(title: string, taskId: string, members: readonly string[], teamId: string | null): Room {
    const now = this.deps.now()
    const room = transaction(this.db, () => {
      const created = insertRoom(this.db, {
        id: newId('room'),
        kind: 'task',
        title: truncate(title, ROOM_TITLE_MAX),
        taskId,
        teamId,
        now,
      })
      for (const botId of new Set(members)) addRoomMember(this.db, created.id, botId, now)
      return created
    })
    this.deps.bus.emit({ type: 'rooms' })
    return room
  }

  /**
   * 群的组长：没点名的话先给它。普通群是建群时定的（定的那个不在群里了，就是排在最前的成员），
   * 任务群是负责的 bot，正式团队是团队组长；单聊没有。
   */
  leaderOf(room: Room): Bot | undefined {
    if (room.kind === 'direct') return undefined
    const members = this.memberBots(room)
    const chosen = room.leadBotId === null ? undefined : members.find((bot) => bot.id === room.leadBotId)
    return chosen ?? this.deps.leaderFor(room) ?? members.find((bot) => bot.role !== 'lead')
  }

  private chatsIn(roomId: string): readonly PodSession[] {
    return this.deps.registry.active().filter((session) => session.roomId === roomId && session.kind === 'chat')
  }

  private room(input: unknown): PodResult<Room> {
    const roomId = readId(input, 'roomId')
    const room = roomId === undefined ? undefined : this.get(roomId)
    return room === undefined || room.archivedAt !== null ? fail('not-found', t('找不到这个对话')) : ok(room)
  }

  /** 停止回复：停掉这个房间里正在回答的 bot（它的前台这一轮）。任务不受影响，任务用任务卡上的“停止”。 */
  stop(input: unknown): PodResult<{ readonly stopped: number }> {
    const found = this.room(input)
    if (!found.ok) return found
    const room = found.value
    const bots = room.kind === 'direct' ? (room.botId === null ? [] : [room.botId]) : this.members(room.id).map((member) => member.botId)
    const fronts = bots.map((botId) => this.deps.frontOf(botId)).filter((session): session is PodSession => session !== undefined)
    const running = [...this.chatsIn(room.id), ...fronts].filter((session) => this.deps.dispatcher.isRunning(session.id))
    for (const session of running) this.deps.stopSession(session.id)
    return ok({ stopped: running.length })
  }

  /** 清空聊天记录：消息全部删掉，bot 也不再带着之前的上下文；bot 本身和它的记忆保留。 */
  clear(input: unknown): PodResult<{ readonly removed: number }> {
    const found = this.room(input)
    if (!found.ok) return found
    const room = found.value
    const temporary = isTemporaryRoom(room)
    for (const session of this.chatsIn(room.id)) {
      this.deps.stopSession(session.id)
      if (temporary) this.deps.hideSession?.(session.id)
      this.deps.registry.retire(session.id)
    }
    const removed = clearRoomMessages(this.db, room.id, this.deps.now())
    for (const message of removed) this.deps.indexed(message)
    this.deps.audit.record('room.clear', OWNER, room.id, { removed: removed.length })
    this.deps.bus.emit({ type: 'room', roomId: room.id })
    this.deps.bus.emit({ type: 'rooms' })
    return ok({ removed: removed.length })
  }

  addMember(roomId: string, botId: string): void {
    addRoomMember(this.db, roomId, botId, this.deps.now())
    this.deps.bus.emit({ type: 'room', roomId })
  }

  members(roomId: string): readonly { readonly botId: string; readonly muted: boolean }[] {
    return listRoomMembers(this.db, roomId)
  }

  list(input: unknown): PodResult<readonly RoomSummary[]> {
    const archived = readBool(input, 'archived') === true || readString(input, 'archived') === 'true'
    const last = lastMessages(this.db)
    const subjects = firstOwnerLines(this.db)
    const rooms = listRooms(this.db, { archived })
    const running = this.deps.runningTasks()
    return ok(
      rooms.map((room) => {
        const message = last.get(room.id)
        return {
          ...room,
          unread: Math.max(0, room.lastSeq - room.readSeq),
          preview: message === undefined ? '' : truncate(oneLine(previewOf(message, this.deps.bots)), 60),
          busy: this.deps.busy(room),
          running: running.get(room.id) ?? 0,
          waits: this.deps.openWaits(room.id),
          memberIds: listRoomMembers(this.db, room.id).map((member) => member.botId),
          leaderId: this.leaderOf(room)?.id ?? null,
          // 任务单聊的题目就是任务名；别的单聊取你说的第一句。
          subject: room.kind !== 'direct' ? '' : room.taskId !== null && room.topic !== '' ? room.topic : chatSubject(subjects.get(room.id) ?? ''),
        }
      }),
    )
  }

  messages(input: unknown): PodResult<{ readonly room: Room; readonly messages: readonly RoomMessage[] }> {
    const roomId = readId(input, 'roomId')
    if (roomId === undefined) return fail('invalid-input', t('缺少房间 id'))
    const room = this.get(roomId)
    if (room === undefined) return fail('not-found', t('找不到这个房间'))
    const before = Number(readString(input, 'before'))
    const after = Number(readString(input, 'after'))
    const around = Number(readString(input, 'around'))
    const limit = Math.min(readInt(input, 'limit') ?? (Number(readString(input, 'limit')) || PAGE), 200)
    if (Number.isSafeInteger(around) && around > 0) {
      // 从搜索结果跳过来：加载目标消息前后的内容。
      const older = listMessages(this.db, roomId, { before: around + 1, limit: Math.ceil(limit / 2) })
      const newer = listMessages(this.db, roomId, { after: around, limit: Math.floor(limit / 2) })
      return ok({ room, messages: [...older, ...newer] })
    }
    const messages = listMessages(this.db, roomId, {
      limit,
      ...(Number.isSafeInteger(before) && before > 0 ? { before } : {}),
      ...(Number.isSafeInteger(after) && after > 0 ? { after } : {}),
    })
    return ok({ room, messages })
  }

  /** 追加一条消息并通知页面。 */
  post(
    roomId: string,
    message: {
      /** 事先定好的消息 id（回复队列用它当回执，重做时不会发两遍）。 */
      readonly id?: string
      readonly author: string
      readonly kind: MessageKind
      readonly body: string
      readonly data?: Readonly<Record<string, unknown>>
      readonly sessionId?: string | null
      readonly replyTo?: string | null
      readonly topicFrom?: string | null
    },
  ): RoomMessage | undefined {
    if (this.get(roomId) === undefined) return undefined
    const posted = transaction(this.db, () =>
      appendMessage(this.db, {
        id: message.id ?? newId('msg'),
        roomId,
        author: message.author,
        kind: message.kind,
        body: message.body,
        ...(message.data === undefined ? {} : { data: message.data }),
        ...(message.sessionId === undefined ? {} : { sessionId: message.sessionId }),
        ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
        ...(message.topicFrom === undefined ? {} : { topicFrom: message.topicFrom }),
        now: this.deps.now(),
      }),
    )
    this.deps.bus.emit({ type: 'message', roomId, messageId: posted.id })
    this.deps.bus.emit({ type: 'rooms' })
    this.deps.indexed(posted)
    return posted
  }

  /** 原地更新一条消息（卡片刷新等），不改变它在时间线里的位置。 */
  patchMessage(messageId: string, patch: MessagePatch): RoomMessage | undefined {
    const updated = updateMessage(this.db, messageId, patch, this.deps.now())
    if (updated !== undefined) {
      this.deps.bus.emit({ type: 'message', roomId: updated.roomId, messageId })
      this.deps.indexed(updated)
    }
    return updated
  }

  /** Pod 自己的一行里程碑。 */
  milestone(roomId: string | null, body: string, data: Readonly<Record<string, unknown>> = {}): void {
    if (roomId === null) return
    this.post(roomId, { author: POD, kind: 'milestone', body, data })
  }

  /** 你在房间里说话：先打码再存；在有任务跟进的话题里就直通任务，否则交给前台。 */
  async send(input: unknown): Promise<PodResult<RoomMessage>> {
    const roomId = readId(input, 'roomId')
    if (roomId === undefined) return fail('invalid-input', t('缺少房间 id'))
    const room = this.get(roomId)
    if (room === undefined || room.archivedAt !== null) return fail('not-found', t('找不到这个房间'))
    const raw = readString(input, 'text')
    if (raw === '') return fail('invalid-input', t('消息不能为空'))
    if (charLength(raw) > MESSAGE_MAX) return fail('invalid-input', t('一条消息最多 {MESSAGE_MAX} 个字', { MESSAGE_MAX }))
    const masked = maskSecrets(raw)
    const replyTo = readId(input, 'replyTo') ?? null
    const mentioned = room.kind === 'direct' ? [] : this.mentioned(room, masked.text)
    if (this.responder(room) === undefined) return fail('not-found', t('这个房间里没有能回答的 bot'))
    const message = this.post(roomId, {
      author: OWNER,
      kind: 'text',
      body: masked.text,
      replyTo,
      // calls：这条消息真的通知了谁，页面上写“已通知”；群里没 @ 到成员时是空的，提到群外 bot 的 @ 画成淡色。
      data: { ...(masked.kinds.length === 0 ? {} : { masked: masked.kinds }), ...(room.kind === 'direct' ? {} : { calls: mentioned.map((bot) => bot.id) }) },
    })
    if (message === undefined) return fail('not-found', t('找不到这个房间'))
    markRoomRead(this.db, roomId, message.seq)
    this.deps.onOwnerText?.(message)
    // 引用了挂着等你卡片的那句话（问的那句、前台转告的那句）回字：就是答复，答复照常转回给问的任务。
    const quoted = replyTo === null ? undefined : getMessage(this.db, replyTo)
    if (typeof quoted?.data.waitId === 'string' && this.deps.answerWait?.(quoted.data.waitId, masked.text) === true) return ok(message)
    // 回复、引用的是有任务跟进的话题（比如任务卡）：直接送进那些任务，不再交给前台。
    if ((this.deps.intake?.(message, mentioned) ?? 0) > 0) return ok(message)
    this.toFronts(room, message, '')
    return ok(message)
  }

  /** 交给前台：单聊是那个 bot；群里被 @ 的、被引用的成员各自接，其他没点名的给组长。 */
  private toFronts(room: Room, message: RoomMessage, note: string): void {
    const bots = this.frontsFor(room, message)
    if (bots.length === 0) {
      this.milestone(room.id, t('这个房间里没有能回答的 bot'))
      return
    }
    if (room.kind !== 'direct' && message.author === OWNER) for (const bot of bots) this.triggers.set(`${room.id}:${bot.id}`, OWNER)
    this.deps.front(message, bots, note)
  }

  private frontsFor(room: Room, message: RoomMessage): readonly Bot[] {
    if (room.kind === 'direct') {
      const bot = room.botId === null ? undefined : this.deps.bots.activeBot(room.botId)
      return bot === undefined ? [] : [bot]
    }
    const members = this.memberBots(room)
    const quoted = message.replyTo === null ? undefined : getMessage(this.db, message.replyTo)
    const quotedBot = quoted === undefined ? undefined : members.find((bot) => bot.id === quoted.author)
    const named = [...this.mentioned(room, message.body), ...(quotedBot === undefined ? [] : [quotedBot])].filter((bot) => bot.id !== message.author)
    const unique = named.filter((bot, index) => named.findIndex((item) => item.id === bot.id) === index)
    if (unique.length > 0) return unique
    const fallback = this.responder(room)
    return fallback === undefined || fallback.id === message.author ? [] : [fallback]
  }

  /** 任务交还、或任务结束时没读到的你的消息：重新交给前台判断。 */
  toFront(message: RoomMessage, note: string): Promise<void> {
    const room = this.get(message.roomId)
    if (room !== undefined && room.archivedAt === null) this.toFronts(room, message, note)
    return Promise.resolve()
  }

  /** 群里现在的成员（在用的 bot）。 */
  memberBots(room: Room): readonly Bot[] {
    return listRoomMembers(this.db, room.id)
      .map((member) => this.deps.bots.activeBot(member.botId))
      .filter((bot): bot is Bot => bot !== undefined)
  }

  /** 消息里 @ 到的群成员（按名字匹配，长名字优先，避免“写手”吞掉“写手二号”）；@主管、@管理员 也算点名主管。 */
  mentioned(room: Room, text: string): readonly Bot[] {
    if (!text.includes('@')) return []
    const members = [...this.memberBots(room)].sort((left, right) => right.name.length - left.name.length)
    let rest = text
    const found: Bot[] = []
    for (const bot of members) {
      const tag = `@${bot.name}`
      if (!rest.includes(tag)) continue
      found.push(bot)
      rest = rest.split(tag).join(' ')
    }
    const lead = members.find((bot) => bot.role === 'lead')
    if (lead !== undefined && !found.includes(lead) && LEAD_ALIASES.some((alias) => rest.includes(`@${alias}`))) found.push(lead)
    return found
  }

  /**
   * bot 在群里 @ 别的成员（mention_member）：以它的名义在群里发一条带 @ 的消息，交给被 @ 的成员的前台，
   * 它们在群里回答。用户说一句话以后 bot 之间最多点名 BOT_CALL_LIMIT 次。
   * 刚 @ 了它的 bot 不再点回去（它的回复本来就发在群里，对方看得到），免得一来一回刷屏。
   */
  async mentionFromBot(
    session: PodSession,
    roomId: string,
    names: readonly string[],
    message: string,
  ): Promise<PodResult<{ readonly called: readonly string[]; readonly skipped: readonly string[] }>> {
    const room = this.get(roomId)
    if (room === undefined || room.archivedAt !== null || room.kind === 'direct') return fail('invalid-input', t('只有在群聊里才能 @ 成员'))
    const speaker = this.deps.bots.activeBot(session.botId)
    if (speaker === undefined) return fail('not-found', t('找不到你自己'))
    const members = this.memberBots(room)
    if (!members.some((bot) => bot.id === speaker.id)) return fail('invalid-input', t('你不在这个群里'))
    const { found, missing } = resolveMembers(names, members, speaker)
    if (missing.length > 0) {
      return fail('not-found', t('「{missing}」不在这个群里。群里有：{members}。要它干活就开任务，或者请用户把它拉进群。', { missing: missing.join(t('、')), members: members.map((bot) => bot.name).join(t('、')) }))
    }
    if (found.length === 0) return fail('invalid-input', t('要 @ 的是群里的其他成员，不能只 @ 自己'))
    const trigger = this.triggers.get(`${room.id}:${speaker.id}`)
    const skipped = found.filter((bot) => bot.id === trigger)
    const targets = found.filter((bot) => bot.id !== trigger)
    if (targets.length === 0) {
      const name = skipped[0]?.name ?? '它'
      return fail('invalid-input', t('{name}刚在群里 @ 了你。你的回复会直接发在群里，{name}和用户都看得到，不用再 @ {name}：直接回复就行，要{name}再做什么也直接写在回复里。', { name }))
    }
    const used = botCallsSinceOwner(listMessages(this.db, room.id, { limit: 60 }))
    if (used + targets.length > BOT_CALL_LIMIT) {
      return fail('conflict', t('用户说完上一句以后，bot 之间已经在群里点名 {used} 次了（上限 {BOT_CALL_LIMIT}）。先把现在的结论回给用户，等用户再开口。', { used, BOT_CALL_LIMIT }))
    }
    const text = stripMentions(message, targets, members)
    if (text === '') return fail('invalid-input', t('要写明想对他们说什么'))
    const body = maskSecrets(`${targets.map((bot) => `@${bot.name}`).join(' ')} ${text}`).text
    const posted = this.post(room.id, { author: speaker.id, kind: 'text', body, sessionId: session.id, data: { calls: targets.map((bot) => bot.id) } })
    if (posted === undefined) return fail('not-found', t('找不到这个群聊'))
    for (const bot of targets) this.triggers.set(`${room.id}:${bot.id}`, speaker.id)
    this.deps.front(posted, targets, '')
    return ok({ called: targets.map((bot) => bot.name), skipped: skipped.map((bot) => bot.name) })
  }

  /**
   * 不经过发言、把你的一条消息再交给前台一次（重新回答、出错后重试）：给了 bot 就交给它，不然按平常的规矩找前台。
   * note 写明为什么又交过来。
   */
  again(room: Room, message: RoomMessage, note: string, bot?: Bot): PodResult<Bot> {
    const targets = bot === undefined ? this.frontsFor(room, message) : [bot]
    const first = targets[0]
    if (first === undefined) return fail('not-found', t('这个房间里没有能回答的 bot'))
    this.deps.front(message, targets, note)
    return ok(first)
  }

  /** 上传的文件：交给前台，说明（文件存在哪、转成的文字版）附在消息上。 */
  deliverUpload(room: Room, message: RoomMessage, note: string): void {
    this.toFronts(room, message, note)
  }

  /** 默认谁来回答：单聊是对面的 bot；群里没点名时是组长，群里只剩 Super-agent 时才是它。 */
  responder(room: Room): Bot | undefined {
    if (room.kind === 'direct') return room.botId === null ? undefined : this.deps.bots.activeBot(room.botId)
    return this.leaderOf(room) ?? this.deps.bots.lead()
  }

  /**
   * 你就某件东西（比如一个页面）说的话：写进对话时带上 data，只交给指定的 bot 的前台，不按 @ 分派。
   * body 是对话里显示的原话，note 是交给前台时附的说明（前台开任务时一起交给干活的 bot）。
   */
  sendAbout(room: Room, bot: Bot, input: { readonly body: string; readonly note: string; readonly data: Readonly<Record<string, unknown>> }): PodResult<RoomMessage> {
    const masked = maskSecrets(input.body)
    const message = this.post(room.id, { author: OWNER, kind: 'text', body: masked.text, data: { ...input.data, ...(masked.kinds.length === 0 ? {} : { masked: masked.kinds }) } })
    if (message === undefined) return fail('not-found', t('找不到这个对话'))
    markRoomRead(this.db, room.id, message.seq)
    this.deps.front(message, [bot], maskSecrets(input.note).text)
    return ok(message)
  }

  /** 房间里这个 bot 当前这一段聊天会话；没有就开一条。同一个房间并发发消息只开一条。 */
  async chatSession(room: Room, bot: Bot): Promise<PodSession> {
    const existing = this.deps.registry.activeForRoom(room.id, bot.id)
    if (existing !== undefined) return existing
    const key = `${room.id}:${bot.id}`
    const inflight = this.opening.get(key)
    if (inflight !== undefined) return inflight
    const opening = this.deps.registry
      .open({
        bot,
        kind: 'chat',
        roomId: room.id,
        taskId: room.taskId,
        folder: room.kind === 'direct' ? botFolder(bot) : roomFolder(room),
        // 群里每个成员各有一条会话，标题带上名字；单聊带上这段对话的第一句话，在 dsh 的会话列表里分得清。
        title: room.kind === 'direct' ? `dsh-bot · ${bot.name} · ${room.topic !== '' ? room.topic : chatSubject(firstOwnerLine(this.db, room.id), 16) || t('新对话')}` : `dsh-bot · ${room.title} · ${bot.name}`,
      })
      .finally(() => this.opening.delete(key))
    this.opening.set(key, opening)
    return opening
  }

  /** bot 在聊天会话里说的话，写进对应房间。 */
  postBotText(session: PodSession, text: string, data?: Readonly<Record<string, unknown>>): RoomMessage | undefined {
    if (session.roomId === null) return undefined
    return this.post(session.roomId, { author: session.botId, kind: 'text', body: maskSecrets(text).text, sessionId: session.id, ...(data === undefined ? {} : { data }) })
  }

  /** 一轮回答跑完：执行过程的摘要记在这一轮最后一段回复上，页面在回复下面显示用时和每一步。 */
  attachRun(messageId: string, run: RunSummary): void {
    const message = getMessage(this.db, messageId)
    if (message === undefined || message.deletedAt !== null) return
    this.patchMessage(messageId, { data: { ...message.data, run } })
  }

  /** 你在 dsh 的会话视图里直接打的字，也补进房间，记录不缺一块。 */
  mirrorOwner(session: PodSession, text: string): void {
    if (session.roomId === null || session.kind !== 'chat') return
    this.post(session.roomId, { author: OWNER, kind: 'text', body: maskSecrets(text).text, data: { via: 'dsh' } })
  }

  markRead(input: unknown): PodResult<null> {
    const roomId = readId(input, 'roomId')
    const seq = readInt(input, 'seq')
    if (roomId === undefined || seq === undefined) return fail('invalid-input', t('要写明房间和读到的位置'))
    markRoomRead(this.db, roomId, seq)
    this.deps.bus.emit({ type: 'rooms' })
    return ok(null)
  }

  update(input: unknown): PodResult<Room> {
    const roomId = readId(input, 'roomId')
    if (roomId === undefined) return fail('invalid-input', t('缺少房间 id'))
    const raw = readObject(input, 'patch')
    // 群详情里换组长：照换组长的规矩，群里留一行。
    const leader = readId(raw, 'leadBotId')
    if (leader !== undefined) {
      const set = this.groups.setLeader(roomId, leader, OWNER)
      if (!set.ok) return set
    }
    const title = readString(raw, 'title')
    const patch: RoomPatch = {
      ...(title === '' ? {} : { title: truncate(title, ROOM_TITLE_MAX) }),
      ...(readBool(raw, 'pinned') === undefined ? {} : { pinned: readBool(raw, 'pinned') }),
      ...(readBool(raw, 'incognito') === undefined ? {} : { incognito: readBool(raw, 'incognito') }),
      ...(readEnum(raw, 'notifyLevel', ['all', 'waits', 'off'] as const) === undefined
        ? {}
        : { notifyLevel: readEnum(raw, 'notifyLevel', ['all', 'waits', 'off'] as const) }),
      ...(readBool(raw, 'archived') === undefined ? {} : { archivedAt: readBool(raw, 'archived') === true ? this.deps.now() : null }),
    }
    const updated = updateRoom(this.db, roomId, patch)
    if (updated === undefined) return fail('not-found', t('找不到这个房间'))
    this.deps.audit.record('room.update', OWNER, roomId, { patch })
    this.deps.bus.emit({ type: 'rooms' })
    this.deps.bus.emit({ type: 'room', roomId })
    return ok(updated)
  }

  /** 这个对话里置顶的消息，按先后。 */
  pins(input: unknown): PodResult<readonly RoomMessage[]> {
    const roomId = readId(input, 'roomId')
    if (roomId === undefined) return fail('invalid-input', t('缺少房间 id'))
    return ok(pinnedMessages(this.db, roomId))
  }

  pin(input: unknown): PodResult<RoomMessage> {
    const messageId = readId(input, 'messageId')
    if (messageId === undefined) return fail('invalid-input', t('缺少消息 id'))
    const pinned = readBool(input, 'pinned') ?? true
    const updated = this.patchMessage(messageId, { pinned })
    return updated === undefined ? fail('not-found', t('找不到这条消息')) : ok(updated)
  }
}

function authorName(message: RoomMessage, bots: BotService): string {
  if (message.author === OWNER) return t('你')
  if (message.author === POD) return 'dsh-bot'
  return bots.get(message.author)?.name ?? 'bot'
}

function previewOf(message: RoomMessage, bots: BotService): string {
  const who = authorName(message, bots)
  if (message.kind === 'task-card') return t('{who}：[任务] {title}', { who, title: String(message.data.title ?? '') })
  if (message.kind === 'wait') return t('等你：{body}', { body: message.body })
  return message.author === POD ? message.body : t('{who}：{body}', { who, body: message.body })
}
