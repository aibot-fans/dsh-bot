import type { DatabaseSync } from 'node:sqlite'
import { REPORT_STATUS_LABELS, t, truncate, type PodSession, type Task, type TaskActivity } from 'pod-domain'
import { latestRun, listTaskEvents, reportsFor, type TaskEvent } from 'pod-store'
import type { LiteLlm } from '../core/lite.ts'
import { isTicket, type Engine } from '../engine/index.ts'

/** 看门狗的三种结论：继续（不打扰）、提醒（一句具体的提示）、受阻（替任务汇报受阻）。 */
export type Verdict = 'continue' | 'remind' | 'blocked'

export interface Judgment {
  readonly verdict: Verdict
  /** 一句话，引用依据的事件 id（#12）。 */
  readonly reason: string
  /** 提醒时送进任务会话的那句话。 */
  readonly hint: string
  readonly events: readonly number[]
}

/** 同一个任务这么久之内只判断一次（报警再来也先不问）。 */
const COOLDOWN_MS = 5 * 60_000

/** 定时巡查：执行开始这么久、上次判断也过了这么久的任务过一遍。 */
const REVIEW_MS = 10 * 60_000

/** 送进判断的最近事件条数。 */
const EVENT_LINES = 24

const VERDICTS: readonly Verdict[] = ['continue', 'remind', 'blocked']

const JUDGE_SYSTEM = [
  '你是 dsh-bot 的看门狗，判断一个正在执行的任务有没有实质进展。只看给你的事实，不猜。',
  '结论三选一：',
  '- continue：在推进（命令在跑、产出在变、刚汇报过进展），不用打扰；',
  '- remind：有动静但没进展（绕圈、重复同一个调用、偏离任务），给一句具体的提示让它换做法；',
  '- blocked：确实做不下去（缺登录、缺权限、要用户拿主意、外部服务一直不可用），替它报受阻，写清卡在哪、要用户做什么。',
  '拿不准就 continue。',
  '只输出 JSON：{"verdict": "continue|remind|blocked", "reason": "一句话，引用依据的事件 id（如 #12）", "hint": "remind 时给任务的一句提示，其余留空", "events": [依据的事件 id]}',
].join('\n')

const DIAGNOSE_SYSTEM = [
  '你是 dsh-bot 的看门狗。用户或前台在问这个任务为什么卡住、有没有在推进。',
  '用两三句话回答：现在在做什么、卡在哪（或者没卡）、建议怎么办；每个判断引用依据的事件 id（如 #12）。只看给你的事实，不猜，不做决定。',
].join('\n')

export interface JudgeDeps {
  readonly db: DatabaseSync
  readonly lite: LiteLlm
  readonly engine: Engine
  readonly now: () => number
  /** 任务现在由哪条会话在做。 */
  readonly sessionOf: (task: Task) => PodSession | undefined
  readonly activity: (sessionId: string) => TaskActivity | undefined
  readonly backgroundJobs: (sessionId: string) => number
  readonly botName: (botId: string | null) => string
  /** 提醒：一句具体的提示送进任务会话。 */
  readonly remind: (session: PodSession, task: Task, hint: string) => void
  /** 受阻：停下这一轮，替任务汇报受阻。 */
  readonly block: (session: PodSession, task: Task, reason: string) => void
  /** 判断完了，“可能在绕圈”的标记跟着变。 */
  readonly settled: (session: PodSession, judgment: Judgment) => void
  readonly warn: (message: string, error?: unknown) => void
}

function minutesAgo(time: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - time) / 60_000))
  return minutes < 1 ? t('刚才') : t('{minutes} 分钟前', { minutes })
}

function eventText(event: TaskEvent): string {
  const data = event.data
  const parts = [data.status, data.summary, data.reason, data.verdict, data.outcome, data.quote, data.title].filter((value): value is string => typeof value === 'string' && value !== '')
  return truncate(parts.join(' · '), 120)
}

function readJudgment(value: unknown): Judgment | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Readonly<Record<string, unknown>>
  const verdict = record.verdict
  if (typeof verdict !== 'string' || !(VERDICTS as readonly string[]).includes(verdict)) return undefined
  const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
  const hint = typeof record.hint === 'string' ? record.hint.trim() : ''
  if (reason === '' || (verdict === 'remind' && hint === '')) return undefined
  const events = Array.isArray(record.events) ? record.events.filter((id): id is number => typeof id === 'number' && Number.isInteger(id)) : []
  return { verdict: verdict as Verdict, reason: truncate(reason, 300), hint: truncate(hint, 300), events }
}

/**
 * 看门狗的慢路径：代码看门狗报警（工具很久没返回、模型没响应、步数涨了没进展、重复调用）后，
 * 用轻量模型拿任务的来由、最近的事件和汇报判断有没有实质进展；也定时把进行中的任务过一遍。
 * 结论记成任务的事件（任务页里看得到）。诊断是只读的：回答为什么卡住，不做决定。
 */
export class WatchdogJudge {
  private readonly judged = new Map<string, number>()
  private readonly busy = new Set<string>()
  private lastReview = 0
  private readonly deps: JudgeDeps

  constructor(deps: JudgeDeps) {
    this.deps = deps
  }

  get available(): boolean {
    return this.deps.lite.available
  }

  /** 代码看门狗报警：交给模型判断；判断不了（没有轻量模型、调用失败）就照旧用 fallback。 */
  alert(session: PodSession, task: Task, trigger: string, fallback: () => void): void {
    if (!this.available || !isTicket(task)) {
      fallback()
      return
    }
    if (this.busy.has(task.id)) return
    // 刚判断过：这次照旧用代码的做法，不再问模型。
    if (this.deps.now() - (this.judged.get(task.id) ?? 0) < COOLDOWN_MS) {
      fallback()
      return
    }
    void this.judge(session, task, trigger).then((done) => {
      if (!done) fallback()
    })
  }

