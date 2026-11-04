import type { DatabaseSync } from 'node:sqlite'
import { GROUP_TOPIC_MAX, OWNER, POD, ROOM_TITLE_MAX, autoGroupName, fail, newId, ok, oneLine, readId, readString, readStringArray, t, truncate, type Bot, type PodResult, type Room } from 'pod-domain'
import { addRoomMember, insertRoom, listMessages, listRooms, removeRoomMember, textCountsByAuthor, transaction, updateRoom } from 'pod-store'
import type { SessionRegistry } from '../agents/registry.ts'
import type { BotService } from '../bots/service.ts'
import type { Auditor } from '../core/audit.ts'
import type { PodBus } from '../core/bus.ts'
import type { RoomService } from './rooms.ts'

export interface GroupServiceDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly bots: BotService
  readonly registry: SessionRegistry
  readonly audit: Auditor
  readonly now: () => number
  /** 停掉一条会话正在跑的这一轮（移出成员时用）。 */
  readonly stopSession: (sessionId: string) => void
  /** 群也是房间：读房间、成员、组长和发消息都经 RoomService。 */
  readonly rooms: RoomService
}

/**
 * 群：建群、加人移人和组长。组长是群里没点名的话先接的 bot：普通群建群时定、群详情里能换，
 * 任务群是负责的 bot，正式团队是团队组长。主管总在群里，但不当组长，只在被点名时说话。
 */
export class GroupService {
  private readonly deps: GroupServiceDeps

