/**
 * Pod 用到的 dsh 宿主接口，写成最小的结构类型。
 *
 * 对应 dsh 0.2.1 的 dsh-client-connection（ctx.connection）、dsh-api-session-controller
 * （ctx.sessionController）、dsh-workspace（ctx.workspaceRegistry）、dsh-agent（ctx.agents、
 * Agent）、dsh-tools（ctx.tools）、dsh-system-prompt（ctx.systemPrompt）、dsh-llm（ctx.llm）、
 * dsh-skill（ctx.skills）和 dsh-session 的事件。这里只声明 Pod 真正调用的成员；不安装 dsh 的包，
 * 运行时也不 import 它们，避免和 dsh 自带的副本重复。dsh 升级时先核对这个文件。
 */

export type Disposer = () => void | Promise<void>

export interface Logger {
  info(...args: readonly unknown[]): void
  warn(...args: readonly unknown[]): void
}

// ---------- connection ----------

/** /api 共享通道上的一条精确路由；dsh 先做来源校验和登录校验，再交给 fetch。 */
export interface FetchRoute {
  readonly path: string
  readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
  readonly requestBody: 'buffered' | 'streaming'
  readonly fetch: (request: Request) => Promise<Response>
}

export interface HostConnection {
  readonly fetch: {
    register(route: FetchRoute): () => Promise<void>
  }
}

// ---------- 消息 ----------

export interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

/** dsh-llm 的内容块；Pod 只读写 text，其余原样透传。 */
export type ContentBlock = TextBlock | { readonly type: string; readonly [key: string]: unknown }

/** 消息来源。dsh 的会话界面认识 relay（agent 之间的消息）和 notice（一行说明）两种形态。 */
export interface MessageSource {
  readonly kind: string
  readonly form?: 'relay' | 'notice'
  readonly summary?: string
  readonly senderSessionId?: string
  readonly [key: string]: unknown
}

/** dsh-llm 的 UserMessage：带 id、冻结。Pod 自己组装，不调 createUserMessage。 */
export interface UserMessage {
  readonly id: string
  readonly role: 'user'
  readonly content: readonly ContentBlock[]
  readonly source: MessageSource
}

export interface TokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly reasoningTokens?: number
}

// ---------- session controller / workspace ----------

export interface SessionCreateRequest {
  readonly workspaceId?: string
  readonly cwd?: string
  readonly sessionId?: string
  readonly agentPreset?: string
}

export interface SessionCreateValue {
  readonly sessionId: string
  readonly agentPreset?: string
}

export interface ModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export interface ModelCatalogModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly reasoning?: {
    readonly efforts: readonly { readonly id: string; readonly label?: string; readonly name?: string }[]
    readonly defaultEffort?: string
  }
}

export interface ModelCatalog {
  readonly default: ModelSelection
  readonly routableProviders: readonly string[]
  readonly groups: readonly { readonly id: string; readonly name: string; readonly models: readonly ModelCatalogModel[] }[]
  readonly failures: readonly { readonly id: string; readonly name: string; readonly message: string }[]
}

export type ResolveAgentResult = { readonly agent: LiveAgent } | { readonly error: unknown }

export interface SessionController {
  create(request: SessionCreateRequest): Promise<SessionCreateValue>
  resolveAgent(sessionId: string): Promise<ResolveAgentResult>
  selectModel(request: ModelSelection & { readonly sessionId: string }): Promise<{ readonly selected: ModelSelection }>
  rename(request: { readonly sessionId: string; readonly title: string }): Promise<unknown>
  modelCatalog(): Promise<ModelCatalog>
}

export interface Workspace {
  readonly id: string
  readonly path: string
  /** dsh 侧栏里显示的标题。 */
  readonly title?: string
  /** 改标题；旧版本 dsh 可能没有。 */
  setTitle?(title: string): Promise<void>
}

/** dsh-workspace 的工作区登记表；会话按自己的工作目录归到工作区下。 */
export interface WorkspaceRegistry {
  /** 为一个已存在的目录登记工作区；同一目录重复调用返回原来那个，不改标题。 */
  create(path: string, title?: string): Promise<Workspace>
  /** 把会话归档（dsh 的会话列表里不再显示）；旧版本 dsh 没有这个方法。 */
  archiveSession?(sessionId: string, options?: { readonly stopActivity?: boolean }): unknown
}

// ---------- agent ----------

export type AgentStatus = 'idle' | 'running'

export type CancelCause =
  | { readonly kind: 'user' }
  | { readonly kind: 'hook'; readonly reason: string }

/** dsh-agent 的 Agent 句柄里 Pod 用到的部分。 */
export interface LiveAgent {
  readonly session: { readonly id: string }
  readonly status: AgentStatus
  readonly ctx: AgentScope
  followup(message: UserMessage): void
  steer(message: UserMessage): void
  inject(message: UserMessage): void
  cancel(cause: CancelCause, options?: { readonly keepInbox?: boolean }): void
  whenIdle(): Promise<void>
}

export interface AgentRegistry {
  get(id: string): LiveAgent | undefined
  list(): readonly LiveAgent[]
}

// ---------- tools ----------

/** dsh-tools 支持的 JSON Schema 子集：type/oneOf/properties/required/additionalProperties/items/enum/const 加注解。 */
export type JsonSchema = Readonly<Record<string, unknown>>

