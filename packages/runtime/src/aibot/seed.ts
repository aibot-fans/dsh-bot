import type { DatabaseSync } from 'node:sqlite'
import { EMPTY_CARD, LANGUAGE_NAMES, POD, currentLanguage, t, translate, type Bot, type BotCard, type BotDraft, type BotPatch, type Language, type Room } from 'pod-domain'
import { getMessage, readState, writeState } from 'pod-store'
import type { BotService } from '../bots/service.ts'
import type { RoomService } from '../chat/rooms.ts'

/** 默认的 X bot 和「X 监控」群聊：只在第一次建；你删掉了就不再自己建 bot。 */
const SEED_KEY = 'aibot.seed'

/** 「X 监控」群的默认名字：语言换了、群名还是默认的就跟着换。 */
const X_ROOM_TITLES: Readonly<Record<Language, string>> = { zh: 'X 监控', en: 'X Monitor' }

function xRoomTitle(language: Language = currentLanguage()): string {
  return X_ROOM_TITLES[language]
}

interface SeedRecord {
  readonly done: boolean
  readonly botId: string
  readonly roomId: string
  /** 群里的第一条提示：语言换了、还是原样的就跟着换。旧版本建的没记。 */
  readonly noticeId?: string
}

/** 「X 监控」群里的第一条提示，按语言写。 */
function welcome(language: Language, name: string): string {
  return translate(language, '这里放你在 X 上监控的账号的新动态。想盯谁，在群里说“监控 @账号名”，{name}会帮你加上；也可以让它查推文、看趋势。', { name })
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
  [
    xPersona('dsh-bot 自带的 twitter_ 工具只能读数据和管理监控。会话里有别的 X 写工具（发推、点赞、转推、关注）时，用户明确要求就直接用它们做；没有的话，说明发推要用共用浏览器。'),
    '写操作改用 x_ 工具（dsh-bot 浏览器里登录的 X 账号）',
  ],
  [
    xPersonaEn(
      "dsh-bot's built-in twitter_ tools can only read data and manage monitoring. If the session has other X write tools (post, like, repost, follow), use them when the user explicitly asks; otherwise explain that posting needs the shared browser.",
    ),
    '写操作改用 x_ 工具（dsh-bot 浏览器里登录的 X 账号）',
  ],
  [xPersona('要发推、回复、引用、删推、点赞、转推或关注时，用 x_ 开头的工具做，用的是用户在 dsh-bot 浏览器里登录的 X 账号；只在用户明确要求时做，按设置可能要用户先批准。没登录时请用户在 设置 → 通用 → X 账号 里登录。twitter_ 开头的工具只读数据和管理监控。'), '加上用 x_ 工具读私信和加密聊天，公开数据照旧用 twitter_ 工具'],
  [
    xPersonaEn(
      "To post, reply, quote, delete a post, like, repost or follow, use the tools whose names start with x_; they act as the X account the user signed in to in dsh-bot's browser. Do it only when the user explicitly asks; depending on settings the user may need to approve first. If no account is signed in, ask the user to sign in under Settings → General → X account. The twitter_ tools only read data and manage monitoring.",
    ),
    '加上用 x_ 工具读私信和加密聊天，公开数据照旧用 twitter_ 工具',
  ],
])

/** 以前的默认角色卡：人设换新版时，角色卡还是这些的也一起换。 */
const OLD_CARDS: readonly BotCard[] = [
  { duties: '查 X（推特）上的用户、推文、话题和趋势；管理账号监控', strengths: '搜推文、看时间线、整理某个账号或话题的动态', notResponsible: '发推、点赞这类写操作', askWho: '拿不准时问主管' },
  {
    duties: 'Looks up users, posts, topics and trends on X (Twitter); manages account monitoring',
    strengths: 'Searching posts, reading timelines, summarizing activity for an account or topic',
    notResponsible: 'Write actions like posting and liking',
    askWho: 'Ask the Lead when unsure',
  },
  { duties: '查 X（推特）上的用户、推文、话题和趋势；管理账号监控；按要求发推、点赞、转推、关注', strengths: '搜推文、看时间线、整理某个账号或话题的动态', notResponsible: '用户没要求的写操作', askWho: '拿不准时问主管' },
  {
    duties: 'Looks up users, posts, topics and trends on X (Twitter); manages account monitoring; posts, likes, reposts and follows when asked',
    strengths: 'Searching posts, reading timelines, summarizing activity for an account or topic',
    notResponsible: 'Write actions the user did not ask for',
    askWho: 'Ask the Lead when unsure',
  },
]

