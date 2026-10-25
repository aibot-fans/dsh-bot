import type { DatabaseSync } from 'node:sqlite'
import { costOf, isDeepSeekPeak, type PodSession } from 'pod-domain'
import { insertUsage, usageByBotSince, usageForRoot, usageSince, type UsageTotals } from 'pod-store'
import type { UsageReport } from '../agents/observer.ts'
import type { SessionRegistry } from '../agents/registry.ts'

/** 用量记账：数字取自模型接口返回的实际用量，按 bot、任务、房间都能汇总。 */
export class UsageMeter {
  private readonly db: DatabaseSync
  private readonly registry: SessionRegistry
  private readonly rootOf: (taskId: string) => string | undefined
  private readonly now: () => number

  constructor(db: DatabaseSync, registry: SessionRegistry, rootOf: (taskId: string) => string | undefined, now: () => number) {
    this.db = db
    this.registry = registry
    this.rootOf = rootOf
    this.now = now
  }

  recordAgent(session: PodSession, usage: UsageReport): void {
    const peak = isDeepSeekPeak(this.now())
    const cost = costOf(usage.provider, usage.model, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
    }, peak)
    insertUsage(this.db, {
      sessionId: session.id,
      botId: session.botId,
      taskId: session.taskId,
      roomId: session.roomId,
      provider: usage.provider,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheTokens: usage.cacheReadTokens,
      cost: cost ?? null,
      peak,
      purpose: session.kind,
      now: this.now(),
    })
    this.registry.addUsage(session.id, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheTokens: usage.cacheReadTokens,
      cost: cost ?? 0,
      contextTokens: usage.inputTokens,
    })
  }

  /** 轻量调用（摘要、提取）的用量，不挂在会话上。 */
  recordLite(purpose: string, usage: UsageReport, owner: { readonly botId?: string; readonly taskId?: string } = {}): void {
    const peak = isDeepSeekPeak(this.now())
    const cost = costOf(usage.provider, usage.model, usage, peak)
    insertUsage(this.db, {
      sessionId: null,
      botId: owner.botId ?? null,
      taskId: owner.taskId ?? null,
      roomId: null,
      provider: usage.provider,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheTokens: usage.cacheReadTokens,
      cost: cost ?? null,
      peak,
      purpose,
      now: this.now(),
    })
  }

  forRoot(rootId: string): UsageTotals {
    return usageForRoot(this.db, rootId)
  }

  forTask(taskId: string): UsageTotals {
    const root = this.rootOf(taskId)
    return root === undefined ? { tokens: 0, cost: 0 } : usageForRoot(this.db, root)
  }

  since(time: number): UsageTotals {
    return usageSince(this.db, time)
  }

  byBotSince(time: number): ReadonlyMap<string, UsageTotals> {
    return usageByBotSince(this.db, time)
  }
}
