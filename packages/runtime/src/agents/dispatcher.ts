import type { DatabaseSync } from 'node:sqlite'
import { laneOf, newId, type Lane, type PodSettings } from 'pod-domain'
import {
  bumpDeliveryAttempt,
  cancelPendingFor,
  insertDelivery,
  markDelivery,
  pendingDeliveries,
  type Delivery,
  type DeliveryMode,
} from 'pod-store'
import type { LiveAgent, MessageSource, SessionController, AgentRegistry } from '../dsh.ts'
import { storedMessage, toUserMessage } from './messages.ts'
import type { SessionRegistry } from './registry.ts'

/** 投递失败（会话恢复不了）重试几次后放弃。 */
const MAX_ATTEMPTS = 6

export interface DispatcherDeps {
  readonly db: DatabaseSync
  readonly agents: AgentRegistry
  readonly sessions: SessionController
  readonly registry: SessionRegistry
  readonly settings: () => PodSettings
  readonly now: () => number
  readonly warn: (message: string) => void
}

export interface EnqueueRequest {
  readonly sessionId: string
  readonly mode: DeliveryMode
  readonly priority: number
  readonly text: string
  readonly source: MessageSource
}

/**
 * 持久邮箱加两个并发通道。
 * - 每条消息先落库，再投递；重启后没投出去的接着投。
 * - 会话空闲时投 followup/steer 会开启新一轮，这要占通道名额：聊天通道保留名额，任务再多你说话也不用排队；
 *   超出的按优先级排队，不拒绝。会话正在运行时投递不占新名额，它会在下一步或下一轮收到。
 * - inject 不唤醒会话，不占名额。
 */
export class Dispatcher {
  private readonly running = new Set<string>()
  private pumping: Promise<void> | undefined
  private again = false
  private stopped = false
  private readonly deps: DispatcherDeps

  constructor(deps: DispatcherDeps) {
    this.deps = deps
  }

  /** Pod 停止时先叫停：库马上要关，之后不再投递；没投出去的留在库里，下次启动接着投。 */
  stop(): void {
    this.stopped = true
  }

  enqueue(request: EnqueueRequest): Delivery {
    const session = this.deps.registry.get(request.sessionId)
    const lane: Lane = session === undefined ? 'background' : laneOf(session.kind)
    const delivery = insertDelivery(this.deps.db, {
      id: newId('dlv'),
      sessionId: request.sessionId,
      mode: request.mode,
      lane,
      priority: request.priority,
      message: storedMessage(request.text, request.source),
      createdAt: this.deps.now(),
    })
    void this.pump()
    return delivery
  }

  /** agent 状态变化时由观察者告诉这里；空闲了就腾出名额。 */
  setRunning(sessionId: string, running: boolean): void {
    const changed = running ? !this.running.has(sessionId) : this.running.has(sessionId)
    if (running) this.running.add(sessionId)
    else this.running.delete(sessionId)
    if (changed && !running) void this.pump()
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId) || this.deps.agents.get(sessionId)?.status === 'running'
  }

  cancelPending(sessionId: string): number {
    return cancelPendingFor(this.deps.db, sessionId)
  }

  runningCount(lane: Lane): number {
    let count = 0
    for (const id of this.running) {
      const session = this.deps.registry.get(id)
      if (session !== undefined && laneOf(session.kind) === lane) count += 1
    }
    return count
  }

  private capacity(lane: Lane): boolean {
    const settings = this.deps.settings()
    if (lane === 'chat') return this.runningCount('chat') < settings.chatConcurrency
    const busy = this.runningCount('task') + this.runningCount('background')
    return busy < settings.taskConcurrency
  }

  /** 串行地把能投的都投出去；投递过程中又来了新消息，就再来一遍。 */
  pump(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.pumping !== undefined) {
      this.again = true
      return this.pumping
    }
    this.pumping = (async () => {
      try {
        do {
          this.again = false
          await this.pumpOnce()
        } while (this.again && !this.stopped)
      } catch (error) {
        // 停止时正在投的这一遍可能碰上刚关掉的库，不算错：报出去 dsh 会当成致命错误直接退出，后面的清理都会跳过。
        if (!this.stopped) throw error
      } finally {
        this.pumping = undefined
      }
    })()
    return this.pumping
  }

  private async pumpOnce(): Promise<void> {
    for (const delivery of pendingDeliveries(this.deps.db)) {
      if (this.stopped) return
      const session = this.deps.registry.get(delivery.sessionId)
      if (session === undefined || session.status === 'retired') {
        markDelivery(this.deps.db, delivery.id, 'cancelled', this.deps.now(), '会话已不在')
        continue
      }
      const wakes = delivery.mode !== 'inject'
      const idle = !this.isRunning(delivery.sessionId)
      if (wakes && idle && !this.capacity(delivery.lane)) continue
      const agent = await this.resolve(delivery)
      // 等会话恢复的时候 Pod 停了：这条先不投，免得投出去了却记不上，下次启动又投一遍。
      if (this.stopped) return
      if (agent === undefined) continue
      try {
        const message = toUserMessage(delivery.message)
        if (delivery.mode === 'inject') agent.inject(message)
        else if (delivery.mode === 'steer') agent.steer(message)
        else agent.followup(message)
        markDelivery(this.deps.db, delivery.id, 'sent', this.deps.now())
        // 先占住名额，不等 agent/status 事件，避免同一轮里超发。
        if (wakes) this.running.add(delivery.sessionId)
      } catch (error) {
        this.fail(delivery, error)
      }
    }
  }

  private async resolve(delivery: Delivery): Promise<LiveAgent | undefined> {
    const live = this.deps.agents.get(delivery.sessionId)
    if (live !== undefined) return live
    try {
      const resolved = await this.deps.sessions.resolveAgent(delivery.sessionId)
      if ('agent' in resolved) return resolved.agent
      this.fail(delivery, resolved.error)
    } catch (error) {
      this.fail(delivery, error)
    }
    return undefined
  }

  private fail(delivery: Delivery, error: unknown): void {
    const text = error instanceof Error ? error.message : String(error)
    if (delivery.attempts + 1 >= MAX_ATTEMPTS) {
      markDelivery(this.deps.db, delivery.id, 'failed', this.deps.now(), text)
      this.deps.warn(`给会话 ${delivery.sessionId} 投递消息失败，已放弃：${text}`)
    } else {
      bumpDeliveryAttempt(this.deps.db, delivery.id, text)
    }
  }
}
