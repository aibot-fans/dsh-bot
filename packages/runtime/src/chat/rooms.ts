import type { DatabaseSync } from 'node:sqlite'
import {
  BOT_CALL_LIMIT,
  LEAD_ALIASES,
  OWNER,
  POD,
  PRIORITY,
  ROOM_TITLE_MAX,
  MESSAGE_MAX,
  autoGroupName,
  botCallsSinceOwner,
  botFolder,
  charLength,
  fail,
  expandQuickCommand,
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
  readStringArray,
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
  removeRoomMember,
  transaction,
  updateMessage,
  updateRoom,
  type MessagePatch,
  type RoomPatch,
} from 'pod-store'
import { ownerSource, relaySource } from '../agents/messages.ts'
import type { Dispatcher } from '../agents/dispatcher.ts'
import type { SessionRegistry } from '../agents/registry.ts'
import type { BotService } from '../bots/service.ts'
import type { Auditor } from '../core/audit.ts'
import type { PodBus } from '../core/bus.ts'
import { groupFrame, recentLines, resolveMembers, stripMentions } from './group.ts'
import { pickResponder, routeRecent, type Route } from './router.ts'

const PAGE = 50

/** 新开的一段对话里，告诉 bot 以前还有哪些对话时最多列几段。 */
const PAST_CHATS_LISTED = 6

/** 新会话第一次收到消息时带上的置顶消息：最多几条、每条留多少字。 */
const PINNED_LISTED = 10
const PINNED_CHARS = 300

/** 对话记录里的标题：你说的第一句话，压成一行截短。 */
export function chatSubject(text: string, max = 24): string {
  return truncate(oneLine(text).replace(/^\/\S+\s*/, ''), max)
}

