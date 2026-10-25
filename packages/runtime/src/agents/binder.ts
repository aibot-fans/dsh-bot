import type { PodSession } from 'pod-domain'
import type { HostContext, LiveAgent, SkillRegistryLike, ToolDefinition } from '../dsh.ts'
import type { SessionRegistry } from './registry.ts'

/** 给一条会话装哪些 Pod 工具、哪些拒绝规则、哪些技能。 */
export interface Equipment {
  readonly tools: readonly ToolDefinition[]
  /** 返回字符串就拒绝这次工具调用，例如对外开放时禁用 shell。 */
  readonly guard?: (call: { readonly name: string; readonly arguments?: unknown }) => string | undefined
  /** 这个 bot 和它所在团队的技能，交给 dsh 的技能注册表（只对这个 agent 生效）。 */
  readonly skills?: () => readonly SkillEntry[]
}

export interface SkillEntry {
  readonly name: string
  /** 内容变了才重新注册。 */
  readonly key: string
  readonly registration: Readonly<Record<string, unknown>>
}

export interface BinderDeps {
  readonly ctx: HostContext
  readonly registry: SessionRegistry
  readonly equip: (session: PodSession, agent: LiveAgent) => Equipment
  readonly warn: (message: string) => void
  /** agent 上线或释放时通知（观察者据此更新状态）。 */
  readonly onAttach?: (session: PodSession, agent: LiveAgent) => void
  readonly onDetach?: (sessionId: string) => void
}

/**
 * 按会话给 agent 装上 Pod 的工具：注册在 agent 自己的作用域里，只对这条会话生效，
 * agent 释放时由 dsh 一起撤销。和 dsh 实验性团队插件一样，在 agent/created 时安装。
 */
export class AgentBinder {
  private readonly installed = new Map<LiveAgent, () => void>()
  /** 每个 agent 已注册的技能：名字 → 内容键和撤销函数。 */
  private readonly skillsInstalled = new Map<LiveAgent, Map<string, { readonly key: string; readonly dispose: () => void }>>()
  private readonly skillSources = new Map<LiveAgent, { readonly botId: string; readonly list: () => readonly SkillEntry[] }>()
  private readonly deps: BinderDeps

  constructor(deps: BinderDeps) {
    this.deps = deps
  }

  start(): () => void {
    const { ctx } = this.deps
    for (const agent of ctx.agents.list()) this.maybeInstall(agent)
    const offCreated = ctx.on('agent/created', ({ agent }) => this.maybeInstall(agent))
    const offDisposed = ctx.on('agent/disposed', ({ agent }) => this.uninstall(agent))
    return () => {
      offCreated()
      offDisposed()
      for (const dispose of this.installed.values()) dispose()
      this.installed.clear()
    }
  }

  /** 会话刚登记好时调用：agent 如果已经在了（dsh 创建会话时就建了 agent），补装。 */
  attachIfLive(session: PodSession): void {
    const agent = this.deps.ctx.agents.get(session.id)
    if (agent !== undefined) this.maybeInstall(agent)
  }

  /** 重新装一遍（比如工具档案改了），下一步请求就用新工具。 */
  reinstall(sessionId: string): void {
    const agent = this.deps.ctx.agents.get(sessionId)
    if (agent === undefined) return
    this.uninstall(agent)
    this.maybeInstall(agent)
  }

  private maybeInstall(agent: LiveAgent): void {
    if (this.installed.has(agent)) return
    const session = this.deps.registry.get(agent.session.id)
    if (session === undefined) return
    const disposers: (() => void)[] = []
    try {
      const equipment = this.deps.equip(session, agent)
      for (const tool of equipment.tools) disposers.push(agent.ctx.tools.register(tool))
      if (equipment.guard !== undefined) {
        const guard = equipment.guard
        disposers.push(agent.ctx.tools.guard((exec) => guard({ name: exec.name, arguments: exec.arguments })))
      }
      if (equipment.skills !== undefined) {
        this.skillSources.set(agent, { botId: session.botId, list: equipment.skills })
        this.syncSkills(agent)
      }
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      this.deps.warn(`给会话 ${session.id} 装 Pod 工具失败：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    this.installed.set(agent, () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {
          // agent 已经释放时撤销会报错，忽略。
        }
      }
    })
    this.deps.onAttach?.(session, agent)
  }

  /** 按最新的技能列表增删：内容变了的先撤销再注册（同名技能不能重复注册）。 */
  private syncSkills(agent: LiveAgent): void {
    const source = this.skillSources.get(agent)
    const registry = agent.ctx.get?.('skills') as SkillRegistryLike | undefined
    if (source === undefined || registry === undefined || typeof registry.register !== 'function') return
    const current = this.skillsInstalled.get(agent) ?? new Map<string, { readonly key: string; readonly dispose: () => void }>()
    const wanted = new Map(source.list().map((entry) => [entry.name, entry]))
    for (const [name, installed] of current) {
      if (wanted.get(name)?.key === installed.key) continue
      try {
        installed.dispose()
      } catch {
        // agent 已经释放。
      }
      current.delete(name)
    }
    for (const [name, entry] of wanted) {
      if (current.has(name)) continue
      try {
        current.set(name, { key: entry.key, dispose: registry.register(entry.registration) })
      } catch (error) {
        this.deps.warn(`注册技能 ${name} 失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.skillsInstalled.set(agent, current)
  }

  /** 技能变了：给相关 bot 的在线 agent 重新同步（'all' 表示团队技能，所有 agent 都看一遍）。 */
  refreshSkills(botIds: readonly string[] | 'all'): void {
    for (const [agent, source] of this.skillSources) {
      if (botIds === 'all' || botIds.includes(source.botId)) this.syncSkills(agent)
    }
  }

  private uninstall(agent: LiveAgent): void {
    const skills = this.skillsInstalled.get(agent)
    for (const installed of skills?.values() ?? []) {
      try {
        installed.dispose()
      } catch {
        // agent 已经释放。
      }
    }
    this.skillsInstalled.delete(agent)
    this.skillSources.delete(agent)
    const dispose = this.installed.get(agent)
    if (dispose === undefined) return
    this.installed.delete(agent)
    dispose()
    this.deps.registry.forgetPersona(agent.session.id)
    this.deps.onDetach?.(agent.session.id)
  }
}
