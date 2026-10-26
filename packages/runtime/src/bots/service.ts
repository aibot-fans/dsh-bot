import type { DatabaseSync } from 'node:sqlite'
import {
  BOT_COLOR_SCHEME,
  BOT_ICON_SET,
  EMPTY_CARD,
  LEAD_BOT_ID,
  LEAD_SEED,
  POD,
  asRecord,
  assignBotIcons,
  botConfig,
  describeConfigChange,
  fail,
  guessBotIcon,
  hasAvatar,
  iconAvatar,
  isAvatarImage,
  isBotColor,
  newId,
  ok,
  pickBotColor,
  pickBotIcon,
  readId,
  readInt,
  readObject,
  readableBotColor,
  takenIcons,
  validateDraft,
  validatePatch,
  type Bot,
  type BotConfig,
  type BotDraft,
  type BotPatch,
  type PersonaSource,
  type PodResult,
} from 'pod-domain'
import {
  appendBotVersion,
  getBot,
  getBotVersion,
  insertBot,
  listBots,
  listBotVersions,
  purgeArchivedBots,
  readState,
  setBotArchived,
  setBotAvatar,
  setBotColor,
  transaction,
  writeBotConfig,
  writeState,
  type BotVersion,
  type VersionSource,
} from 'pod-store'
import type { Auditor } from '../core/audit.ts'
import type { PodBus } from '../core/bus.ts'
import { RECYCLE_DAYS } from '../core/maintenance.ts'

export interface BotServiceDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly audit: Auditor
  readonly now: () => number
}

/** 谁在改：你在页面上改、主管用组织工具改、自我优化改、回滚。 */
export interface ChangeOrigin {
  readonly source: VersionSource
  /** 审计里记的操作者：owner 或 bot id 或 pod。 */
  readonly actor: string
  readonly reason?: string
}

export const OWNER_ORIGIN: ChangeOrigin = { source: 'user', actor: 'owner' }

type BotListener = (bot: Bot) => void

function configFromDraft(draft: BotDraft): BotConfig {
  return {
    name: draft.name,
    title: draft.title,
    persona: draft.persona,
    avatar: draft.avatar ?? '',
    capabilities: draft.capabilities ?? [],
    card: draft.card ?? EMPTY_CARD,
    model: draft.model ?? null,
    toolProfile: draft.toolProfile ?? 'exec',
    temporary: draft.temporary ?? false,
  }
}

/** 用的是哪一套内置图标；换了一套时老 bot 的内置图标重新配一次。 */
const ICON_SET_KEY = 'avatars.iconSet'

/**
 * 还没定头像的 bot（老数据、空串、旧版的一个字）一次配好内置图标：在用的尽量不重样，
 * 回收站里的按各自最合适的配。内置图标换了一套（鲸鱼图）时，用内置图标的老 bot 也按新的种类重配一次；
 * 上传的图片不动。只改头像，不追加配置版本。
 */
function fillIcons(db: DatabaseSync, bots: readonly Bot[]): readonly Bot[] {
  const refresh = readState<string>(db, ICON_SET_KEY, '') !== BOT_ICON_SET
  const missing = bots.filter((bot) => !hasAvatar(bot.avatar) || (refresh && !isAvatarImage(bot.avatar)))
  if (refresh) writeState(db, ICON_SET_KEY, BOT_ICON_SET)
  if (missing.length === 0) return bots
  const ids = new Set(missing.map((bot) => bot.id))
  const assigned = assignBotIcons(
    missing.filter((bot) => bot.archivedAt === null),
    takenIcons(bots.filter((bot) => !ids.has(bot.id))),
  )
  const icons = new Map(missing.map((bot) => [bot.id, assigned.get(bot.id) ?? guessBotIcon(bot)] as const))
  transaction(db, () => {
    for (const [id, kind] of icons) setBotAvatar(db, id, iconAvatar(kind))
  })
  return bots.map((bot) => {
    const kind = icons.get(bot.id)
    return kind === undefined ? bot : { ...bot, avatar: iconAvatar(kind) }
  })
}