  /** 定时巡查（外部控制回路）：在跑的工单，执行开始够久、上次判断也够久的，过一遍。 */
  review(): void {
    const now = this.deps.now()
    if (!this.available || now - this.lastReview < REVIEW_MS) return
    this.lastReview = now
    const rows = this.deps.db.prepare("SELECT DISTINCT task_id FROM task_runs WHERE status = 'running' AND started_at IS NOT NULL AND started_at <= ?").all(now - REVIEW_MS) as unknown as readonly { readonly task_id: string }[]
    for (const row of rows) {
      const task = this.deps.engine.tickets.get(row.task_id)
      if (task === undefined || task.endedAt !== null || !isTicket(task)) continue
      const session = this.deps.sessionOf(task)
      if (session === undefined || this.busy.has(task.id) || now - (this.judged.get(task.id) ?? 0) < REVIEW_MS) continue
      void this.judge(session, task, t('定时巡查'))
    }
  }

  /** 为什么卡住：只读的诊断，回答里引用事件 id。 */
  async diagnose(task: Task): Promise<string> {
    if (!this.available) return t('看门狗用的轻量模型不可用，没法诊断。')
    const result = await this.deps.lite.complete({ purpose: 'watchdog-diagnose', system: DIAGNOSE_SYSTEM, prompt: this.facts(task, this.deps.sessionOf(task), t('用户在问')), maxTokens: 600 })
    return result.text === '' ? t('看门狗没给出回答。') : result.text
  }

  private async judge(session: PodSession, task: Task, trigger: string): Promise<boolean> {
    this.busy.add(task.id)
    this.judged.set(task.id, this.deps.now())
    try {
      const judgment = await this.deps.lite.completeJson({ purpose: 'watchdog', system: JUDGE_SYSTEM, prompt: this.facts(task, session, trigger), maxTokens: 500 }, readJudgment)
      if (judgment === undefined) return false
      // 判断期间任务可能已经汇报、结束或换了一次执行：结论只对还是这一次的有效。
      const current = this.deps.engine.tickets.get(task.id)
      const run = latestRun(this.deps.db, task.id)
      if (current === undefined || current.endedAt !== null || run?.status !== 'running' || run.sessionId !== session.id) return true
      this.deps.engine.tickets.event(current, 'watchdog_verdict', 'watchdog', { verdict: judgment.verdict, reason: judgment.reason, hint: judgment.hint, trigger, events: judgment.events })
      if (judgment.verdict === 'remind') this.deps.remind(session, current, judgment.hint)
      if (judgment.verdict === 'blocked') this.deps.block(session, current, judgment.reason)
      this.deps.settled(session, judgment)
      return true
    } catch (error) {
      this.deps.warn(t('看门狗判断失败'), error)
      return false
    } finally {
      this.busy.delete(task.id)
    }
  }

  /** 送进判断的事实：来由、验收项、这次执行、现在的动静、最近的汇报和事件、报警原因。 */
  private facts(task: Task, session: PodSession | undefined, trigger: string): string {
    const now = this.deps.now()
    const run = latestRun(this.deps.db, task.id)
    const activity = session === undefined ? undefined : this.deps.activity(session.id)
    const jobs = session === undefined ? 0 : this.deps.backgroundJobs(session.id)
    const origin = task.origin?.quotes ?? []
    const reports = reportsFor(this.deps.db, task.id, 3)
    const events = listTaskEvents(this.deps.db, task.rootId)
      .filter((event) => event.taskId === task.id)
      .slice(-EVENT_LINES)
    const lines = [
      `任务「${task.title}」（${task.id}），交给${this.deps.botName(task.ownerBotId)}`,
      origin.length === 0 ? `说明：${truncate(task.brief, 400)}` : `来由（原话）：\n${origin.map((quote) => `- ${quote.author}：${truncate(quote.text, 200)}`).join('\n')}`,
      task.acceptance.length === 0 ? '' : `验收项：\n${task.acceptance.map((item, index) => `${index + 1}. [${item.done ? 'x' : ' '}] ${item.text}`).join('\n')}`,
      run === undefined ? '还没有执行' : `这次执行：开工原因 ${run.reason}，${run.startedAt === null ? '还没开始' : `开始于${minutesAgo(run.startedAt, now)}`}`,
      activity === undefined
        ? '现在：没有这条会话的动静'
        : `现在：第 ${activity.steps} 步，${activity.running ? (activity.current === null ? '在等模型' : `正在调用「${activity.current}」`) : '这一轮已经结束'}，最后一次动静在${activity.lastEventAt === null ? '很久以前' : minutesAgo(activity.lastEventAt, now)}；最近的动作：${activity.actions.join(' > ') || '无'}`,
      jobs > 0 ? `后台还有 ${jobs} 条命令在跑（跑完会叫醒它）` : '',
      reports.length === 0 ? '还没有汇报' : `最近的汇报：\n${reports.map((report) => `- ${t(REPORT_STATUS_LABELS[report.status])} · ${truncate(report.summary, 120)}（${minutesAgo(report.createdAt, now)}）`).join('\n')}`,
      `最近的事件：\n${events.map((event) => `- #${event.id} ${minutesAgo(event.createdAt, now)} ${event.actor === 'pod' || event.actor === 'watchdog' ? event.actor : this.deps.botName(event.actor)} ${event.kind} ${eventText(event)}`).join('\n')}`,
      `报警原因：${trigger}`,
    ]
    return lines.filter((line) => line !== '').join('\n\n')
  }
}
