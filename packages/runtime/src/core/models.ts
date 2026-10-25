import type { Bot, PodSettings } from 'pod-domain'
import type { HostContext, LlmService, ModelCatalog, ModelSelection } from '../dsh.ts'

export interface ModelResolverDeps {
  readonly ctx: HostContext
  readonly settings: () => PodSettings
  /** 夜间调整给某个 bot 定的推理档位；没调过是 null。 */
  readonly effortFor: (botId: string) => string | null
}

/**
 * 模型解析：bot 自定义 → Pod 全局默认 → dsh 默认。null 表示交给 dsh 自己的默认。
 * 跟随默认的 bot 按夜间调整的推理档位开会话；你给 bot 指定的模型不自动改。
 */
export class ModelResolver {
  private readonly deps: ModelResolverDeps

  constructor(deps: ModelResolverDeps) {
    this.deps = deps
  }

  catalog(): Promise<ModelCatalog> {
    return this.deps.ctx.sessionController.modelCatalog()
  }

  async dshDefault(): Promise<ModelSelection> {
    return (await this.catalog()).default
  }

  async modelFor(choice: ModelSelection | null): Promise<ModelSelection | null> {
    return choice ?? this.deps.settings().defaultModel ?? null
  }

  /** 轻量调用的模型：设置里的轻量模型 → Pod 全局默认 → dsh 默认。 */
  async lite(): Promise<ModelSelection> {
    const settings = this.deps.settings()
    return settings.liteModel ?? settings.defaultModel ?? (await this.dshDefault())
  }

  async session(bot: Bot): Promise<ModelSelection | null> {
    const chosen = await this.modelFor(bot.model)
    if (bot.model !== null) return chosen
    const effort = this.deps.effortFor(bot.id)
    if (effort === null) return chosen
    return { ...(chosen ?? (await this.dshDefault())), reasoningEffort: effort }
  }

  /** bot 实际用的模型有哪些推理档位（从低到高）、现在是哪一档；指定了模型的 bot 不自动调。 */
  async efforts(bot: Bot): Promise<{ readonly efforts: readonly string[]; readonly current: string } | undefined> {
    if (bot.model !== null) return undefined
    const base = (await this.modelFor(null)) ?? (await this.dshDefault())
    const llm = this.deps.ctx.get('llm') as LlmService | undefined
    const info = await llm?.resolveModelInfo(base.provider, base.model).catch(() => undefined)
    const efforts = info?.reasoning?.efforts.map((effort) => effort.id) ?? []
    if (efforts.length < 2) return undefined
    const current = this.deps.effortFor(bot.id) ?? base.reasoningEffort ?? info?.reasoning?.defaultEffort ?? (efforts.at(-1) as string)
    return { efforts, current }
  }

  /** 用的是 DeepSeek 模型吗：只有这时才错峰。 */
  async isDeepSeek(choice: ModelSelection | null): Promise<boolean> {
    const route = (await this.modelFor(choice)) ?? (await this.dshDefault())
    return /deepseek/i.test(`${route.provider} ${route.model}`)
  }
}