/** 英文界面下的 X 情报员人设，中间那行讲写操作。 */
function xPersonaEn(writeLine: string): string {
  return [
    'You are the X Analyst, in charge of data lookups and account monitoring on X (Twitter).',
    'Use the tools whose names start with twitter_ to look up users, posts, timelines, searches and trends. When the user wants to watch an account, add it with twitter_monitor_add (unless told otherwise, monitor original posts, replies and quotes); new activity is posted to the “X Monitor” group automatically.',
    'There is a free daily quota (each read counts once; monitoring is free). Think about what you need before looking things up and do not query the same thing twice. When the quota runs out, tell the user plainly that it resets at 8:00 tomorrow morning (Beijing time).',
    writeLine,
    'Reply in English, and include links when quoting posts.',
  ].join('\n')
}

/** 现在这版人设里讲写操作的那行。 */
const WRITE_LINE =
  '要发推、回复、引用、删推、点赞、转推、关注这类改东西的事，或者要读私信、加密聊天、书签这类只有登录账号才看得到的内容，用 x_ 开头的工具，用的是用户在 dsh-bot 浏览器里登录的 X 账号；改东西只在用户明确要求时做，按设置可能要用户先批准。没登录时请用户在 设置 → 通用 → X 账号 里登录。公开的数据照旧用 twitter_ 开头的工具查，别拿用户的账号大量读。'
const WRITE_LINE_EN =
  "To change things on X (post, reply, quote, delete a post, like, repost, follow) or to read what only the signed-in account can see (DMs, encrypted chats, bookmarks), use the tools whose names start with x_; they act as the X account the user signed in to in dsh-bot's browser. Change things only when the user explicitly asks; depending on settings the user may need to approve first. If no account is signed in, ask the user to sign in under Settings → General → X account. Keep using the twitter_ tools for public data, and don't do heavy reading with the user's account."

const X_BOT_EN: BotDraft = {
  name: 'X Analyst',
  title: 'X (Twitter) data and monitoring',
  persona: xPersonaEn(WRITE_LINE_EN),
  capabilities: ['X', 'Twitter', 'Social listening'],
  card: {
    duties: 'Looks up users, posts, topics and trends on X (Twitter); manages account monitoring; posts, likes, reposts and follows, and reads DMs and encrypted chats, when asked',
    strengths: 'Searching posts, reading timelines, summarizing activity for an account or topic',
    notResponsible: 'Write actions the user did not ask for',
    askWho: 'Ask the Lead when unsure',
  },
  toolProfile: 'research',
}

const X_BOT: BotDraft = {
  name: 'X 情报员',
  title: 'X（推特）数据和监控',
  persona: xPersona(WRITE_LINE),
  capabilities: ['X', '推特', '舆情监控'],
  card: {
    duties: '查 X（推特）上的用户、推文、话题和趋势；管理账号监控；按要求发推、点赞、转推、关注，读私信和加密聊天',
    strengths: '搜推文、看时间线、整理某个账号或话题的动态',
    notResponsible: '用户没要求的写操作',
    askWho: '拿不准时问主管',
  },
  toolProfile: 'research',
}

function xBotDraft(language: Language = currentLanguage()): BotDraft {
  return language === 'en' ? X_BOT_EN : X_BOT
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
  const bot = bots.active().find((item) => item.name === X_BOT.name || item.name === X_BOT_EN.name) ?? bots.createFromDraft(xBotDraft(), { source: 'seed', actor: POD })
  const created = rooms.createGroup({ name: xRoomTitle(), memberIds: [bot.id] }, POD)
  const room = created.ok ? created.value : undefined
  // 第一次启动时页面多半还没报过 dsh 的语言，这条提示可能先用了中文；记下它，语言换了由 localizeX 跟着换。
  const notice = room === undefined ? undefined : rooms.post(room.id, { author: POD, kind: 'notice', body: welcome(currentLanguage(), bot.name) })
  writeState(db, SEED_KEY, { done: true, botId: bot.id, roomId: room?.id ?? '', ...(notice === undefined ? {} : { noticeId: notice.id }) })
  return { bot, room }
}

/** 之前建的 X 情报员，人设还是以前哪一版原样的换成现在这个语言的（记一版配置，能回滚），角色卡还是旧默认的一起换；改过的不动。 */
function upgradePersona(bots: BotService, bot: Bot | undefined): Bot | undefined {
  const reason = bot === undefined ? undefined : OLD_PERSONAS.get(bot.persona)
  if (bot === undefined || reason === undefined) return bot
  const wanted = xBotDraft()
  const card = OLD_CARDS.some((old) => sameCard(bot.card, old)) ? { card: wanted.card ?? EMPTY_CARD } : {}
  const result = bots.applyPatch(bot.id, { persona: wanted.persona, ...card }, { source: 'seed', actor: POD, reason })
  return result.ok ? result.value : bot
}

