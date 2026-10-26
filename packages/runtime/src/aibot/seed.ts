import type { DatabaseSync } from 'node:sqlite'
import { POD, type Bot, type BotDraft, type Room } from 'pod-domain'
import { readState, writeState } from 'pod-store'
import type { BotService } from '../bots/service.ts'
import type { RoomService } from '../chat/rooms.ts'

/** 默认的 X bot 和「X 监控」群聊：只在第一次建；你删掉了就不再自己建 bot。 */
const SEED_KEY = 'aibot.seed'
export const X_ROOM_TITLE = 'X 监控'

interface SeedRecord {
  readonly done: boolean
  readonly botId: string
  readonly roomId: string
}

/** X 情报员的人设，中间那行讲写操作。 */
function xPersona(writeLine: string): string {
  return [
    '你是 X 情报员，负责 X（推特）上的数据查询和账号监控。',
    '用 twitter_ 开头的工具查用户、推文、时间线、搜索和趋势；用户想盯某个账号时，用 twitter_monitor_add 加监控（不特别说明就监控原创、回复和引用），新动态会自动发到「X 监控」群里。',
    '每天有免费次数（读一次算一次，监控不扣），查之前想清楚要什么，别重复查同一个东西；次数用完就如实告诉用户明早 8 点恢复。',
    writeLine,
    '回答用中文，引用推文时附上链接。',
  ].join('\n')
}

/** 以前各版 X 情报员的人设，和换成现在这版时记的原因。 */
const OLD_PERSONAS: ReadonlyMap<string, string> = new Map([
  [xPersona('Pod 的 X 工具只能读数据和管理监控，不能发推、点赞；用户要发推时，说明要用共用浏览器。'), '写操作的说明改了：会话里有别的 X 写工具时可以用'],
  [
    xPersona('Pod 自带的 twitter_ 工具只能读数据和管理监控。会话里有别的 X 写工具（发推、点赞、转推、关注）时，用户明确要求就直接用它们做；没有的话，说明发推要用共用浏览器。'),
    '人设里的名字改成 dsh-bot',
  ],
])

const X_BOT: BotDraft = {
  name: 'X 情报员',
  title: 'X（推特）数据和监控',
  persona: xPersona(
    'dsh-bot 自带的 twitter_ 工具只能读数据和管理监控。会话里有别的 X 写工具（发推、点赞、转推、关注）时，用户明确要求就直接用它们做；没有的话，说明发推要用共用浏览器。',
  ),
  capabilities: ['X', '推特', '舆情监控'],
  card: {
    duties: '查 X（推特）上的用户、推文、话题和趋势；管理账号监控',
    strengths: '搜推文、看时间线、整理某个账号或话题的动态',
    notResponsible: '发推、点赞这类写操作',
    askWho: '拿不准时问主管',
  },
  toolProfile: 'research',
}

export interface XSeed {
  readonly bot: Bot | undefined
  readonly room: Room | undefined
}

/**
 * 第一次启动时建好「X 情报员」和「X 监控」群（主管和它在群里），以后不再重复建。
 * 之后监控事件要发群里时，群不在了（删掉了）就按原名重新拉一个。
 */
export function seedX(db: DatabaseSync, bots: BotService, rooms: RoomService): XSeed {
  const record = readState<SeedRecord | null>(db, SEED_KEY, null)
  if (record?.done === true) return { bot: upgradePersona(bots, bots.activeBot(record.botId)), room: rooms.get(record.roomId) }
  const bot = bots.active().find((item) => item.name === X_BOT.name) ?? bots.createFromDraft(X_BOT, { source: 'seed', actor: POD })
  const created = rooms.createGroup({ name: X_ROOM_TITLE, memberIds: [bot.id] }, POD)
  const room = created.ok ? created.value : undefined
  writeState(db, SEED_KEY, { done: true, botId: bot.id, roomId: room?.id ?? '' })
  if (room !== undefined) {
    rooms.post(room.id, {
      author: POD,
      kind: 'notice',
      body: `这里放你在 X 上监控的账号的新动态。想盯谁，在群里说“监控 @账号名”，${bot.name}会帮你加上；也可以让它查推文、看趋势。`,
    })
  }
  return { bot, room }
}

/** 之前建的 X 情报员，人设还是以前哪一版原样的换成现在的（记一版配置，能回滚）；改过的不动。 */
function upgradePersona(bots: BotService, bot: Bot | undefined): Bot | undefined {
  const reason = bot === undefined ? undefined : OLD_PERSONAS.get(bot.persona)
  if (bot === undefined || reason === undefined) return bot
  const result = bots.applyPatch(bot.id, { persona: X_BOT.persona }, { source: 'seed', actor: POD, reason })
  return result.ok ? result.value : bot
}

/** 事件要发的群：种子群还在就用它，不在了就按原名重新拉一个（主管和 X bot 在群里）。 */
export function xRoom(db: DatabaseSync, bots: BotService, rooms: RoomService): Room | undefined {
  const record = readState<SeedRecord | null>(db, SEED_KEY, null)
  const current = record === null ? undefined : rooms.get(record.roomId)
  if (current !== undefined && current.archivedAt === null) return current
  const bot = record === null ? undefined : bots.activeBot(record.botId)
  const created = rooms.createGroup({ name: X_ROOM_TITLE, memberIds: bot === undefined ? [] : [bot.id] }, POD)
  if (!created.ok) return undefined
  writeState(db, SEED_KEY, { done: true, botId: record?.botId ?? '', roomId: created.value.id })
  return created.value
}

/** 种子 X bot（还在的话）。 */
export function xBot(db: DatabaseSync, bots: BotService): Bot | undefined {
  const record = readState<SeedRecord | null>(db, SEED_KEY, null)
  return record === null ? undefined : bots.activeBot(record.botId)
}