  constructor(deps: GroupServiceDeps) {
    this.deps = deps
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  /** 普通群（你或 Super-agent 拉的、不挂任务的群聊），最近说过话的在前。 */
  list(): readonly Room[] {
    return listRooms(this.db, { archived: false }).filter((room) => room.kind !== 'direct' && room.taskId === null && room.teamId === null)
  }

  /**
   * 拉群：建一个不挂任务的群聊，定一个组长（没点名的话先给它；没写就是排在最前的成员），群里留一行“没点名的话 X 先接”。
   * topic 是这个群管什么，Super-agent 交活时按它找对口的群。
   * 同名的群还在就直接用它：把没进群的成员补进去，写了管什么就换成新写的，写了组长就换成它。主管总在群里，但不当组长，只在被点名时说话。
   */
  create(input: { readonly name: string; readonly memberIds: readonly string[]; readonly leaderId?: string; readonly topic?: string; readonly max?: number }, actor: string): PodResult<Room> {
    const name = truncate(input.name.replace(/\s+/g, ' ').trim(), input.max ?? ROOM_TITLE_MAX)
    if (name === '') return fail('invalid-input', t('群要有名字'))
    const topic = topicText(input.topic ?? '')
    const lead = this.deps.bots.lead()
    const members = [...new Set([lead.id, ...input.memberIds])].filter((id) => this.deps.bots.activeBot(id) !== undefined)
    const now = this.deps.now()
    const existing = listRooms(this.db, { archived: false }).find((room) => room.kind === 'task' && room.taskId === null && room.title === name)
    if (existing !== undefined) {
      for (const botId of members) addRoomMember(this.db, existing.id, botId, now)
      if (topic !== '' && topic !== existing.topic) this.setTopic(existing.id, topic, actor)
      this.deps.bus.emit({ type: 'room', roomId: existing.id })
      if (input.leaderId === undefined || input.leaderId === this.deps.rooms.leaderOf(existing)?.id) return ok(this.deps.rooms.get(existing.id) ?? existing)
      return this.setLeader(existing.id, input.leaderId, actor)
    }
    if (members.length < 2) return fail('invalid-input', t('至少拉一个 bot 进群'))
    const leaderId = input.leaderId ?? members.find((id) => id !== lead.id)
    const leader = leaderId === undefined || !members.includes(leaderId) ? undefined : this.deps.bots.activeBot(leaderId)
    if (leader === undefined) return fail('invalid-input', t('组长要是群里的成员'))
    if (leader.role === 'lead') return fail('invalid-input', t('{name}在群里只在被点名时说话，不当组长', { name: leader.name }))
    const room = transaction(this.db, () => {
      const created = insertRoom(this.db, { id: newId('room'), kind: 'task', title: name, leadBotId: leader.id, topic, now })
      for (const botId of members) addRoomMember(this.db, created.id, botId, now)
      return created
    })
    this.deps.audit.record('room.group', actor, room.id, { name, members, leader: leader.id, topic })
    this.announce(room.id, leader, false)
    this.deps.bus.emit({ type: 'rooms' })
    return ok(room)
  }

  /** 页面上的新建群聊：{ name, memberIds, leaderId?, topic? }；没起名字时按成员起一个，没写组长就是第一个成员。 */
  createFromPage(input: unknown): PodResult<Room> {
    const memberIds = readStringArray(input, 'memberIds') ?? []
    const leaderId = readId(input, 'leaderId')
    const named = readString(input, 'name').trim()
    const names = memberIds.flatMap((id) => {
      const bot = this.deps.bots.activeBot(id)
      return bot === undefined || bot.role === 'lead' ? [] : [bot.name]
    })
    return this.create({ name: named === '' ? autoGroupName(names) : named, memberIds, topic: readString(input, 'topic'), ...(leaderId === undefined ? {} : { leaderId }) }, OWNER)
  }

  /** 改群管什么：只有普通群有，可以清空。 */
  setTopic(roomId: string, topic: string, actor: string): PodResult<Room> {
    const room = this.deps.rooms.get(roomId)
    if (room === undefined || room.archivedAt !== null || room.kind === 'direct') return fail('not-found', t('找不到这个群聊'))
    if (room.taskId !== null || room.teamId !== null) return fail('invalid-input', t('任务群和正式团队不写管什么'))
    const text = topicText(topic)
    if (text === room.topic) return ok(room)
    const updated = updateRoom(this.db, room.id, { topic: text }) ?? room
    this.deps.audit.record('room.topic', actor, room.id, { topic: text })
    this.deps.bus.emit({ type: 'rooms' })
    this.deps.bus.emit({ type: 'room', roomId: room.id })
    return ok(updated)
  }

  /** 换组长：要是群里 Super-agent 以外的成员；群里留一行“没点名的话 X 先接”。任务群、正式团队不另设组长。 */
  setLeader(roomId: string, botId: string, actor: string): PodResult<Room> {
    const room = this.deps.rooms.get(roomId)
    if (room === undefined || room.archivedAt !== null || room.kind === 'direct') return fail('not-found', t('找不到这个群聊'))
    if (room.taskId !== null || room.teamId !== null) return fail('invalid-input', t('任务群由负责的 bot 先接，正式团队由团队组长先接，不另设组长'))
    const bot = this.deps.rooms.memberBots(room).find((member) => member.id === botId)
    if (bot === undefined) return fail('invalid-input', t('组长要是群里的成员'))
    if (bot.role === 'lead') return fail('invalid-input', t('{name}在群里只在被点名时说话，不当组长', { name: bot.name }))
    if (room.leadBotId === bot.id) return ok(room)
    const updated = updateRoom(this.db, room.id, { leadBotId: bot.id }) ?? room
    this.deps.audit.record('room.leader', actor, room.id, { botId: bot.id })
    this.announce(room.id, bot, true)
    this.deps.bus.emit({ type: 'room', roomId: room.id })
    return ok(updated)
  }

  /** 群聊加人。 */
  addFromPage(input: unknown): PodResult<null> {
    const found = this.groupAndBot(input)
    if (!found.ok) return found
    this.deps.rooms.addMember(found.value.room.id, found.value.bot.id)
    this.deps.audit.record('room.member.add', OWNER, found.value.room.id, { botId: found.value.bot.id })
    this.deps.rooms.milestone(found.value.room.id, t('{name} 进群了', { name: found.value.bot.name }), { botId: found.value.bot.id })
    return ok(null)
  }

  /** 群聊移出成员：它在这个群里的聊天会话一起结束。主管不能移出。 */
  removeFromPage(input: unknown): PodResult<null> {
    const found = this.groupAndBot(input)
    if (!found.ok) return found
    const { room, bot } = found.value
    if (bot.role === 'lead') return fail('lead-protected', t('{name}要留在群里：点它的名，就能叫它拉人、建 bot、换组长', { name: bot.name }))
    removeRoomMember(this.db, room.id, bot.id)
    // 移走的是组长：换成排在最前的成员。
    const next = room.leadBotId === bot.id ? this.deps.rooms.memberBots(room).find((member) => member.role !== 'lead') : undefined
    if (room.leadBotId === bot.id) updateRoom(this.db, room.id, { leadBotId: next?.id ?? null })
    const session = this.deps.registry.activeForRoom(room.id, bot.id)
    if (session !== undefined) {
      this.deps.stopSession(session.id)
      this.deps.registry.retire(session.id)
    }
    this.deps.audit.record('room.member.remove', OWNER, room.id, { botId: bot.id })
    this.deps.rooms.milestone(room.id, t('{name} 移出了群聊', { name: bot.name }), { botId: bot.id })
    if (next !== undefined) this.announce(room.id, next, true)
    this.deps.bus.emit({ type: 'room', roomId: room.id })
    return ok(null)
  }

  private groupAndBot(input: unknown): PodResult<{ readonly room: Room; readonly bot: Bot }> {
    const roomId = readId(input, 'roomId')
    const botId = readId(input, 'botId')
    const room = roomId === undefined ? undefined : this.deps.rooms.get(roomId)
    if (room === undefined || room.archivedAt !== null) return fail('not-found', t('找不到这个群聊'))
    if (room.kind === 'direct') return fail('invalid-input', t('单聊不能加减成员'))
    const bot = botId === undefined ? undefined : this.deps.bots.activeBot(botId)
    if (bot === undefined) return fail('not-found', t('找不到这个 bot'))
    return ok({ room, bot })
  }

  /**
   * 以前建的群补组长（库 17 版之前的群都没有）：名字对得上群名的成员，其次群里说话最多的，再其次最早进群的；
   * 每个群留一行“没点名的话 X 先接”。启动时跑，补过的不再动；在群详情里随时能换。
   */
  assignLeaders(): void {
    const missing = this.list().filter((room) => room.leadBotId === null)
    for (const room of missing) {
      const leader = pickLeader(room, this.deps.rooms.memberBots(room).filter((bot) => bot.role !== 'lead'), textCountsByAuthor(this.db, room.id))
      if (leader === undefined) continue
      updateRoom(this.db, room.id, { leadBotId: leader.id })
      this.deps.audit.record('room.leader', POD, room.id, { botId: leader.id })
      this.announce(room.id, leader, false)
    }
    if (missing.length > 0) this.deps.bus.emit({ type: 'rooms' })
  }

  /**
   * 群里一行“没点名的话 X 先接”：用提示而不是里程碑，群里看得见（里程碑只在任务页里）。
   * 群里最后一条就是这一行（比如连着换了几次）时原地改它，不叠一串；原来写的是“X 是组长”的照旧这么写。
   */
  private announce(roomId: string, bot: Bot, changed: boolean): void {
    const last = listMessages(this.db, roomId, { limit: 1 }).at(-1)
    const line = last !== undefined && last.author === POD && last.kind === 'notice' && last.data.leader === true ? last : undefined
    const first = line === undefined ? !changed : line.data.changed !== true
    const body = first ? t('{name} 是组长：没点名的话{name}先接', { name: bot.name }) : t('组长换成了{name}：没点名的话{name}先接', { name: bot.name })
    const data = { botId: bot.id, leader: true, changed: !first }
    if (line === undefined) this.deps.rooms.post(roomId, { author: POD, kind: 'notice', body, data })
    else this.deps.rooms.patchMessage(line.id, { body, data })
  }
}

/** 群管什么：一行，最多 GROUP_TOPIC_MAX 个字。 */
function topicText(text: string): string {
  return truncate(oneLine(text).trim(), GROUP_TOPIC_MAX)
}

/** 以前的群挑组长：名字对得上群名的成员，其次群里说话最多的，再其次最早进群的（members 按进群先后排）。 */
function pickLeader(room: Room, members: readonly Bot[], spoken: ReadonlyMap<string, number>): Bot | undefined {
  const named = members.find((bot) => room.title.includes(bot.name) || bot.name.includes(room.title))
  // 排序是稳定的：说话一样多的还按进群先后。
  return named ?? [...members].sort((left, right) => (spoken.get(right.id) ?? 0) - (spoken.get(left.id) ?? 0))[0]
}
