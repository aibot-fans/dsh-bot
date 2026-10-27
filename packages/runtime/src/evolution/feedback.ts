import type { DatabaseSync } from 'node:sqlite'
import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { computeScorecard, fail, isCorrection, ok, readId, readInt, readString, t, type BotStats, type Feedback, type PodResult, type RoomMessage, type Scorecard, type Task, type Wait } from 'pod-domain'
import { feedbackFor, getMessage, insertFeedback, ratingOf, readState, reviewsOf, setRating, tasksOwnedBy, writeState } from 'pod-store'
import type { PodBus } from '../core/bus.ts'
import type { UsageMeter } from '../usage/meter.ts'

export interface FeedbackDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly meter: UsageMeter
  readonly workspaceRoot: string
  readonly now: () => number
  readonly task: (id: string) => Task | undefined
  /** 房间里最近一条 bot 发言的作者：你的纠正算在它头上。 */
  readonly lastBotIn: (roomId: string) => string | undefined
}

const EDITS_KEY = 'feedback.deliveries'
const EDIT_WINDOW_MS = 7 * 86_400_000

interface DeliveredFiles {
  readonly taskId: string
  readonly botId: string
  readonly at: number
  readonly files: readonly { readonly path: string; readonly mtime: number; readonly size: number }[]
}

/**
 * 反馈信号：你点赞点踩（可以附原因）、你的纠正（“以后别这样”）、组长验收、任务失败、重新生成、
 * 交付后你改了产物、找你和先绕过的次数。评分卡和自我优化都从这里取数。
 */
export class FeedbackService {
  private readonly deps: FeedbackDeps

