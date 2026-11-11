import type { DatabaseSync } from 'node:sqlite'
import { OWNER, PRIORITY, maskSecrets, t, type Bot, type PodSession, type PodSettings, type RoutedMessage, type Task, type TaskRun } from 'pod-domain'
import { countRunning, getRun, latestDecisiveReport, runsByStatus, runsFor, taskConversationOf, topicMessagesSince, transaction } from 'pod-store'
import { noticeSource, relaySource } from '../agents/messages.ts'
import type { SessionRegistry } from '../agents/registry.ts'
import type { Rotation } from '../agents/segments.ts'
import type { BotService } from '../bots/service.ts'
import type { Engine } from '../engine/index.ts'
import { isTicket } from '../engine/index.ts'
import { runsWhilePaused } from '../engine/runs.ts'
import { CARD_LIMITS, clipCard } from '../core/cards.ts'
import type { MemoryHints, MemoryService } from '../memory/service.ts'
import { composeBrief, runBrief } from '../tasks/brief.ts'
import type { Dispatcher } from './delivery.ts'
import { Later, type Effects } from './queue.ts'

/** 开工连着失败几次，这次执行记失败。 */
const LAUNCH_FAILURES = 3

/** 你的消息、重试、继续唤醒的先开工，排在自动来源前面。 */
const OWNER_FIRST = "(CASE WHEN json_extract(effects.payload, '$.owner') THEN 0 ELSE 1 END)"

export interface LauncherDeps {
  readonly db: DatabaseSync
  readonly engine: Engine
  readonly effects: Effects
  readonly registry: SessionRegistry
  readonly dispatcher: Dispatcher
  readonly bots: BotService
  readonly settings: () => PodSettings
  /** 处理暂停了：先不开工（暂停处理那一阶段接上）。 */
  readonly paused: () => boolean
  /** 任务会话的上下文到了换段长度、这会儿也没在跑：开工前先换一段。 */
  readonly oversized: (session: PodSession) => boolean
  /** 换一段新的任务会话，带回交接笔记。 */
  readonly rotate: (task: Task, bot: Bot, old: PodSession) => Promise<Rotation>
  /** 和这次交代相关的几条记忆，附在开工说明后面。 */
  readonly memory: Pick<MemoryService, 'hintsFor' | 'used'>
  readonly warn: (message: string, error?: unknown) => void
}

/** 这次开工带进来的话（你在任务对话里说的、转来的后续）。 */
function runWords(run: TaskRun): readonly string[] {
  const raw = Array.isArray(run.detail.messages) ? run.detail.messages : []
  return raw.flatMap((item): string[] => {
    if (typeof item === 'string') return [item]
    const text = typeof item === 'object' && item !== null ? (item as { readonly text?: unknown }).text : undefined
    return typeof text === 'string' ? [text] : []
  })
}

function errorText(error: unknown): string {
  return maskSecrets(error instanceof Error ? error.message : String(error)).text.slice(0, 300)
}

/**
 * 开工（副作用 open，每个任务一行）：有空闲的任务名额才开，起任务会话（已经有就接着用同一个），
 * 送开工说明，执行记成进行中。名额沿用 taskConcurrency，另留 1 个给你的消息唤醒的任务。
 * 起会话临时失败从 5 秒退避到 300 秒，连着 3 次失败这次执行记失败。
 */
export class Launcher {
  private readonly deps: LauncherDeps

  constructor(deps: LauncherDeps) {
    this.deps = deps
    deps.effects.handle('open', (payload, row) => this.launch(String(payload.runId ?? ''), row.attempts), {
      limit: () => 2,
      retry: [5000, 300_000],
      quiet: () => true,
      order: OWNER_FIRST,
    })
  }

  /** 重启后：排着的执行都补登记开工（副作用表里已经有的不重复）。 */
  recover(): void {
    transaction(this.deps.db, () => {
      for (const run of runsByStatus(this.deps.db, 'queued')) {
        if (this.deps.effects.pending('open', run.taskId) !== undefined) continue
        this.deps.effects.enqueue('open', run.taskId, { runId: run.id, owner: run.reason === 'message' })
      }
    })
  }

