import type { PodSession, TaskActivity } from 'pod-domain'
import type { AssistantStreamFrame, HostContext, SessionEvent } from '../dsh.ts'
import { describeToolCall, TAINTING_TOOLS } from './actions.ts'
import { textOf } from './messages.ts'
import type { SessionRegistry } from './registry.ts'

/** 最近动作保留几条。 */
const RECENT_ACTIONS = 5

/** 打字流最快多久推一次。 */
const STREAM_THROTTLE_MS = 120

export interface UsageReport {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly provider: string
  readonly model: string
}

export interface ObserverHooks {
  /** 这一步模型说了话（不含工具调用）。 */
  readonly onAssistantText: (session: PodSession, text: string, turn: number) => void
  /** 你在 dsh 的会话视图里直接打的字（不是 Pod 投进去的）。 */
  readonly onOwnerTyped: (session: PodSession, text: string, messageId: string) => void
  readonly onTurnEnd: (session: PodSession, reason: string) => void
  readonly onToolCall: (session: PodSession, name: string, action: string, args: string) => void
  readonly onUsage: (session: PodSession, usage: UsageReport) => void
  readonly onStream: (session: PodSession, text: string, done: boolean) => void
  readonly onActivity: (session: PodSession, activity: TaskActivity) => void
  readonly isPodDelivery: (messageId: string) => boolean
  /** 会话收到了一条消息（Pod 投的或你在 dsh 里打的），messageId 是投递时的 id。 */
  readonly onDelivered?: (session: PodSession, messageId: string) => void
}

interface StreamState {
  attemptId: string
  text: string
  lastSent: number
  timer: ReturnType<typeof setTimeout> | undefined
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {}
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * 观察 Pod 会话的事件：生成实时动态（第几步、最近动作、几秒前有动作），
 * 把 bot 说的话交给房间，记用量，标污染。
 * dsh 在写会话日志的过程中同步触发 session/event，回调里不能再往同一会话投消息，
 * 所以这里只排队，下一拍再处理。
 */
export class SessionObserver {
  private readonly activity = new Map<string, TaskActivity>()
  private readonly streams = new Map<string, StreamState>()
  private readonly queue: (() => void)[] = []
  private scheduled = false
  private readonly ctx: HostContext
  private readonly registry: SessionRegistry
  private readonly hooks: ObserverHooks
  private readonly now: () => number

  constructor(ctx: HostContext, registry: SessionRegistry, hooks: ObserverHooks, now: () => number) {
    this.ctx = ctx
    this.registry = registry
    this.hooks = hooks
    this.now = now
  }

