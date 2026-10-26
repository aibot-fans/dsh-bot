import {
  PLAN_NUDGE_CALLS,
  PROFILE_PRESETS,
  fnv1a,
  readPlan,
  startProgress,
  stopThinking,
  summarizeRun,
  withCall,
  withPlan,
  withResult,
  withThought,
  type PodSession,
  type RunSummary,
  type TaskActivity,
  type TurnProgress,
} from 'pod-domain'
import type { AssistantStreamFrame, HostContext, SessionEvent, StreamChunk } from '../dsh.ts'
import { commandOf, describeToolCall, TAINTING_TOOLS } from './actions.ts'
import { textOf } from './messages.ts'
import type { SessionRegistry } from './registry.ts'

/** 最近动作保留几条。 */
const RECENT_ACTIONS = 5

/** 打字流最快多久推一次。 */
const STREAM_THROTTLE_MS = 120

/** 思考流最快多久更新一次进度；只留最后这么多字，够切出最后一句。 */
const THOUGHT_THROTTLE_MS = 500
const THOUGHT_TAIL = 600

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
  /** 一轮跑完了：这一轮的执行摘要（一步一行）。 */
  readonly onRunEnd?: (session: PodSession, run: RunSummary) => void
  /** 调用了好几次工具还没写计划：提醒 bot 列一个（每轮最多一次）。 */
  readonly onPlanMissing?: (session: PodSession) => void
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

function parsed(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

/** 工具结果算不算出错：dsh 标了 isError，Pod 的工具回了 ok:false，或者命令的退出码不是 0。 */
function failed(message: Readonly<Record<string, unknown>>): boolean {
  if (message.isError === true) return true
  const text = textOf(message.content)
  return /^\s*\{"ok":false\b/.test(text) || /\[exit code: [1-9]\d*\]/.test(text)
}

/** 有计划工具（todo_write）的会话：对话档案没有，咨询只回答问题。 */
function plans(session: PodSession): boolean {
  return session.preset !== PROFILE_PRESETS.talk && session.kind !== 'consult'
}

/**
 * 观察 Pod 会话的事件：生成实时动态（第几步、最近动作、几秒前有动作）和这一轮的执行进度（每一步、计划、正在想什么），
 * 把 bot 说的话交给房间，记用量，标污染。
 * dsh 在写会话日志的过程中同步触发 session/event，回调里不能再往同一会话投消息，
 * 所以这里只排队，下一拍再处理。
 */
export class SessionObserver {
  private readonly activity = new Map<string, TaskActivity>()
  private readonly streams = new Map<string, StreamState>()
  /** 思考流的最后一段，和等着更新进度的定时器。 */
  private readonly thoughts = new Map<string, string>()
  private readonly thoughtTimers = new Map<string, ReturnType<typeof setTimeout>>()
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
      if (session === undefined) return
      if (frame.type === 'chunk') this.thought(session, frame.chunk)
      if (session.kind === 'chat') this.stream(session, frame)
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
      for (const timer of this.thoughtTimers.values()) clearTimeout(timer)
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
          this.ctx.logger.warn('dsh-bot 处理会话事件出错', error)
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
        progress: null,
      }
    )
  }

  /** 这一轮的进度；Pod 是半路接上的（没看到这一轮开始）就从现在算起。 */
  private progressOf(session: PodSession, at: number): TurnProgress {
    return this.current(session).progress ?? startProgress(at, null)
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
    const at = event.time > 0 ? event.time : this.now()
    switch (event.type) {
      case 'turn/start':
        this.thoughts.delete(session.id)
        this.update(session, { running: true, turn: num(data.turn), progress: startProgress(at, this.current(session).progress) })
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
        const id = typeof data.callId === 'string' ? data.callId : `${at}`
        const step = { id, label: action, command: commandOf(name, args) ?? null, sig: fnv1a(`${name}:${args}`), startedAt: at, endedAt: null, ok: null }
        const plan = name === 'todo_write' ? readPlan(parsed(args)) : undefined
        const progress = plan === undefined ? withCall(this.progressOf(session, at), step) : withPlan(this.progressOf(session, at), plan, at)
        this.thoughts.delete(session.id)
        this.update(session, { actions, current: action, progress })
        this.hooks.onToolCall(session, name, action, args)
        if (progress.calls === PLAN_NUDGE_CALLS && progress.plan.length === 0 && plans(session)) this.hooks.onPlanMissing?.(session)
        return
      }
      case 'tool/result': {
        const message = record(data.message)
        const id = typeof message.toolCallId === 'string' ? message.toolCallId : ''
        const progress = this.current(session).progress
        this.update(session, { current: null, ...(progress === null ? {} : { progress: withResult(progress, id, !failed(message), at) }) })
        return
      }
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
        const progress = this.current(session).progress
        this.thoughts.delete(session.id)
        this.update(session, { running: false, current: null, ...(progress === null ? {} : { progress: stopThinking(progress, at) }) })
        this.hooks.onStream(session, '', true)
        if (progress !== null) this.hooks.onRunEnd?.(session, summarizeRun(progress, at))
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

  /**
   * 思考流：攒着最后一段，最多每 500 毫秒更新一次进度（“正在想：……”）；开始说话就算想完了。
   * 流的回调里不直接改状态，和会话事件一样排到下一拍。
   */
  private thought(session: PodSession, chunk: StreamChunk): void {
    if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
      this.thoughts.set(session.id, `${this.thoughts.get(session.id) ?? ''}${chunk.text}`.slice(-THOUGHT_TAIL))
      if (this.thoughtTimers.has(session.id)) return
      const timer = setTimeout(() => {
        this.thoughtTimers.delete(session.id)
        this.later(() => {
          const tail = this.thoughts.get(session.id)
          const progress = this.current(session).progress
          if (tail !== undefined && progress !== null) this.update(session, { progress: withThought(progress, tail, this.now()) })
        })
      }, THOUGHT_THROTTLE_MS)
      timer.unref()
      this.thoughtTimers.set(session.id, timer)
      return
    }
    const since = this.current(session).progress?.thinkingSince
    if (chunk.type !== 'text-delta' || since === null || since === undefined) return
    this.thoughts.delete(session.id)
    this.later(() => {
      const progress = this.current(session).progress
      if (progress !== null && progress.thinkingSince !== null) this.update(session, { progress: stopThinking(progress, this.now()) })
    })
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