/** 名字颜色用的是哪一种配法；换了配法时老 bot 全部重新配一次。 */
const COLOR_SCHEME_KEY = 'colors.scheme'

/**
 * 还没有名字颜色的 bot（老数据）一次配好：按创建顺序随机，尽量和在用的 bot 不撞色。不算配置修改。
 * 换了配法（比如从 12 色色板改成随机色）时所有 bot 都重新随机一次。
 */
function fillColors(db: DatabaseSync, bots: readonly Bot[]): readonly Bot[] {
  const refresh = readState<string>(db, COLOR_SCHEME_KEY, '') !== BOT_COLOR_SCHEME
  const keep = (bot: Bot): boolean => !refresh && isBotColor(bot.color)
  if (bots.every(keep)) return bots
  const start = bots.filter((bot) => keep(bot) && bot.archivedAt === null).map((bot) => bot.color ?? '')
  const { colors } = bots.reduce<{ readonly used: readonly string[]; readonly colors: ReadonlyMap<string, string> }>(
    (acc, bot) => {
      if (keep(bot)) return acc
      const color = pickBotColor(acc.used)
      return { used: bot.archivedAt === null ? [...acc.used, color] : acc.used, colors: new Map([...acc.colors, [bot.id, color]]) }
    },
    { used: start, colors: new Map() },
  )
  transaction(db, () => {
    for (const [id, color] of colors) setBotColor(db, id, color)
    writeState(db, COLOR_SCHEME_KEY, BOT_COLOR_SCHEME)
  })
  return bots.map((bot) => {
    const color = colors.get(bot.id)
    return color === undefined ? bot : { ...bot, color }
  })
}

/** 改了人设以后记成谁写的：回滚和换成新版默认人设都不改来源。 */
function personaSourceFor(origin: ChangeOrigin, current: PersonaSource): PersonaSource {
  if (origin.source === 'user') return 'user'
  if (origin.source === 'rollback' || origin.source === 'seed') return current
  return 'auto'
}

/**
 * bot 的读写、配置版本和回收站。内存里一份只读索引，写操作先落库再替换索引。
 * 每次改动都追加一版配置，任何一版都能回滚；归档就是进回收站，30 天内能恢复。
 */
export class BotService {
  private bots: ReadonlyMap<string, Bot>
  private readonly listeners = new Set<BotListener>()
  private readonly deps: BotServiceDeps

  constructor(deps: BotServiceDeps) {
    this.deps = deps
    const { db, now } = deps
    if (getBot(db, LEAD_BOT_ID) === undefined) {
      insertBot(db, { id: LEAD_BOT_ID, role: 'lead', config: configFromDraft(LEAD_SEED), personaSource: 'seed', now: now() })
    }
    const bots = listBots(db)
    for (const bot of bots) {
      if (listBotVersions(db, bot.id).length === 0) {
        appendBotVersion(db, {
          id: newId('ver'),
          botId: bot.id,
          config: botConfig(bot),
          source: bot.role === 'lead' ? 'seed' : 'user',
          reason: '初始版本',
          now: now(),
        })
      }
    }
    this.bots = new Map(fillColors(db, fillIcons(db, bots)).map((bot) => [bot.id, bot]))
    this.upgradeLeadPersona()
  }

