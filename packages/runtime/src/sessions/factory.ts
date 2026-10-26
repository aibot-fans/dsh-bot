import { mkdirSync } from 'node:fs'
import { newSessionId } from 'pod-domain'
import type { ModelSelection, SessionController, SessionCreateRequest, WorkspaceRegistry } from '../dsh.ts'

/** Pod 在 dsh 里登记的工作区标题；Pod 的所有会话都在这个工作区下。 */
export const POD_WORKSPACE_TITLE = 'dsh-bot'

/** 改名前的工作区标题：dsh 对登记过的目录不改标题，还是这个（用户没自己改过）就换成新名字。 */
const OLD_WORKSPACE_TITLE = 'DeepSeek Pod'

export interface SessionFactoryDeps {
  readonly workspaceRoot: string
  readonly sessions: SessionController
  readonly workspaces: WorkspaceRegistry
  readonly warn: (message: string) => void
}

export interface CreateSessionOptions {
  /** agent 预设：pod-talk / pod-research / pod。 */
  readonly preset: string
  /** 想复用的空白会话（同一个 bot 最近一次还没说过话的单聊）。 */
  readonly reuse?: string
  /** dsh 侧栏里显示的标题。 */
  readonly title?: string
  /** 指定模型；不填就用 dsh 的默认模型。 */
  readonly model?: ModelSelection | null
  /**
   * 会话 id 定下之后、dsh 创建 agent 之前调用。Pod 在这里登记“这个会话属于谁”，
   * 这样 agent/created 触发时就能装上对应的人设和工具。
   */
  readonly beforeCreate?: (sessionId: string) => void
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 在 Pod 的 dsh 工作区里创建会话。
 * dsh 按会话的工作目录把会话归到工作区，不属于任何工作区的会话在对话界面里发不了消息，
 * 所以第一次用时先在 Pod 的工作目录登记一个工作区，之后一直复用。
 */
export class SessionFactory {
  private podWorkspaceId: string | undefined
  private readonly deps: SessionFactoryDeps

  constructor(deps: SessionFactoryDeps) {
    this.deps = deps
  }

  get workspaceRoot(): string {
    return this.deps.workspaceRoot
  }

  async workspaceId(): Promise<string> {
    if (this.podWorkspaceId !== undefined) return this.podWorkspaceId
    mkdirSync(this.deps.workspaceRoot, { recursive: true })
    const workspace = await this.deps.workspaces.create(this.deps.workspaceRoot, POD_WORKSPACE_TITLE)
    // 只是显示的名字，改不成不影响建会话。
    if (workspace.title === OLD_WORKSPACE_TITLE && workspace.setTitle !== undefined) await workspace.setTitle(POD_WORKSPACE_TITLE).catch(() => undefined)
    this.podWorkspaceId = workspace.id
    return workspace.id
  }

  /**
   * 依次尝试：复用指定的空白会话 → 用新的 pod- 开头的 id。
   * 旧会话属于别的目录或已被占用时，dsh 会拒绝复用，这时退到下一步。
   * @returns 实际使用的会话 id。
   */
  async create(options: CreateSessionOptions): Promise<string> {
    const workspaceId = await this.workspaceId()
    const base: SessionCreateRequest = { workspaceId, agentPreset: options.preset }
    const candidates = [...(options.reuse === undefined ? [] : [options.reuse]), newSessionId()]
    let lastError: unknown
    for (const candidate of candidates) {
      options.beforeCreate?.(candidate)
      try {
        const created = await this.deps.sessions.create({ ...base, sessionId: candidate })
        if (created.sessionId !== candidate) options.beforeCreate?.(created.sessionId)
        await this.decorate(created.sessionId, options)
        return created.sessionId
      } catch (error) {
        lastError = error
        this.deps.warn(`创建会话没成功，换一种方式再试：${errorText(error)}`)
      }
    }
    throw lastError
  }

  /** 标题和模型是锦上添花：失败只告警，不影响会话本身。 */
  private async decorate(sessionId: string, options: CreateSessionOptions): Promise<void> {
    if (options.title !== undefined) {
      try {
        await this.deps.sessions.rename({ sessionId, title: options.title })
      } catch (error) {
        this.deps.warn(`给会话起标题失败：${errorText(error)}`)
      }
    }
    if (options.model !== undefined && options.model !== null) {
      try {
        await this.deps.sessions.selectModel({ sessionId, ...options.model })
      } catch (error) {
        this.deps.warn(`给会话选模型失败：${errorText(error)}`)
      }
    }
  }
}