function dateLabel(time: number): string {
  const date = new Date(time)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

/** 你的话还没交到 bot 手上时，页面上那一行“正在……”在哪个房间、是谁（还在挑人时为空串）、在做什么。 */
export interface PreparingState {
  readonly roomId: string
  readonly botId: string
  readonly label: string
}

interface DeliverOptions {
  readonly mentioned?: boolean
  /** 用户没点名，按分工挑了它来接。 */
  readonly routed?: boolean
  readonly messageId?: string | undefined
  readonly from?: { readonly bot: Bot; readonly sessionId: string }
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
  /** 房间里还开着的等你事项数。 */
  readonly openWaits: (roomId: string) => number
  /** 任务记录里你说的话交给主管时附上的进度快照。 */
  readonly snapshotFor: (room: Room) => string | undefined
  /** 投递给 bot 前补充的上下文（相关记忆等）。 */
  readonly enrich: (session: PodSession, text: string) => Promise<string>
  /** 上下文太长或空闲太久时换段；不需要换段返回 undefined。真要换段时先调 starting。 */
  readonly rotate: (room: Room, bot: Bot, session: PodSession, starting: () => void) => Promise<{ readonly session: PodSession; readonly preface: string } | undefined>
  /** 消息写入或更新后进搜索索引。 */
  readonly indexed: (message: RoomMessage) => void
  /** 正式团队的任务记录交给组长回答。 */
  readonly leaderFor: (room: Room) => Bot | undefined
  /** 你在房间里说了话（自我优化据此认出“以后别这样”之类的纠正）。 */
  readonly onOwnerText?: (message: RoomMessage) => void
  /** 停掉一条会话正在跑的这一轮（停止回复、清空记录、开新对话时用）。 */
  readonly stopSession: (sessionId: string) => void
  /** 临时对话删掉时，把 dsh 里对应的会话也归档，dsh 的会话列表里就不再出现。 */
  readonly hideSession?: (sessionId: string) => void
  /** 普通群聊里没点名的话按分工挑人（轻量模型）；没有时按默认的人来接。 */
  readonly route?: Route
  /**
   * 你的话还没交到 bot 手上时（按分工挑人、开会话、换段）页面先显示一行“正在……”，不用干等；state 为 null 时收掉。
   * 交过去以后等 bot 这一轮真开始了才收（Pod 看到它在跑时收），中间不会空一下。
   */
  readonly preparing?: (key: string, state: PreparingState | null) => void
}

/**
 * 房间和消息：单聊里你的话直接交给这个 bot 的聊天会话；普通群聊里没点名的话按分工交给对口的成员，
 * 任务群和团队群交给组长。bot 在会话里说的话由观察者交回来写进房间。房间记录是唯一的事实来源。
 */
export class RoomService {
  private readonly opening = new Map<string, Promise<PodSession>>()
  /** 每个房间正在投递的那一串：按分工挑人要等一会儿，后说的话不能抢到前面去。 */
  private readonly order = new Map<string, Promise<void>>()
  /** 每条群聊会话最近一次是谁叫起来的：用户（OWNER）或 @ 了它的 bot。用来拦住“被 @ 了又 @ 回去”。 */
  private readonly triggers = new Map<string, string>()
  /** 已经告诉过“以前还有哪些对话”的会话：每条会话只在第一条消息前说一次。 */
  private readonly introduced = new Set<string>()
  private readonly deps: RoomServiceDeps

  constructor(deps: RoomServiceDeps) {
    this.deps = deps
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

  private createDirect(bot: Bot, options: { readonly topic: string; readonly pinned: boolean; readonly incognito: boolean }): Room {
    const now = this.deps.now()
    const room = transaction(this.db, () => {
      const created = insertRoom(this.db, {
        id: newId('room'),
        kind: 'direct',
        title: options.topic === '' ? bot.name : truncate(options.topic, ROOM_TITLE_MAX),
        botId: bot.id,
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

  /** 拉群：建一个不挂任务的群聊。同名的群还在就直接用它，把没进群的成员补进去。主管总在群里。 */
  createGroup(input: { readonly name: string; readonly memberIds: readonly string[]; readonly max?: number }, actor: string): PodResult<Room> {
    const name = truncate(input.name.replace(/\s+/g, ' ').trim(), input.max ?? ROOM_TITLE_MAX)
    if (name === '') return fail('invalid-input', t('群要有名字'))
    const lead = this.deps.bots.lead()
    const members = [...new Set([lead.id, ...input.memberIds])].filter((id) => this.deps.bots.activeBot(id) !== undefined)
    if (members.length < 2) return fail('invalid-input', t('至少拉一个 bot 进群'))
    const now = this.deps.now()
    const existing = listRooms(this.db, { archived: false }).find((room) => room.kind === 'task' && room.taskId === null && room.title === name)
    if (existing !== undefined) {
      for (const botId of members) addRoomMember(this.db, existing.id, botId, now)
      this.deps.bus.emit({ type: 'room', roomId: existing.id })
      return ok(existing)
    }
    const room = transaction(this.db, () => {
      const created = insertRoom(this.db, { id: newId('room'), kind: 'task', title: name, now })
      for (const botId of members) addRoomMember(this.db, created.id, botId, now)
      return created
    })
    this.deps.audit.record('room.group', actor, room.id, { name, members })
    this.deps.bus.emit({ type: 'rooms' })
    return ok(room)
  }

  /** 页面上的新建群聊：{ name, memberIds }；没起名字时按成员起一个。 */
  createGroupFromPage(input: unknown): PodResult<Room> {
    const memberIds = readStringArray(input, 'memberIds') ?? []
    const named = readString(input, 'name').trim()
    const names = memberIds.flatMap((id) => {
      const bot = this.deps.bots.activeBot(id)
      return bot === undefined || bot.role === 'lead' ? [] : [bot.name]
    })
    return this.createGroup({ name: named === '' ? autoGroupName(names) : named, memberIds }, OWNER)
  }

  private groupAndBot(input: unknown): PodResult<{ readonly room: Room; readonly bot: Bot }> {
    const roomId = readId(input, 'roomId')
    const botId = readId(input, 'botId')
    const room = roomId === undefined ? undefined : this.get(roomId)
    if (room === undefined || room.archivedAt !== null) return fail('not-found', t('找不到这个群聊'))
    if (room.kind === 'direct') return fail('invalid-input', t('单聊不能加减成员'))
    const bot = botId === undefined ? undefined : this.deps.bots.activeBot(botId)
    if (bot === undefined) return fail('not-found', t('找不到这个 bot'))
    return ok({ room, bot })
  }

  /** 群聊加人。 */
  addMemberFromPage(input: unknown): PodResult<null> {
    const found = this.groupAndBot(input)
    if (!found.ok) return found
    this.addMember(found.value.room.id, found.value.bot.id)
    this.deps.audit.record('room.member.add', OWNER, found.value.room.id, { botId: found.value.bot.id })
    this.milestone(found.value.room.id, t('{name} 进群了', { name: found.value.bot.name }), { botId: found.value.bot.id })
    return ok(null)
  }

  /** 群聊移出成员：它在这个群里的聊天会话一起结束。主管不能移出。 */
  removeMemberFromPage(input: unknown): PodResult<null> {
    const found = this.groupAndBot(input)
    if (!found.ok) return found
    const { room, bot } = found.value
    if (bot.role === 'lead') return fail('lead-protected', t('主管要留在群里，负责分派和组织'))
    removeRoomMember(this.db, room.id, bot.id)
    const session = this.deps.registry.activeForRoom(room.id, bot.id)
    if (session !== undefined) {
      this.deps.stopSession(session.id)
      this.deps.registry.retire(session.id)
    }
    this.deps.audit.record('room.member.remove', OWNER, room.id, { botId: bot.id })
    this.milestone(room.id, t('{name} 移出了群聊', { name: bot.name }), { botId: bot.id })
    this.deps.bus.emit({ type: 'room', roomId: room.id })
    return ok(null)
  }

  private chatsIn(roomId: string): readonly PodSession[] {
    return this.deps.registry.active().filter((session) => session.roomId === roomId && session.kind === 'chat')
  }

  private room(input: unknown): PodResult<Room> {
    const roomId = readId(input, 'roomId')
    const room = roomId === undefined ? undefined : this.get(roomId)
    return room === undefined || room.archivedAt !== null ? fail('not-found', t('找不到这个对话')) : ok(room)
  }

  /** 停止回复：停掉这个房间里正在回答的 bot。任务不受影响，任务用任务卡上的“停止”。 */
  stop(input: unknown): PodResult<{ readonly stopped: number }> {
    const found = this.room(input)
    if (!found.ok) return found
    const running = this.chatsIn(found.value.id).filter((session) => this.deps.dispatcher.isRunning(session.id))
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
    return ok(
      rooms.map((room) => {
        const message = last.get(room.id)
        return {
          ...room,
          unread: Math.max(0, room.lastSeq - room.readSeq),
          preview: message === undefined ? '' : truncate(oneLine(previewOf(message, this.deps.bots)), 60),
          busy: this.deps.busy(room),
          waits: this.deps.openWaits(room.id),
          memberIds: listRoomMembers(this.db, room.id).map((member) => member.botId),
          subject: room.kind === 'direct' ? chatSubject(subjects.get(room.id) ?? '') : '',
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
      readonly author: string
      readonly kind: MessageKind
      readonly body: string
      readonly data?: Readonly<Record<string, unknown>>
      readonly sessionId?: string | null
      readonly replyTo?: string | null
    },
  ): RoomMessage | undefined {
    if (this.get(roomId) === undefined) return undefined
    const posted = transaction(this.db, () =>
      appendMessage(this.db, {
        id: newId('msg'),
        roomId,
        author: message.author,
        kind: message.kind,
        body: message.body,
        ...(message.data === undefined ? {} : { data: message.data }),
        ...(message.sessionId === undefined ? {} : { sessionId: message.sessionId }),
        ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
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

  /** 你在房间里说话：先打码再存，然后交给负责回答的 bot；普通群聊里没点名的话按分工挑人，不等挑完就回页面。 */
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
    const quoted = replyTo === null ? undefined : getMessage(this.db, replyTo)
    const mentioned = room.kind === 'direct' ? [] : this.mentioned(room, masked.text)
    const responder = mentioned[0] ?? this.responder(room)
    if (responder === undefined) return fail('not-found', t('这个房间里没有能回答的 bot'))
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
    // 快捷指令（/任务、/总结……）：房间里留你的原话，交给 bot 的是展开后的说明。
    const text = expandQuickCommand(masked.text) ?? masked.text
    if (mentioned.length === 0 && this.routes(room)) {
      this.routing(room.id, message.id)
      void this.inOrder(room.id, () => this.deliverRouted(room, text, masked.text, quoted, message.id).then(() => undefined))
      return ok(message)
    }
    // 不等交到 bot 手上就返回：开会话、换段可能要十几秒，输入框不该一直卡着；交不出去时房间里会留一行说明。
    void this.inOrder(room.id, async () => {
      for (const bot of mentioned.length > 0 ? mentioned : [responder]) {
        try {
          await this.deliver(room, bot, text, quoted, { mentioned: mentioned.length > 0, messageId: message.id })
        } catch (error) {
          this.milestone(roomId, t('没能把消息交给{name}：{value}', { name: bot.name, value: error instanceof Error ? error.message : String(error) }))
        }
      }
    })
    return ok(message)
  }

  /** 普通群聊（不挂任务、不是正式团队）里没点名的话按分工挑人；任务群和团队群由组长接。 */
  private routes(room: Room): boolean {
    return room.kind !== 'direct' && room.taskId === null && room.teamId === null
  }

  /** 按分工挑人要等轻量模型回话（几秒）：先在页面上显示“正在找合适的成员来接”，挑完收掉。 */
  private routing(roomId: string, messageId: string, on = true): void {
    this.deps.preparing?.(`route:${messageId}`, on ? { roomId, botId: '', label: t('找合适的成员来接') } : null)
  }

  /** 同一个房间里交给 bot 的话按先后投递。 */
  private inOrder(roomId: string, work: () => Promise<void>): Promise<void> {
    const next = (this.order.get(roomId) ?? Promise.resolve()).then(work).catch((error: unknown) => {
      this.milestone(roomId, t('没能把消息交给 bot：{value}', { value: error instanceof Error ? error.message : String(error) }))
    })
    this.order.set(roomId, next)
    void next.finally(() => {
      if (this.order.get(roomId) === next) this.order.delete(roomId)
    })
    return next
  }

  /** 按分工挑人，把这句话交给它（routing 是给分派器看的那句话）；挑中成员时告诉它这件事归它来接。 */
  private async deliverRouted(room: Room, text: string, routing: string, quoted: RoomMessage | undefined, messageId: string | undefined): Promise<Bot> {
    const lead = this.deps.bots.lead()
    const bot = await pickResponder({
      roomTitle: room.title,
      lead,
      members: this.memberBots(room).filter((member) => member.id !== lead.id),
      recent: routeRecent(this.recentInGroup(room, 20), (author) => this.speakerName(author), messageId),
      text: routing,
      quoted,
      route: this.deps.route,
    }).finally(() => {
      if (messageId !== undefined) this.routing(room.id, messageId, false)
    })
    try {
      await this.deliver(room, bot, text, quoted, { messageId, routed: bot.id !== lead.id })
    } catch (error) {
      this.milestone(room.id, t('没能把消息交给{name}：{value}', { name: bot.name, value: error instanceof Error ? error.message : String(error) }))
    }
    return bot
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
   * bot 在群里 @ 别的成员（mention_member）：以它的名义在群里发一条带 @ 的消息，
   * 被 @ 的成员各自收到（附最近的群聊）并在群里回答。用户说一句话以后 bot 之间最多点名 BOT_CALL_LIMIT 次。
   * 刚 @ 了它的 bot 不再点回去（它的回复本来就发在群里，对方看得到），免得一来一回刷屏。
   */
  async mentionFromBot(
    session: PodSession,
    names: readonly string[],
    message: string,
  ): Promise<PodResult<{ readonly called: readonly string[]; readonly skipped: readonly string[] }>> {
    const room = session.roomId === null ? undefined : this.get(session.roomId)
    if (room === undefined || room.archivedAt !== null || room.kind === 'direct') return fail('invalid-input', t('只有在群聊里才能 @ 成员'))
    const speaker = this.deps.bots.activeBot(session.botId)
    if (speaker === undefined) return fail('not-found', t('找不到你自己'))
    const members = this.memberBots(room)
    const { found, missing } = resolveMembers(names, members, speaker)
    if (missing.length > 0) {
      return fail('not-found', t('「{missing}」不在这个群里。群里有：{members}。要问群外的 bot 用 ask_bot，或者请用户把它拉进群。', { missing: missing.join(t('、')), members: members.map((bot) => bot.name).join(t('、')) }))
    }
    if (found.length === 0) return fail('invalid-input', t('要 @ 的是群里的其他成员，不能只 @ 自己'))
    const trigger = this.triggers.get(session.id)
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
    for (const bot of targets) {
      try {
        await this.deliver(room, bot, text, undefined, { mentioned: true, messageId: posted?.id, from: { bot: speaker, sessionId: session.id } })
      } catch (error) {
        this.milestone(room.id, t('没能把{name}的消息交给{name2}：{value}', { name: speaker.name, name2: bot.name, value: error instanceof Error ? error.message : String(error) }))
      }
    }
    return ok({ called: targets.map((bot) => bot.name), skipped: skipped.map((bot) => bot.name) })
  }

  /** 转给 bot 看的说话人：你叫“用户”，其余用名字。 */
  private speakerName(author: string): string {
    if (author === OWNER) return '用户'
    if (author === POD) return 'dsh-bot'
    return this.deps.bots.get(author)?.name ?? 'bot'
  }

  /** 不经过发言、直接交给 bot 一段说明（重新回答用）：给了 bot 就交给它（群里算点名它），不然交给房间里默认回答的 bot。 */
  async deliverText(room: Room, text: string, bot?: Bot): Promise<PodResult<Bot>> {
    const target = bot ?? this.responder(room)
    if (target === undefined) return fail('not-found', t('这个房间里没有能回答的 bot'))
    await this.deliver(room, target, text, undefined, { mentioned: bot !== undefined })
    return ok(target)
  }

  /** 上传的文件交给该接的 bot：普通群聊按分工挑人（按你写的话或文件名挑，不等挑完），其他房间交给默认回答的 bot。 */
  async deliverUpload(room: Room, text: string, routing: string, messageId: string): Promise<void> {
    if (this.routes(room)) {
      this.routing(room.id, messageId)
      void this.inOrder(room.id, () => this.deliverRouted(room, text, routing, undefined, messageId).then(() => undefined))
      return
    }
    await this.deliverText(room, text)
  }

  /** 默认谁来回答：单聊是对面的 bot；任务群和团队群里没点名时是组长（正式团队）或主管。普通群聊里没点名的话按分工挑人，见 deliverRouted。 */
  responder(room: Room): Bot | undefined {
    if (room.kind === 'direct') return room.botId === null ? undefined : this.deps.bots.activeBot(room.botId)
    return this.deps.leaderFor(room) ?? this.deps.bots.lead()
  }

  /**
   * 把一句话交给房间里某个 bot 的聊天会话。群聊里写明是谁说的、有没有 @ 它，附上它还没看到的最近几条群消息和现在的成员。
   * from 是另一个 bot（在群里 @ 了它）时，按 bot 之间的消息投递：优先级低于你说的话，也不算你的指令。
   */
  private async deliver(
    room: Room,
    bot: Bot,
    text: string,
    quoted: RoomMessage | undefined,
    options: DeliverOptions = {},
  ): Promise<string> {
    const key = `pending:${room.id}:${bot.id}`
    const show = (label: string): void => this.deps.preparing?.(key, { roomId: room.id, botId: bot.id, label })
    const known = this.deps.registry.activeForRoom(room.id, bot.id)
    // 它正在回答时这句话插进当前这一轮，页面上本来就有它的“正在……”。
    if (known === undefined || !this.deps.dispatcher.isRunning(known.id)) show(t('接收消息'))
    try {
      return await this.handOver(room, bot, text, quoted, options, () => show(t('整理之前的对话')))
    } catch (error) {
      this.deps.preparing?.(key, null)
      throw error
    }
  }

  /** deliver 的正文：找到（或开、或换段）会话，写好给它的话，交给派发器。rotating 在真要换段时调用。 */
  private async handOver(
    room: Room,
    bot: Bot,
    text: string,
    quoted: RoomMessage | undefined,
    options: DeliverOptions,
    rotating: () => void,
  ): Promise<string> {
    const current = await this.chatSession(room, bot)
    const rotated = this.deps.dispatcher.isRunning(current.id) ? undefined : await this.deps.rotate(room, bot, current, rotating)
    const session = rotated?.session ?? current
    const quote = quoted === undefined ? '' : `> 引用${authorName(quoted, this.deps.bots)}：${truncate(oneLine(quoted.body), 200)}\n\n`
    const framed =
      room.kind === 'direct'
        ? `${quote}${text}`
        : groupFrame({
            roomTitle: room.title,
            speaker: options.from?.bot.name ?? '用户',
            mentioned: options.mentioned === true,
            fromBot: options.from !== undefined,
            routed: options.routed === true,
            body: `${quote}${text}`,
            recent: recentLines(this.recentInGroup(room, 30), bot, (author) => this.speakerName(author), options.messageId),
            members: this.memberBots(room).map((member) => member.name),
            snapshot: this.deps.snapshotFor(room),
          })
    if (room.kind !== 'direct') this.triggers.set(session.id, options.from?.bot.id ?? OWNER)
    const mode = this.deps.dispatcher.isRunning(session.id) ? 'steer' : 'followup'
    const past = rotated !== undefined ? '' : this.firstNote(room, bot, session)
    const enriched = `${past}${await this.deps.enrich(session, framed)}`
    const lead = options.from === undefined ? '[用户的新消息]' : `[${options.from.bot.name}的新消息]`
    const delivery = this.deps.dispatcher.enqueue({
      sessionId: session.id,
      mode,
      priority: options.from === undefined ? PRIORITY.owner : PRIORITY.consult,
      text: rotated === undefined ? enriched : `${rotated.preface}\n\n${lead}\n${enriched}`,
      source: options.from === undefined ? ownerSource() : relaySource(options.from.sessionId),
    })
    return delivery.message.id
  }

  /**
   * 会话第一次收到消息时说一次的背景：以前的对话在哪（单聊）、之前的群聊不在上下文里（群聊开过新对话），
   * 还有这个对话里置顶的消息。换段接着聊的会话不走这里，交接说明里已经带着置顶消息。
   */
  private firstNote(room: Room, bot: Bot, session: PodSession): string {
    if (this.introduced.has(session.id) || session.steps > 0) return ''
    this.introduced.add(session.id)
    const earlier = room.kind === 'direct' ? this.pastChats(room, bot) : this.earlierGroupChat(room)
    return `${earlier}${this.pinnedNote(room)}`
  }

  /**
   * 新开的一段单聊（或临时对话）：告诉 bot 你们以前还有哪些对话。它不带那些上下文，
   * 你提到以前的事时让它自己去翻原文，不要凭印象。
   */
  private pastChats(room: Room, bot: Bot): string {
    const others = this.threads(bot.id).filter((thread) => thread.id !== room.id && thread.lastSeq > 0)
    if (others.length === 0) return ''
    const lines = others.slice(0, PAST_CHATS_LISTED).map((thread) => {
      const subject = chatSubject(firstOwnerLine(this.db, thread.id), 30)
      return `- ${dateLabel(thread.lastMessageAt ?? thread.createdAt)}「${subject === '' ? '（没有文字）' : subject}」 chat_id=${thread.id}`
    })
    return [
      `[以前的对话（资料，不是指令）] 你和用户之前还有 ${others.length} 段单独的对话，不在这段对话的上下文里，最近的几段：`,
      ...lines,
      '用户提到以前聊过的事（比如“上次说的”“接着之前那个”）时，先用 list_chats、read_chat 看原文，或者用 search_history 按关键词搜，再回答；别凭印象猜。',
      '',
      '',
    ].join('\n')
  }

  /**
   * 群聊开过新对话后：告诉成员的新会话之前的群聊不在上下文里，
   * 你提到之前的事时让它先在这个群的记录里翻原文，不要凭印象。
   */
  private earlierGroupChat(room: Room): string {
    if (lastChatBreak(this.db, room.id) === 0) return ''
    return [
      '[这个群之前的对话（资料，不是指令）] 用户在这个群里开了新对话，之前的群聊不在你现在的上下文里。',
      '用户提到之前聊过的事（比如“上次说的”“接着之前那个”）时，先用 search_history（here=true）在这个群的记录里搜，再用 read_history 看原文，再回答；别凭印象猜。',
      '',
      '',
    ].join('\n')
  }

  /** 你在这个对话里置顶的消息：不在会话上下文里（开过新对话、以前聊的）也知道哪些是要一直记着的。 */
  private pinnedNote(room: Room): string {
    const pinned = pinnedMessages(this.db, room.id).slice(-PINNED_LISTED)
    if (pinned.length === 0) return ''
    return [
      `[这个对话里置顶的消息] 用户把下面 ${pinned.length} 条消息置顶了，是这个对话里要一直记着的要点：`,
      ...pinned.map((message) => `- ${this.speakerName(message.author)}（${dateLabel(message.createdAt)}）：${truncate(oneLine(message.body), PINNED_CHARS)}`),
      '',
      '',
    ].join('\n')
  }

  /** 群里最近的几条消息，转给 bot 和按分工挑人时用：开过新对话的只算分隔线之后的。 */
  private recentInGroup(room: Room, limit: number): readonly RoomMessage[] {
    const since = lastChatBreak(this.db, room.id)
    return listMessages(this.db, room.id, { limit }).filter((message) => message.seq > since)
  }

  /**
   * 你就某件东西（比如一个页面）说的话：写进对话时带上 data，只交给指定的 bot，不按 @ 分派。
   * body 是对话里显示的原话，text 是交给 bot 的说明；返回这条消息和投进会话的消息 id（观察会话时据此认出 bot 是在回这件事）。
   */
  async sendAbout(
    room: Room,
    bot: Bot,
    input: { readonly body: string; readonly text: string; readonly data: Readonly<Record<string, unknown>> },
  ): Promise<PodResult<{ readonly message: RoomMessage; readonly deliveryId: string }>> {
    const masked = maskSecrets(input.body)
    const message = this.post(room.id, { author: OWNER, kind: 'text', body: masked.text, data: { ...input.data, ...(masked.kinds.length === 0 ? {} : { masked: masked.kinds }) } })
    if (message === undefined) return fail('not-found', t('找不到这个对话'))
    markRoomRead(this.db, room.id, message.seq)
    const deliveryId = await this.deliver(room, bot, maskSecrets(input.text).text, undefined, { messageId: message.id })
    return ok({ message, deliveryId })
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