  constructor(deps: FeedbackDeps) {
    this.deps = deps
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  /** 你给 bot 的一条消息点赞（1）、点踩（-1）或撤销（0）。 */
  rate(input: unknown): PodResult<{ readonly messageId: string; readonly value: number }> {
    const messageId = readId(input, 'messageId')
    const value = readInt(input, 'value') ?? 0
    if (messageId === undefined || ![1, 0, -1].includes(value)) return fail('invalid-input', t('评分只能是赞、踩或撤销'))
    const message = getMessage(this.db, messageId)
    if (message === undefined || message.author === 'owner' || message.author === 'pod') return fail('not-found', t('只能给 bot 的发言评分'))
    const task = typeof message.data.taskId === 'string' ? this.deps.task(message.data.taskId) : undefined
    setRating(this.db, { kind: 'rating', botId: message.author, taskId: task?.id ?? null, rootId: task?.rootId ?? null, messageId, value, reason: readString(input, 'reason').slice(0, 300), now: this.deps.now() })
    this.deps.bus.emit({ type: 'message', roomId: message.roomId, messageId })
    return ok({ messageId, value })
  }

  ratingOf(messageId: string): number {
    return ratingOf(this.db, messageId)
  }

  /** 你在房间里说的话像是纠正，就记一条，算在刚才发言的 bot 头上。 */
  observeOwner(message: RoomMessage): void {
    if (!isCorrection(message.body)) return
    const botId = this.deps.lastBotIn(message.roomId)
    if (botId === undefined) return
    insertFeedback(this.db, { kind: 'correction', botId, messageId: message.id, value: -1, reason: message.body.slice(0, 300), now: this.deps.now() })
  }

  /** 组长验收：通过还是打回，以及打回的理由。 */
  onReview(task: Task, pass: boolean, reason: string): void {
    insertFeedback(this.db, { kind: 'review', botId: task.ownerBotId, taskId: task.id, rootId: task.rootId, value: pass ? 1 : -1, reason: reason.slice(0, 300), now: this.deps.now() })
  }

  onFailure(task: Task, reason: string): void {
    insertFeedback(this.db, { kind: 'failure', botId: task.ownerBotId, taskId: task.id, rootId: task.rootId, value: -1, reason: reason.slice(0, 300), now: this.deps.now() })
  }

  onRegenerate(message: RoomMessage): void {
    insertFeedback(this.db, { kind: 'regenerate', botId: message.author, messageId: message.id, value: -1, now: this.deps.now() })
  }

  /** 找你一次或先绕过一次：自治效果统计。 */
  onWait(wait: Wait): void {
    if (wait.kind === 'unknown-state' || wait.kind === 'approval') return
    insertFeedback(this.db, { kind: wait.status === 'bypassed' ? 'bypassed' : 'asked', botId: wait.botId, taskId: wait.taskId, rootId: wait.rootId, value: 0, reason: wait.title, now: this.deps.now() })
  }

  /** 交付时记下产物文件的修改时间，之后一周里你改了它，就记一次“交付后被改”。 */
  async onDelivered(task: Task): Promise<void> {
    if (task.result === null || task.ownerBotId === null) return
    const base = join(this.deps.workspaceRoot, task.folder)
    const files = []
    for (const file of task.result.files.slice(0, 20)) {
      const path = isAbsolute(file) ? file : join(file.startsWith('shared/') ? this.deps.workspaceRoot : base, file)
      const info = await stat(path).catch(() => undefined)
      if (info?.isFile() === true) files.push({ path, mtime: info.mtimeMs, size: info.size })
    }
    if (files.length === 0) return
    const now = this.deps.now()
    const tracked = readState<readonly DeliveredFiles[]>(this.db, EDITS_KEY, []).filter((item) => now - item.at < EDIT_WINDOW_MS)
    writeState(this.db, EDITS_KEY, [...tracked, { taskId: task.id, botId: task.ownerBotId, at: now, files }].slice(-200))
  }

  /** 夜间检查：交付后的产物被改过就记一次，每个任务只记一次。 */
  async checkEdits(): Promise<number> {
    const now = this.deps.now()
    const tracked = readState<readonly DeliveredFiles[]>(this.db, EDITS_KEY, [])
    const remaining: DeliveredFiles[] = []
    let found = 0
    for (const item of tracked) {
      let edited = false
      for (const file of item.files) {
        const info = await stat(file.path).catch(() => undefined)
        if (info !== undefined && (info.mtimeMs > file.mtime + 1000 || info.size !== file.size)) edited = true
      }
      if (edited) {
        const task = this.deps.task(item.taskId)
        insertFeedback(this.db, { kind: 'edited', botId: item.botId, taskId: item.taskId, rootId: task?.rootId ?? null, value: -1, reason: t('交付后你修改了产物'), now })
        found += 1
      } else if (now - item.at < EDIT_WINDOW_MS) {
        remaining.push(item)
      }
    }
    writeState(this.db, EDITS_KEY, remaining)
    return found
  }

  list(filter: { readonly botId?: string; readonly since?: number; readonly taskIds?: readonly string[] }): readonly Feedback[] {
    return feedbackFor(this.db, filter)
  }

  /** 评分卡：默认看最近 30 个任务；since 给了就只看那之后的。 */
  scorecard(botId: string, options: { readonly since?: number; readonly limit?: number } = {}): Scorecard {
    const owned = tasksOwnedBy(this.db, botId, { since: options.since, limit: options.limit ?? 30 })
    const reviews = reviewsOf(this.db, owned.map((task) => task.id))
    const tasks = owned.map((task) => ({
      id: task.id,
      status: task.status,
      cost: this.deps.meter.forTask(task.id).cost,
      durationMs: task.finishedAt === null ? 0 : task.finishedAt - task.createdAt,
      reviews: reviews.get(task.id) ?? [],
    }))
    const ids = new Set(owned.map((task) => task.id))
    const since = options.since ?? (owned.at(-1)?.createdAt ?? 0)
    const feedback = feedbackFor(this.db, { botId, since }).filter((item) => item.taskId === null || ids.has(item.taskId))
    return computeScorecard(tasks, feedback)
  }

  /** 分配打分用的历史表现。 */
  stats(botId: string): Partial<BotStats> {
    const card = this.scorecard(botId, { limit: 20 })
    return card.firstPassRate === null ? {} : { firstPassRate: card.firstPassRate }
  }
}