  /**
   * 主管的人设还是默认人设（来源是 seed：你和自我优化都没改过）、但不是现在这版，就换成现在的（记一版配置，能回滚）。
   * 来源一旦变成 user 或 auto 就不会再变回 seed，所以改过的不会被换掉。
   */
  private upgradeLeadPersona(): void {
    const lead = this.activeBot(LEAD_BOT_ID)
    if (lead === undefined || lead.personaSource !== 'seed' || lead.persona === LEAD_SEED.persona) return
    this.applyPatch(lead.id, { persona: LEAD_SEED.persona }, { source: 'seed', actor: POD, reason: '换成新版的默认人设' })
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  /** 新 bot 没带头像时按角色配一个内置图标，尽量不和在用的 bot 撞；看不出定位的用万能助手。 */
  private withIcon(config: BotConfig): BotConfig {
    if (hasAvatar(config.avatar)) return config
    return { ...config, avatar: iconAvatar(pickBotIcon({ ...config, role: 'member' }, takenIcons(this.active()))) }
  }

  private remember(bot: Bot): Bot {
    this.bots = new Map([...this.bots, [bot.id, bot]])
    this.deps.bus.emit({ type: 'bots' })
    for (const listener of this.listeners) listener(bot)
    return bot
  }

  onChange(listener: BotListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 全部 bot，含回收站里的。 */
  all(): readonly Bot[] {
    return [...this.bots.values()]
  }

  active(): readonly Bot[] {
    return this.all().filter((bot) => bot.archivedAt === null)
  }

  activeMembers(): readonly Bot[] {
    return this.active().filter((bot) => bot.role === 'member')
  }

  get(id: string): Bot | undefined {
    return this.bots.get(id)
  }

  activeBot(id: string): Bot | undefined {
    const bot = this.bots.get(id)
    return bot !== undefined && bot.archivedAt === null ? bot : undefined
  }

  lead(): Bot {
    const lead = this.bots.get(LEAD_BOT_ID)
    if (lead === undefined) throw new Error('主管不存在，数据库可能被手动改过')
    return lead
  }

  /** 按名字或 id 找在用的 bot，给主管的工具用。 */
  resolve(nameOrId: string): Bot | undefined {
    const key = nameOrId.trim().toLowerCase()
    return this.active().find((bot) => bot.id === nameOrId || bot.name.toLowerCase() === key)
  }

  create(input: unknown, origin: ChangeOrigin = OWNER_ORIGIN): PodResult<Bot> {
    const draft = validateDraft(input)
    if (!draft.ok) return draft
    return ok(this.createFromDraft(draft.value, origin))
  }

  createFromDraft(draft: BotDraft, origin: ChangeOrigin): Bot {
    const { db, now } = this.deps
    const id = newId('bot')
    const config = this.withIcon(configFromDraft(draft))
    const bot = transaction(db, () => {
      const created = insertBot(db, {
        id,
        role: 'member',
        config,
        personaSource: origin.source === 'user' ? 'user' : 'auto',
        color: pickBotColor(this.active().map((bot) => bot.color ?? '')),
        now: now(),
      })
      appendBotVersion(db, { id: newId('ver'), botId: id, config, source: origin.source, reason: origin.reason ?? '新建', now: now() })
      return created
    })
    this.deps.audit.record('bot.create', origin.actor, id, { name: config.name, reason: origin.reason ?? '' })
    return this.remember(bot)
  }

  /** 页面上的修改：{ id, patch }。名字颜色单独存，不算一次配置修改。 */
  update(input: unknown, origin: ChangeOrigin = OWNER_ORIGIN): PodResult<Bot> {
    const id = readId(input, 'id')
    if (id === undefined) return fail('invalid-input', '缺少 bot 的 id')
    const { color, ...rest } = asRecord(readObject(input, 'patch'))
    if (color !== undefined) {
      const readable = readableBotColor(color)
      if (readable === undefined) return fail('invalid-input', '颜色要写成 #RRGGBB')
      const current = this.activeBot(id)
      if (current === undefined) return fail('not-found', '找不到这个 bot')
      setBotColor(this.db, id, readable)
      this.remember({ ...current, color: readable })
      if (Object.keys(rest).length === 0) return ok({ ...current, color: readable })
    }
    const patch = validatePatch(rest)
    if (!patch.ok) return patch
    return this.applyPatch(id, patch.value, origin)
  }

  applyPatch(id: string, patch: BotPatch, origin: ChangeOrigin): PodResult<Bot> {
    const current = this.activeBot(id)
    if (current === undefined) return fail('not-found', '找不到这个 bot')
    const before = botConfig(current)
    const after: BotConfig = { ...before, ...patch }
    const changes = describeConfigChange(before, after)
    if (changes.length === 0) return ok(current)
    const personaSource = patch.persona === undefined ? current.personaSource : personaSourceFor(origin, current.personaSource)
    return this.writeConfig(current, after, personaSource, origin, origin.reason ?? `修改了${changes.join('、')}`)
  }

  private writeConfig(current: Bot, config: BotConfig, personaSource: PersonaSource, origin: ChangeOrigin, reason: string): PodResult<Bot> {
    const { db, now } = this.deps
    const updated = transaction(db, () => {
      const written = writeBotConfig(db, current.id, config, personaSource, now())
      if (written !== undefined) {
        appendBotVersion(db, { id: newId('ver'), botId: current.id, config, source: origin.source, reason, now: now() })
      }
      return written
    })
    if (updated === undefined) return fail('not-found', '找不到这个 bot')
    this.deps.audit.record('bot.update', origin.actor, current.id, { reason })
    return ok(this.remember(updated))
  }

  archive(input: unknown, actor = 'owner'): PodResult<Bot> {
    const id = readId(input, 'id')
    if (id === undefined) return fail('invalid-input', '缺少 bot 的 id')
    return this.archiveById(id, actor)
  }

  archiveById(id: string, actor: string): PodResult<Bot> {
    const current = this.activeBot(id)
    if (current === undefined) return fail('not-found', '找不到这个 bot')
    if (current.role === 'lead') return fail('lead-protected', '主管不能归档')
    if (!setBotArchived(this.db, id, this.deps.now(), this.deps.now())) return fail('not-found', '找不到这个 bot')
    this.deps.audit.record('bot.archive', actor, id, { name: current.name })
    return this.reload(id)
  }

  restore(input: unknown, actor = 'owner'): PodResult<Bot> {
    const id = readId(input, 'id')
    if (id === undefined) return fail('invalid-input', '缺少 bot 的 id')
    const current = this.bots.get(id)
    if (current === undefined || current.archivedAt === null) return fail('not-found', '回收站里没有这个 bot')
    if (!setBotArchived(this.db, id, null, this.deps.now())) return fail('not-found', '回收站里没有这个 bot')
    this.deps.audit.record('bot.restore', actor, id, { name: current.name })
    return this.reload(id)
  }

  private reload(id: string): PodResult<Bot> {
    const bot = getBot(this.db, id)
    return bot === undefined ? fail('not-found', '找不到这个 bot') : ok(this.remember(bot))
  }

  versions(input: unknown): PodResult<readonly BotVersion[]> {
    const id = readId(input, 'id')
    if (id === undefined) return fail('invalid-input', '缺少 bot 的 id')
    if (this.bots.get(id) === undefined) return fail('not-found', '找不到这个 bot')
    return ok(listBotVersions(this.db, id))
  }

  /** 回滚到某一版：把那一版的配置写回，并追加一版“回滚”，历史一条不丢。 */
  rollback(input: unknown, actor = 'owner'): PodResult<Bot> {
    const id = readId(input, 'id')
    const version = readInt(input, 'version') ?? Number(readId(input, 'version'))
    if (id === undefined || !Number.isSafeInteger(version)) return fail('invalid-input', '要写明 bot 和版本号')
    const current = this.activeBot(id)
    if (current === undefined) return fail('not-found', '找不到这个 bot')
    const target = getBotVersion(this.db, id, version)
    if (target === undefined) return fail('not-found', `没有第 ${version} 版`)
    const config: BotConfig = { ...botConfig(current), ...target.config }
    return this.writeConfig(current, config, current.personaSource, { source: 'rollback', actor }, `回滚到第 ${version} 版`)
  }

  /** 回收站：归档了、还没过期的 bot。 */
  recycleBin(): readonly Bot[] {
    return this.all().filter((bot) => bot.archivedAt !== null)
  }

  /** 回收站里超过 30 天的彻底删除。 */
  purgeExpired(now: number): number {
    const purged = purgeArchivedBots(this.db, now - RECYCLE_DAYS * 86_400_000, now)
    if (purged > 0) this.bots = new Map(listBots(this.db).map((bot) => [bot.id, bot]))
    if (purged > 0) this.deps.bus.emit({ type: 'bots' })
    return purged
  }
}
