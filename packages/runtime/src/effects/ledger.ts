import type { LiveAgent, SessionLogHandle, SessionPersistenceLike } from '../dsh.ts'

/** 一次读多少条会话事件。 */
const PAGE = 512

interface Seen {
  readonly ids: Set<string>
  loaded?: Promise<void>
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {}
}

/** 释放只读句柄；拿不到 Symbol.asyncDispose 的旧运行时就算了（只读句柄不占东西）。 */
export async function release(handle: SessionLogHandle): Promise<void> {
  const key = (Symbol as unknown as { readonly asyncDispose?: symbol }).asyncDispose
  const dispose = key === undefined ? undefined : (handle as unknown as Record<symbol, unknown>)[key]
  if (typeof dispose === 'function') await (dispose as () => Promise<void>).call(handle)
}

/**
 * 每条消息最多进会话一次：交之前查收件箱（还没进历史的）和会话历史（日志里的 user/message），有同一个 id 就不再交；
 * 交完等 dsh 落盘才算交出。历史按会话读一次缓存起来，之后靠观察者看到的 user/message 补上。
 * 照原型 src/app/delivery.ts 的做法；dsh 没有这两个接口时退回不查重。
 */
export class DeliveryLedger {
  private readonly seen = new Map<string, Seen>()
  private readonly persistence: () => SessionPersistenceLike | undefined

  constructor(persistence: () => SessionPersistenceLike | undefined) {
    this.persistence = persistence
  }

  /** 能查会话历史、能等落盘吗（兼容检查和健康里显示）。 */
  get available(): boolean {
    const service = this.persistence()
    return typeof service?.flush === 'function' && typeof service.open === 'function'
  }

  /** 观察者看到会话收进了一条消息。 */
  saw(sessionId: string, messageId: string): void {
    this.seen.get(sessionId)?.ids.add(messageId)
  }

  forget(sessionId: string): void {
    this.seen.delete(sessionId)
  }

  /** 收件箱里有没有：还没进历史、排着等下一轮或下一步的。 */
  pending(agent: LiveAgent, messageId: string): boolean {
    const inbox = agent.inbox
    if (inbox === undefined) return false
    return inbox.nextTurn.some((message) => message.id === messageId) || inbox.nextStep.some((message) => message.id === messageId)
  }

  /**
   * 这条消息已经在会话里了吗。checkHistory 只在这条以前交出过（比如重启前）时才需要：
   * 新消息的 id 是新生成的，不可能在历史里，省得每次都读日志。
   */
  async holds(agent: LiveAgent, messageId: string, checkHistory: boolean): Promise<boolean> {
    if (this.pending(agent, messageId)) return true
    if (!checkHistory) return false
    const ids = await this.history(agent.session.id)
    return ids.has(messageId)
  }

  /** 等 dsh 把交出去的消息写进会话日志。 */
  async flush(): Promise<void> {
    const service = this.persistence()
    if (typeof service?.flush === 'function') await service.flush()
  }

  private async history(sessionId: string): Promise<ReadonlySet<string>> {
    const state = this.seen.get(sessionId) ?? { ids: new Set<string>() }
    this.seen.set(sessionId, state)
    state.loaded ??= this.load(sessionId, state.ids).catch((error: unknown) => {
      state.loaded = undefined
      throw error
    })
    await state.loaded
    return state.ids
  }

  private async load(sessionId: string, ids: Set<string>): Promise<void> {
    const service = this.persistence()
    if (service === undefined || typeof service.open !== 'function') return
    await this.flush()
    const handle = await service.open(sessionId, 'read')
    try {
      for (let offset = 0; ; ) {
        const { events } = await handle.read(offset, PAGE)
        if (events.length === 0) break
        for (const event of events) {
          if (event.type !== 'user/message') continue
          const id = record(event.data).id
          if (typeof id === 'string' && id !== '') ids.add(id)
        }
        offset += events.length
      }
    } finally {
      await release(handle)
    }
  }
}
