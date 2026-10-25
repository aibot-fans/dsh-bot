import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { PROFILE_PRESETS, intersectProfiles, type Bot, type PodSession, type SessionKind, type ToolProfile } from 'pod-domain'
import {
  addSessionSteps,
  addSessionUsage,
  insertSession,
  listSessions,
  markSessionTainted,
  retireSession,
  type SessionUsageDelta,
} from 'pod-store'
import type { ModelSelection } from '../dsh.ts'
import type { SessionFactory } from '../sessions/factory.ts'

export interface OpenSessionSpec {
  readonly bot: Bot
  readonly kind: SessionKind
  readonly roomId: string | null
  readonly taskId: string | null
  /** 工作目录，相对 Pod 工作区。 */
  readonly folder: string
  readonly title: string
  readonly tainted?: boolean
  readonly segment?: number
  /** 想复用的空白会话。 */
  readonly reuse?: string
  /** 权限上限：会话的工具档案 = bot 的档案 ∩ 这个上限（派活不能放大权限）。 */
  readonly ceiling?: ToolProfile
}

export interface SessionRegistryDeps {
  readonly db: DatabaseSync
  readonly factory: SessionFactory
  readonly now: () => number
  readonly modelFor: (bot: Bot) => Promise<ModelSelection | null>
  /** 组出这段会话冻结的人设。 */
  readonly compose: (session: PodSession) => string
  /** 会话登记好之后（agent 可能已经在了）通知装工具的一方。 */
  readonly onRegistered: (session: PodSession) => void
}

/**
 * Pod 管理的会话登记表：哪条 dsh 会话属于哪个 bot、哪个房间或任务。
 * 人设按会话组一次并缓存，这段会话的提示词前缀就不会变，能命中缓存。
 */
export class SessionRegistry {
  private sessions: ReadonlyMap<string, PodSession>
  /** 正在创建、dsh 还没返回的会话：agent/created 可能比 create 返回得早。 */
  private pending: ReadonlyMap<string, PodSession> = new Map()
  private readonly personas = new Map<string, string>()
  private readonly deps: SessionRegistryDeps

  constructor(deps: SessionRegistryDeps) {
    this.deps = deps
    this.sessions = new Map(listSessions(deps.db, { activeOnly: false }).map((session) => [session.id, session]))
  }

  get(id: string): PodSession | undefined {
    return this.sessions.get(id) ?? this.pending.get(id)
  }

  all(): readonly PodSession[] {
    return [...this.sessions.values()]
  }

  active(): readonly PodSession[] {
    return this.all().filter((session) => session.status === 'active')
  }

  activeForRoom(roomId: string, botId: string): PodSession | undefined {
    return this.active()
      .filter((session) => session.kind === 'chat' && session.roomId === roomId && session.botId === botId)
      .sort((left, right) => right.segment - left.segment)[0]
  }

  activeForTask(taskId: string, kind: SessionKind): PodSession | undefined {
    return this.active()
      .filter((session) => session.kind === kind && session.taskId === taskId)
      .sort((left, right) => right.segment - left.segment)[0]
  }

  forTask(taskId: string): readonly PodSession[] {
    return this.all().filter((session) => session.taskId === taskId)
  }

  /** 某个 bot 在某个根任务下的咨询会话（回答 ask_bot 用，同一个根任务复用一条）。 */
  activeConsult(botId: string, rootId: string | null): PodSession | undefined {
    return this.active().find((session) => session.kind === 'consult' && session.botId === botId && session.taskId === rootId)
  }

  /** 新开一条会话：先登记（agent/created 时能认出来），再让 dsh 创建，最后落库。 */
  async open(spec: OpenSessionSpec): Promise<PodSession> {
    const { db, factory, now } = this.deps
    mkdirSync(join(factory.workspaceRoot, spec.folder), { recursive: true })
    const profile = spec.ceiling === undefined ? spec.bot.toolProfile : intersectProfiles(spec.bot.toolProfile, spec.ceiling)
    const preset = PROFILE_PRESETS[profile]
    const draft = (id: string): PodSession => ({
      id,
      botId: spec.bot.id,
      kind: spec.kind,
      roomId: spec.roomId,
      taskId: spec.taskId,
      segment: spec.segment ?? 1,
      preset,
      folder: spec.folder,
      status: 'active',
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      contextTokens: 0,
      cost: 0,
      steps: 0,
      tainted: spec.tainted ?? false,
      createdAt: now(),
      lastActiveAt: now(),
      retiredAt: null,
    })
    const candidates: string[] = []
    let sessionId: string
    try {
      sessionId = await factory.create({
        preset,
        title: spec.title,
        model: await this.deps.modelFor(spec.bot),
        ...(spec.reuse === undefined ? {} : { reuse: spec.reuse }),
        beforeCreate: (id) => {
          candidates.push(id)
          this.pending = new Map([...this.pending, [id, draft(id)]])
        },
      })
    } finally {
      this.pending = new Map([...this.pending].filter(([id]) => !candidates.includes(id)))
    }
    const record = insertSession(db, {
      id: sessionId,
      botId: spec.bot.id,
      kind: spec.kind,
      roomId: spec.roomId,
      taskId: spec.taskId,
      segment: spec.segment ?? 1,
      preset,
      folder: spec.folder,
      tainted: spec.tainted ?? false,
      now: now(),
    })
    this.sessions = new Map([...this.sessions, [record.id, record]])
    this.deps.onRegistered(record)
    return record
  }

  retire(id: string): void {
    const current = this.sessions.get(id)
    if (current === undefined) return
    retireSession(this.deps.db, id, this.deps.now())
    this.sessions = new Map([...this.sessions, [id, { ...current, status: 'retired', retiredAt: this.deps.now() }]])
    this.personas.delete(id)
  }

  /** 这段会话冻结的人设；第一次用时组好缓存起来。 */
  persona(id: string): string | undefined {
    const session = this.get(id)
    if (session === undefined) return undefined
    const cached = this.personas.get(id)
    if (cached !== undefined) return cached
    const composed = this.deps.compose(session)
    this.personas.set(id, composed)
    return composed
  }

  /** agent 释放后下次冷恢复时重新组人设（名册、记忆可能变了）。 */
  forgetPersona(id: string): void {
    this.personas.delete(id)
  }

  markTainted(id: string): void {
    const current = this.sessions.get(id)
    if (current === undefined || current.tainted) return
    markSessionTainted(this.deps.db, id)
    this.sessions = new Map([...this.sessions, [id, { ...current, tainted: true }]])
  }

  addUsage(id: string, delta: SessionUsageDelta): void {
    const current = this.sessions.get(id)
    if (current === undefined) return
    addSessionUsage(this.deps.db, id, delta, this.deps.now())
    this.sessions = new Map([
      ...this.sessions,
      [
        id,
        {
          ...current,
          inputTokens: current.inputTokens + delta.inputTokens,
          outputTokens: current.outputTokens + delta.outputTokens,
          cacheTokens: current.cacheTokens + delta.cacheTokens,
          cost: current.cost + delta.cost,
          contextTokens: delta.contextTokens,
          lastActiveAt: this.deps.now(),
        },
      ],
    ])
  }

  addStep(id: string): void {
    const current = this.sessions.get(id)
    if (current === undefined) return
    addSessionSteps(this.deps.db, id, 1, this.deps.now())
    this.sessions = new Map([...this.sessions, [id, { ...current, steps: current.steps + 1, lastActiveAt: this.deps.now() }]])
  }
}