  private async launch(runId: string, attempts: number): Promise<void> {
    const { db, engine } = this.deps
    const run = getRun(db, runId)
    if (run === undefined || run.status !== 'queued') return
    const task = engine.tickets.get(run.taskId)
    if (task === undefined || task.endedAt !== null) {
      engine.runs.end(run.id, 'stopped')
      return
    }
    if (this.deps.paused()) throw new Later()
    // 你让它先等等的：先排着不开工；你说的话（只回话）、继续、重试、现在跑一次照常开。
    if (task.pausedAt !== null && !runsWhilePaused(run.reason, run.detail)) return
    const reserve = run.detail.owner === true || run.reason === 'message' || run.reason === 'retry' || run.reason === 'resume' ? 1 : 0
    if (countRunning(db) >= this.deps.settings().taskConcurrency + reserve) throw new Later()
    const bot = task.ownerBotId === null ? undefined : this.deps.bots.get(task.ownerBotId)
    if (bot === undefined) {
      this.fail(task, run, t('负责的 bot 不在了'))
      return
    }
    let session: PodSession
    let fresh = false
    let preface = ''
    try {
      const existing = this.deps.registry.activeForTask(task.id, 'task')
      if (existing !== undefined && this.deps.oversized(existing)) {
        // 上一次执行留下的会话已经到了换段长度（常开任务一轮轮交了汇报，不会在执行中途换段）：换一段新的接着做。
        const rotation = await this.deps.rotate(task, bot, existing)
        session = rotation.session
        preface = rotation.preface
        fresh = true
      } else {
        fresh = existing === undefined
        session = existing ?? (await this.open(task, bot))
      }
    } catch (error) {
      if (attempts + 1 >= LAUNCH_FAILURES) {
        this.fail(task, run, t('开任务会话失败：{value}', { value: errorText(error) }))
        return
      }
      throw error
    }
    const hints = await this.hints(session, task, run, fresh)
    const sent = transaction(db, () => {
      const started = engine.runs.start(run.id, session.id)
      if (started === undefined) return false
      const current = engine.tickets.get(task.id) ?? task
      const delivery = this.deps.dispatcher.enqueue({
        sessionId: session.id,
        mode: 'followup',
        priority: run.reason === 'message' ? PRIORITY.owner : current.urgent ? PRIORITY.urgent : PRIORITY.task,
        text: [preface, this.briefFor(current, started, fresh), hints?.text ?? ''].filter((part) => part !== '').join('\n\n'),
        source: run.reason === 'new' ? relaySource(current.requesterSession ?? 'pod') : noticeSource(t('任务开始新的一次执行')),
      })
      // 这次执行带进去的消息，读没读过改看开工说明这次投递。
      engine.topics.rebind(run.id, delivery.id)
      return true
    })
    if (sent && hints !== undefined) this.deps.memory.used(session.id, hints.ids)
  }

  /**
   * 开工说明后面附的相关记忆：新任务（和换了一段新会话的）按标题、原话和交代找，接着说的按那几句话找；
   * 到点、重试、恢复这些不附。查不成不挡着开工。
   */
  private async hints(session: PodSession, task: Task, run: TaskRun, fresh: boolean): Promise<MemoryHints | undefined> {
    const words = run.reason === 'new' || fresh ? [task.title, ...(task.origin?.quotes ?? []).map((quote) => quote.text), task.brief] : run.reason === 'message' ? runWords(run) : []
    if (words.length === 0) return undefined
    try {
      return await this.deps.memory.hintsFor(session, words.join('\n'))
    } catch (error) {
      this.deps.warn(t('查相关记忆没成'), error)
      return undefined
    }
  }

  private open(task: Task, bot: Bot): Promise<PodSession> {
    return this.deps.registry.open({
      bot,
      kind: 'task',
      roomId: null,
      taskId: task.id,
      folder: task.folder,
      title: t('dsh-bot · 任务 · {title}', { title: task.title }),
      tainted: task.tainted,
    })
  }

  /** 开工说明：第一次是完整的任务说明；之后只说这次为什么开工。会话是新开的（例程第一次到点、旧会话换掉了）就两样都给。 */
  private briefFor(task: Task, run: TaskRun, fresh: boolean): string {
    if (run.reason !== 'new' && fresh) return `${this.kickoff(task, run)}\n\n${this.briefFor(task, run, false)}`
    if (run.reason === 'new') return this.kickoff(task, run)
    return runBrief(task, run, { lastReport: latestDecisiveReport(this.deps.db, task.id), watching: this.watching(task, run), talking: taskConversationOf(this.deps.db, task.rootId) !== undefined })
  }

  /** 完整的交代（会话是新开的、不是新任务时，先补上交代再写开工原因）。 */
  private kickoff(task: Task, run: TaskRun): string {
    const assumptions = Array.isArray(run.detail.assumptions) ? run.detail.assumptions.filter((item): item is string => typeof item === 'string') : []
    // 等别的子任务就绪才开工的：带上它们的结果。
    const upstream = task.dependsOn.flatMap((id) => {
      const before = this.deps.engine.tickets.get(id)
      return before?.result == null ? [] : [{ taskId: before.id, title: before.title, summary: before.result.summary, files: before.result.files }]
    })
    return composeBrief(task, { assumptions, conventions: [], upstream })
  }

  /** 只读跟进的话题里，上次开工以后（或者开始跟进以后）的新消息，每个话题最多 10 条。 */
  private watching(task: Task, run: TaskRun): readonly RoutedMessage[] {
    const previous = runsFor(this.deps.db, task.id)
      .filter((item) => item.id !== run.id && item.startedAt !== null)
      .reduce((latest, item) => Math.max(latest, item.startedAt ?? 0), 0)
    return this.deps.engine.topics
      .follows(task.id)
      .filter((follow) => follow.kind === 'readonly')
      .flatMap((follow) =>
        topicMessagesSince(this.deps.db, follow.topicId, Math.max(previous, follow.startedAt), 10).map((message) => ({
          id: message.id,
          author: message.author === OWNER ? '用户' : (this.deps.bots.get(message.author)?.name ?? message.author),
          replyTo: message.replyTo,
          text: clipCard(message.body, CARD_LIMITS.message, message.id),
        })),
      )
  }

  /** 开不了工：这次执行记失败，替任务记一条失败的汇报，等你决定重试还是结束。 */
  private fail(task: Task, run: TaskRun, reason: string): void {
    const { engine } = this.deps
    transaction(this.deps.db, () => {
      engine.runs.end(run.id, 'failed', reason)
      if (!isTicket(task)) return
      engine.runs.report({ task, author: 'pod', status: 'failed', summary: reason, report: reason, question: '', aboutMessage: null, replyMessage: null, checks: [], acceptance: [], data: {} })
    })
  }
}
