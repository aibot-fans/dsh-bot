import type { DatabaseSync } from 'node:sqlite'
import { laneOf, maskSecrets, newId, t, type Lane, type PodSettings } from 'pod-domain'
import {
  bumpDeliveryAttempt,
  dropUndelivered,
  insertDelivery,
  markHanded,
  markReadFor,
  markTaken,
  pendingFor,
  requeueUntaken,
  sessionsWithPending,
  transaction,
  type Delivery,
  type DeliveryMode,
} from 'pod-store'
import type { AgentRegistry, LiveAgent, MessageSource, SessionController } from '../dsh.ts'
import type { DeliveryLedger } from './ledger.ts'
import { Later, type Effects } from './queue.ts'
import { storedMessage, toUserMessage } from '../agents/messages.ts'
import type { SessionRegistry } from '../agents/registry.ts'

/** 同时最多给几条会话交消息。 */
const DELIVER_CONCURRENCY = 4

/** 按待投消息里最急的那条排：你的话先交。 */
const BY_PRIORITY = "(SELECT MIN(priority) FROM deliveries WHERE deliveries.session_id = effects.key AND deliveries.status = 'pending')"

export interface DispatcherDeps {
  readonly db: DatabaseSync
  readonly agents: AgentRegistry
  readonly sessions: SessionController
  readonly registry: SessionRegistry
  readonly effects: Effects
  readonly ledger: DeliveryLedger
  readonly settings: () => PodSettings
  readonly now: () => number
}

export interface EnqueueRequest {
  readonly sessionId: string
  readonly mode: DeliveryMode
  readonly priority: number
  readonly text: string
  readonly source: MessageSource
}

function errorText(error: unknown): string {
  return maskSecrets(error instanceof Error ? error.message : String(error)).text.slice(0, 500)
}

/** dsh 说这条会话不存在了（日志删了）：不用再试。 */
function missing(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /NotFound|not found|不存在/i.test(text)
}

/**
 * 持久邮箱加两个并发通道，送达由副作用队列去做（每条会话一行，key 是会话 id）。
 * - 每条消息先落库并登记送达，提交后才交；重启后没交出的接着交，交了没收进历史的查过再重交。
 * - 每条消息最多进会话一次：交之前查收件箱和历史，交完等 dsh 落盘才记“已交出”。
 * - 会话空闲时投 followup/steer 会开启新一轮，这要占通道名额：聊天通道保留名额，任务再多你说话也不用排队；
 *   超出的按优先级往后排，不拒绝。会话正在运行时投递不占新名额，它会在下一步或下一轮收到。
 * - inject 不唤醒会话，不占名额。
 * - 交不出去就一直退避重试（2 秒起翻倍，最多 1 分钟一次）；给任务的显示在任务上，别的连续失败进系统问题。会话已不在就撤销。
 */
export class Dispatcher {
  private readonly running = new Set<string>()
  private stopped = false
  private readonly deps: DispatcherDeps

  constructor(deps: DispatcherDeps) {
    this.deps = deps
    deps.effects.handle('deliver', (_payload, row) => this.deliver(row.key), {
      limit: () => DELIVER_CONCURRENCY,
      retry: [2000, 60_000],
      quiet: (key) => {
        const kind = this.deps.registry.get(key)?.kind
        return kind === 'task' || kind === 'coord'
      },
      order: BY_PRIORITY,
    })
  }

  /** Pod 停止时先叫停：库马上要关，之后不再交；没交出的留在库里，下次启动接着交。 */
  stop(): void {
    this.stopped = true
  }

  enqueue(request: EnqueueRequest): Delivery {
    const session = this.deps.registry.get(request.sessionId)
    const lane: Lane = session === undefined ? 'background' : laneOf(session.kind)
    return transaction(this.deps.db, () => {
      const delivery = insertDelivery(this.deps.db, {
        id: newId('dlv'),
        sessionId: request.sessionId,
        mode: request.mode,
        lane,
        priority: request.priority,
        message: storedMessage(request.text, request.source),
        createdAt: this.deps.now(),
      })
      this.deps.effects.enqueue('deliver', request.sessionId)
      return delivery
    })
  }

