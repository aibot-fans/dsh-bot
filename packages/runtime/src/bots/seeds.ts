import type { DatabaseSync } from 'node:sqlite'
import { OWNER, POD, fail, ok, seedLatest, seedText, seedVersionOf, t, type Bot, type Language, type PodResult, type SeedPersona, type SeedUpdate } from 'pod-domain'
import { readState, writeState } from 'pod-store'
import type { BotService } from './service.ts'

/** 每个种子 bot 的人设基于哪个种子的哪一版：botId → { seed, base }。 */
const STATE_KEY = 'persona.seeds'

interface SeedBase {
  readonly seed: string
  readonly base: number
}

export interface SeedDeps {
  readonly db: DatabaseSync
  readonly bots: BotService
  readonly language: () => Language
}

interface Entry {
  readonly seed: SeedPersona
  readonly botId: () => string | undefined
}

/**
 * dsh-bot 自己建的 bot 的默认人设怎么跟上新版：人设还是哪一版默认的原文（没改过），出了新版或者换了语言就直接换上，记一版配置；
 * 改过的不动，记下它基于哪版，默认出了新版就在 bot 详情里显示差异，你选保留还是换新。
 */
export class SeedPersonas {
  private readonly deps: SeedDeps
  private readonly entries: Entry[] = []

  constructor(deps: SeedDeps) {
    this.deps = deps
  }

  register(seed: SeedPersona, botId: () => string | undefined): void {
    this.entries.push({ seed, botId })
  }

  private bases(): Readonly<Record<string, SeedBase>> {
    return readState<Readonly<Record<string, SeedBase>>>(this.deps.db, STATE_KEY, {})
  }

  private setBase(botId: string, value: SeedBase): void {
    writeState(this.deps.db, STATE_KEY, { ...this.bases(), [botId]: value })
  }

  /** 没改过：是哪一版默认的原文；Super-agent 的人设来源还是 seed 也算（更早的默认没留原文）。 */
  private untouched(bot: Bot, seed: SeedPersona): boolean {
    return seedVersionOf(seed, bot.persona) !== undefined || (bot.role === 'lead' && bot.personaSource === 'seed')
  }

  /** 启动和换语言时调：没改过的换成最新默认，改过的第一次见到时记下基于哪版（认不出就按有这套机制以前发出去的那版算）。 */
  sync(): void {
    for (const entry of this.entries) {
      const id = entry.botId()
      const bot = id === undefined ? undefined : this.deps.bots.activeBot(id)
      if (bot === undefined) continue
      const latest = seedLatest(entry.seed)
      if (this.untouched(bot, entry.seed)) {
        const wanted = seedText(entry.seed, latest, this.deps.language())
        if (wanted !== undefined && bot.persona !== wanted) this.deps.bots.applyPatch(bot.id, { persona: wanted }, { source: 'seed', actor: POD, reason: t('换成现在的默认人设'), personaSource: 'seed' })
        this.setBase(bot.id, { seed: entry.seed.id, base: latest })
      } else if (this.bases()[bot.id] === undefined) {
        this.setBase(bot.id, { seed: entry.seed.id, base: entry.seed.released })
      }
    }
  }

  private entryOf(botId: string): { readonly entry: Entry; readonly bot: Bot; readonly base: SeedBase } | undefined {
    const base = this.bases()[botId]
    const entry = base === undefined ? undefined : this.entries.find((item) => item.seed.id === base.seed)
    const bot = this.deps.bots.activeBot(botId)
    return base === undefined || entry === undefined || bot === undefined ? undefined : { entry, bot, base }
  }

  /** 改过的人设、默认在那之后出了新版：给 bot 详情看差异；没有就是 undefined。 */
  update(botId: string): SeedUpdate | undefined {
    const found = this.entryOf(botId)
    if (found === undefined) return undefined
    const latest = seedLatest(found.entry.seed)
    if (found.base.base >= latest || this.untouched(found.bot, found.entry.seed)) return undefined
    const language = this.deps.language()
    const before = seedText(found.entry.seed, found.base.base, language)
    const after = seedText(found.entry.seed, latest, language)
    return before === undefined || after === undefined ? undefined : { base: found.base.base, latest, before, after }
  }

  /** 保留你的人设：记成基于最新版，不再提示。 */
  keep(botId: string): PodResult<null> {
    const found = this.entryOf(botId)
    if (found === undefined) return fail('not-found', t('这个 bot 没有默认人设'))
    this.setBase(botId, { seed: found.base.seed, base: seedLatest(found.entry.seed) })
    return ok(null)
  }

  /** 换成新的默认人设（记一版配置，能回滚）。 */
  adopt(botId: string): PodResult<Bot> {
    const found = this.entryOf(botId)
    if (found === undefined) return fail('not-found', t('这个 bot 没有默认人设'))
    const latest = seedLatest(found.entry.seed)
    const wanted = seedText(found.entry.seed, latest, this.deps.language()) ?? found.bot.persona
    const result = this.deps.bots.applyPatch(botId, { persona: wanted }, { source: 'user', actor: OWNER, reason: t('换成新的默认人设'), personaSource: 'seed' })
    if (result.ok) this.setBase(botId, { seed: found.base.seed, base: latest })
    return result
  }
}