export interface ToolRunContext {
  readonly agent?: LiveAgent
  readonly signal: AbortSignal
  concludeTurn(): void
  deferContext(context: UserMessage): void
}

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: JsonSchema
  readonly output: {
    readonly schema: JsonSchema
    render(args: unknown, value: unknown): ContentBlock[]
  }
  readonly timeoutMs?: number
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  isConcurrencySafe?(args: unknown): boolean
}

export interface ToolRegistry {
  register(definition: ToolDefinition): () => void
  /** 返回字符串就拒绝这次调用；通过 agent.ctx 注册的只管这个 agent。 */
  guard(guard: (exec: { readonly name: string; readonly arguments?: unknown; readonly agent?: LiveAgent }) => string | undefined): () => void
}

// ---------- system prompt ----------

/** 提示词组装上下文；dsh-agent 给它补了正在组装的 agent。 */
export interface AssembleContext {
  readonly agent?: {
    readonly session: {
      readonly id: string
    }
  }
}

export interface PromptSection {
  readonly name: string
  readonly order: number
  readonly text: string | ((context: AssembleContext) => string)
  /** 关掉 {{变量}} 插值；人设是用户写的文字，原样放进提示词。 */
  readonly interpolate?: boolean
}

export interface SystemPrompt {
  section(section: PromptSection): () => void
  getSectionOrder(name: string): number
}

// ---------- llm ----------

export type StreamChunk =
  | { readonly type: 'text-delta'; readonly index: number; readonly text: string }
  | { readonly type: 'block-end'; readonly index: number; readonly block: ContentBlock }
  | { readonly type: 'usage'; readonly usage: TokenUsage }
  | { readonly type: 'finish'; readonly reason: unknown }
  | { readonly type: string; readonly [key: string]: unknown }

export interface ResolvedModelInfo {
  readonly provider: string
  readonly id: string
  readonly inputModalities?: readonly string[]
  readonly reasoning?: { readonly efforts: readonly { readonly id: string }[]; readonly defaultEffort?: string }
}

export interface PreparedCall {
  readonly config: Readonly<Record<string, unknown>> & { readonly provider: string; readonly model: string }
  stream(options: Readonly<Record<string, unknown>>): AsyncIterable<StreamChunk>
}

export interface LlmService {
  prepareCall(
    config: { readonly provider: string; readonly model: string; readonly maxTokens?: number },
    signal?: AbortSignal,
    configure?: (controls: Readonly<Record<string, unknown>>, model: ResolvedModelInfo) => Readonly<Record<string, unknown>>,
  ): Promise<PreparedCall>
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<ResolvedModelInfo>
}

// ---------- session 事件 ----------

export interface SessionEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

export interface SessionHandle {
  readonly id: string
}

export type AssistantStreamFrame =
  | { readonly type: 'start'; readonly attemptId: string; readonly turn: number; readonly step: number }
  | { readonly type: 'chunk'; readonly attemptId: string; readonly index: number; readonly chunk: StreamChunk }
  | { readonly type: 'end'; readonly attemptId: string; readonly outcome: { readonly kind: string } }

export type PreStepDecision = { readonly kind: 'reject' } | { readonly kind: 'enter'; readonly messages: readonly UserMessage[] }

/** Cordis 的事件订阅。 */
export interface EventHub {
  on(name: 'agent/created', listener: (payload: { readonly agent: LiveAgent }) => void): () => void
  on(name: 'agent/disposed', listener: (payload: { readonly agent: LiveAgent }) => void): () => void
  on(name: 'agent/status', listener: (payload: { readonly agent: LiveAgent; readonly status: AgentStatus }) => void): () => void
  on(
    name: 'agent/assistant-stream',
    listener: (payload: { readonly agent: LiveAgent; readonly frame: AssistantStreamFrame }) => void,
  ): () => void
  on(
    name: 'agent/pre-step',
    listener: (
      payload: { readonly agent: LiveAgent; readonly messages: readonly UserMessage[]; readonly turn: number; readonly step: number },
      next: () => Promise<PreStepDecision>,
    ) => Promise<PreStepDecision>,
  ): () => void
  on(
    name: 'session/event',
    listener: (session: SessionHandle, event: SessionEvent) => void,
    options?: { readonly global?: boolean },
  ): () => void
  /** 发一个 Cordis 事件给其他插件（例如 pod/task-updated）。 */
  emit?(name: string, ...args: readonly unknown[]): void
}

/** 某个 agent 自己的作用域：在这里注册的工具、提示词段只对这个 agent 生效，agent 释放时一起撤销。 */
export interface AgentScope {
  readonly tools: ToolRegistry
  readonly systemPrompt: SystemPrompt
  /** 取没在 inject 里声明的可选服务（例如技能注册表 skills）；直接读属性会被 Cordis 拒绝。 */
  get?(name: string): unknown
}

/** dsh 的技能注册表里 Pod 用到的部分；通过 agent 作用域注册的技能只给这个 agent 用。 */
export interface SkillRegistryLike {
  register(skill: Readonly<Record<string, unknown>>): () => void
}

/** 宿主插件拿到的 Cordis Context 里 Pod 用到的部分。 */
export interface HostContext extends EventHub {
  effect(execute: () => Disposer, label?: string): unknown
  provide(name: string, value: unknown): () => void
  /** 取一个没在 inject 里声明的可选服务；没有就是 undefined。 */
  get(name: string): unknown
  readonly logger: Logger
  readonly connection: HostConnection
  readonly sessionController: SessionController
  readonly workspaceRegistry: WorkspaceRegistry
  readonly agents: AgentRegistry
}