  /** agent 状态变化时由观察者告诉这里；空闲了就腾出名额，往后排着的马上再试。 */
  setRunning(sessionId: string, running: boolean): void {
    const changed = running ? !this.running.has(sessionId) : this.running.has(sessionId)
    if (running) this.running.add(sessionId)
    else this.running.delete(sessionId)
    if (changed && !running) this.deps.effects.release('deliver')
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId) || this.deps.agents.get(sessionId)?.status === 'running'
  }

  /** 停掉一条会话：没交出的撤回，交出了还没收进历史的也算没读，不再重交。 */
  cancelPending(sessionId: string): number {
    return dropUndelivered(this.deps.db, sessionId, t('会话停了'))
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

  /** 你点了“重试”：这条会话交不出去的消息马上再交。 */
  retry(sessionId: string): void {
    if (!this.deps.effects.retry('deliver', sessionId)) this.deps.effects.enqueue('deliver', sessionId)
  }

  /** 看一眼有没有能交的（新 agent 接上、定时器到点）。 */
  pump(): Promise<void> {
    this.deps.effects.kick()
    return Promise.resolve()
  }

  /** 会话把一条消息收进了历史（观察者看到带这个 id 的 user/message）。 */
  taken(sessionId: string, messageId: string): void {
    this.deps.ledger.saw(sessionId, messageId)
    markTaken(this.deps.db, sessionId, messageId, this.deps.now())
  }

  /** 一轮结束：这一轮之前收进历史的都算读过。 */
  turnEnded(sessionId: string): void {
    markReadFor(this.deps.db, sessionId, this.deps.now())
  }

  /** 重启后：交了没收进历史的改回待投，有待投消息的会话都登记一次送达。 */
  recover(): void {
    const active = this.deps.registry.active().map((session) => session.id)
    transaction(this.deps.db, () => {
      requeueUntaken(this.deps.db, active)
      for (const sessionId of sessionsWithPending(this.deps.db)) this.deps.effects.enqueue('deliver', sessionId)
    })
  }

  /** 送达：把这条会话等着的消息按优先级依次交出。 */
  private async deliver(sessionId: string): Promise<void> {
    for (;;) {
      if (this.stopped) throw new Later()
      const delivery = pendingFor(this.deps.db, sessionId)[0]
      if (delivery === undefined) return
      const session = this.deps.registry.get(sessionId)
      if (session === undefined || session.status === 'retired') {
        dropUndelivered(this.deps.db, sessionId, t('会话已不在'))
        return
      }
      const reserved = delivery.mode !== 'inject' && !this.isRunning(sessionId)
      if (reserved) {
        if (!this.capacity(delivery.lane)) throw new Later()
        // 先占住名额，不等 agent/status 事件：查名额和占名额之间不会插进别的会话，不会超发。
        this.running.add(sessionId)
      }
      try {
        const agent = await this.resolve(sessionId)
        if (this.stopped) throw new Later()
        await this.hand(agent, delivery)
        markHanded(this.deps.db, delivery.id, this.deps.now())
      } catch (error) {
        if (reserved) this.running.delete(sessionId)
        if (error instanceof Later || this.stopped) throw error
        if (missing(error)) {
          dropUndelivered(this.deps.db, sessionId, t('会话已不在'))
          return
        }
        bumpDeliveryAttempt(this.deps.db, delivery.id, errorText(error))
        throw error
      }
    }
  }

  private async resolve(sessionId: string): Promise<LiveAgent> {
    const live = this.deps.agents.get(sessionId)
    if (live !== undefined) return live
    const resolved = await this.deps.sessions.resolveAgent(sessionId)
    if ('agent' in resolved) return resolved.agent
    throw resolved.error instanceof Error ? resolved.error : new Error(String(resolved.error))
  }

  /** 交一条：已经在收件箱或历史里就不再交；交完等落盘。以前交出过的（重启前）才查历史。 */
  private async hand(agent: LiveAgent, delivery: Delivery): Promise<void> {
    const before = delivery.handedAt !== null || delivery.attempts > 0
    if (!(await this.deps.ledger.holds(agent, delivery.message.id, before))) {
      const message = toUserMessage(delivery.message)
      if (delivery.mode === 'inject') agent.inject(message)
      else if (delivery.mode === 'steer') agent.steer(message)
      else agent.followup(message)
    }
    await this.deps.ledger.flush()
  }
}