/** 事件要发的群：种子群还在就用它，不在了就按原名重新拉一个（主管和 X bot 在群里）。 */
export function xRoom(db: DatabaseSync, bots: BotService, rooms: RoomService): Room | undefined {
  const record = readState<SeedRecord | null>(db, SEED_KEY, null)
  const current = record === null ? undefined : rooms.get(record.roomId)
  if (current !== undefined && current.archivedAt === null) return current
  const bot = record === null ? undefined : bots.activeBot(record.botId)
  const created = rooms.createGroup({ name: xRoomTitle(), memberIds: bot === undefined ? [] : [bot.id] }, POD)
  if (!created.ok) return undefined
  writeState(db, SEED_KEY, { done: true, botId: record?.botId ?? '', roomId: created.value.id })
  return created.value
}

/** 种子 X bot（还在的话）。 */
export function xBot(db: DatabaseSync, bots: BotService): Bot | undefined {
  const record = readState<SeedRecord | null>(db, SEED_KEY, null)
  return record === null ? undefined : bots.activeBot(record.botId)
}

/** 两种语言的默认值里有它、又不是这个语言的版本：说明没改过，可以换成这个语言的。 */
function swappable<T>(current: T, wanted: T, defaults: readonly T[], same: (a: T, b: T) => boolean = Object.is): boolean {
  return defaults.some((value) => same(value, current)) && !same(wanted, current)
}

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean => (a ?? []).join('\n') === (b ?? []).join('\n')

const sameCard = (a: BotCard | undefined, b: BotCard | undefined): boolean =>
  (Object.keys(EMPTY_CARD) as (keyof BotCard)[]).every((key) => (a ?? EMPTY_CARD)[key] === (b ?? EMPTY_CARD)[key])

/** 种子 X bot 还是默认值的部分（名字、角色、人设、能力标签、角色卡）换成这个语言的版本；改过的不动。 */
function seedPatch(bot: Bot, wanted: BotDraft): BotPatch {
  const drafts = [X_BOT, X_BOT_EN]
  return {
    ...(swappable(bot.name, wanted.name, drafts.map((draft) => draft.name)) ? { name: wanted.name } : {}),
    ...(swappable(bot.title, wanted.title, drafts.map((draft) => draft.title)) ? { title: wanted.title } : {}),
    ...(swappable(bot.persona, wanted.persona, drafts.map((draft) => draft.persona)) ? { persona: wanted.persona } : {}),
    ...(swappable(bot.capabilities, wanted.capabilities ?? [], drafts.map((draft) => draft.capabilities ?? []), sameList) ? { capabilities: wanted.capabilities ?? [] } : {}),
    ...(swappable(bot.card, wanted.card ?? EMPTY_CARD, drafts.map((draft) => draft.card ?? EMPTY_CARD), sameCard) ? { card: wanted.card ?? EMPTY_CARD } : {}),
  }
}

/** 语言换了：种子 X bot 和「X 监控」群还是默认的部分换成这个语言的版本（bot 记一版配置，能回滚）；你改过的不动。 */
export function localizeX(db: DatabaseSync, bots: BotService, rooms: RoomService): void {
  const record = readState<SeedRecord | null>(db, SEED_KEY, null)
  if (record === null) return
  const bot = bots.activeBot(record.botId)
  if (bot !== undefined) {
    const patch = seedPatch(bot, xBotDraft())
    if (Object.keys(patch).length > 0) bots.applyPatch(bot.id, patch, { source: 'seed', actor: POD, reason: t('换成现在的默认设定') })
  }
  const room = rooms.get(record.roomId)
  const title = xRoomTitle()
  if (room !== undefined && room.title !== title && Object.values(X_ROOM_TITLES).includes(room.title)) rooms.update({ roomId: room.id, patch: { title } })
  const notice = record.noticeId === undefined ? undefined : getMessage(db, record.noticeId)
  const name = bots.activeBot(record.botId)?.name
  if (notice === undefined || notice.deletedAt !== null || name === undefined) return
  // 两种语言、两个默认名字写出来的原样提示才换；bot 改过名就照新名字写。
  const defaults = (Object.keys(LANGUAGE_NAMES) as Language[]).flatMap((language) => [X_BOT.name, X_BOT_EN.name, name].map((item) => welcome(language, item)))
  const wanted = welcome(currentLanguage(), name)
  if (notice.body !== wanted && defaults.includes(notice.body)) rooms.patchMessage(notice.id, { body: wanted })
}