  start(): () => void {
    const offEvent = this.ctx.on(
      'session/event',
      (session, event) => {
        if (this.registry.get(session.id) === undefined) return
        this.later(() => this.handle(session.id, event))
      },
      { global: true },
    )
    const offStream = this.ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      const session = this.registry.get(agent.session.id)
      if (session === undefined || session.kind !== 'chat') return
      this.stream(session, frame)
    })
    const offStatus = this.ctx.on('agent/status', ({ agent, status }) => {
      const session = this.registry.get(agent.session.id)
      if (session === undefined) return
      this.later(() => this.update(session, { running: status === 'running' }))
    })
    return () => {
      offEvent()
      offStream()
      offStatus()
      for (const state of this.streams.values()) if (state.timer !== undefined) clearTimeout(state.timer)
    }
  }

  activityOf(sessionId: string): TaskActivity | undefined {
    return this.activity.get(sessionId)
  }

  /** 看门狗或停滞检测改状态用。 */
  markStalled(sessionId: string, stalled: boolean): void {
    const session = this.registry.get(sessionId)
    if (session !== undefined) this.update(session, { stalled })
  }

  private later(work: () => void): void {
    this.queue.push(work)
    if (this.scheduled) return
    this.scheduled = true
    setImmediate(() => {
      this.scheduled = false
      const batch = this.queue.splice(0)
      for (const item of batch) {
        try {
          item()
        } catch (error) {
          this.ctx.logger.warn('Pod 处理会话事件出错', error)
        }
      }
    })
  }

  private current(session: PodSession): TaskActivity {
    return (
      this.activity.get(session.id) ?? {
        sessionId: session.id,
        running: false,
        turn: 0,
        steps: session.steps,
        actions: [],
        current: null,
        lastEventAt: null,
        stalled: false,
      }
    )
  }

  private update(session: PodSession, patch: Partial<TaskActivity>): void {
    const next: TaskActivity = { ...this.current(session), ...patch, lastEventAt: this.now() }
    this.activity.set(session.id, next)
    this.hooks.onActivity(session, next)
  }

  private handle(sessionId: string, event: SessionEvent): void {
    const session = this.registry.get(sessionId)
    if (session === undefined) return
    const data = record(event.data)
    switch (event.type) {
      case 'turn/start':
        this.update(session, { running: true, turn: num(data.turn) })
        return
      case 'step/start':
        this.registry.addStep(session.id)
        this.update(session, { steps: this.current(session).steps + 1, stalled: false })
        return
      case 'tool/call': {
        const name = typeof data.name === 'string' ? data.name : 'tool'
        const args = typeof data.arguments === 'string' ? data.arguments : ''
        const action = describeToolCall(name, args)
        if (TAINTING_TOOLS.has(name) || name.startsWith('browser_')) this.registry.markTainted(session.id)
        const actions = [...this.current(session).actions, action].slice(-RECENT_ACTIONS)
        this.update(session, { actions, current: action })
        this.hooks.onToolCall(session, name, action, args)
        return
      }
      case 'tool/result':
        this.update(session, { current: null })
        return
      case 'assistant/message':
        this.assistant(session, data)
        return
      case 'user/message': {
        const id = typeof data.id === 'string' ? data.id : ''
        if (id !== '') this.hooks.onDelivered?.(session, id)
        const source = record(data.source)
        if (source.kind !== 'user' || id === '' || this.hooks.isPodDelivery(id)) return
        const text = textOf(data.content).trim()
        if (text !== '') this.hooks.onOwnerTyped(session, text, id)
        return
      }
      case 'turn/end': {
        const reason = typeof record(data.reason).kind === 'string' ? String(record(data.reason).kind) : 'completed'
        this.update(session, { running: false, current: null })
        this.hooks.onStream(session, '', true)
        this.hooks.onTurnEnd(session, reason)
        return
      }
      default:
        return
    }
  }

  private assistant(session: PodSession, data: Readonly<Record<string, unknown>>): void {
    const message = record(data.message)
    const source = record(message.source)
    const usage = record(data.usage)
    if (Object.keys(usage).length > 0) {
      this.hooks.onUsage(session, {
        inputTokens: num(usage.inputTokens),
        outputTokens: num(usage.outputTokens),
        cacheReadTokens: num(usage.cacheReadTokens),
        provider: typeof source.provider === 'string' ? source.provider : '',
        model: typeof source.model === 'string' ? source.model : '',
      })
    }
    const text = textOf(message.content).trim()
    if (text !== '') this.hooks.onAssistantText(session, text, num(data.turn))
  }

  private stream(session: PodSession, frame: AssistantStreamFrame): void {
    if (frame.type === 'start') {
      this.streams.set(session.id, { attemptId: frame.attemptId, text: '', lastSent: 0, timer: undefined })
      return
    }
    const state = this.streams.get(session.id)
    if (state === undefined || state.attemptId !== frame.attemptId) return
    if (frame.type === 'end') {
      if (state.timer !== undefined) clearTimeout(state.timer)
      this.streams.delete(session.id)
      return
    }
    const chunk = frame.chunk
    if (chunk.type !== 'text-delta' || typeof chunk.text !== 'string') return
    state.text += chunk.text
    const flush = (): void => {
      state.timer = undefined
      state.lastSent = this.now()
      this.hooks.onStream(session, state.text, false)
    }
    if (this.now() - state.lastSent >= STREAM_THROTTLE_MS) flush()
    else if (state.timer === undefined) state.timer = setTimeout(flush, STREAM_THROTTLE_MS)
  }
}
