/**
 * 一轮回答的执行进度：bot 在干什么、干了几步、每步多久、成没成，计划走到哪，正在想什么。
 * 全部取自会话事件，不调用模型；思考的内容只在页面上显示，不存库。
 * 这一轮跑完以后，在最后一段回复上存一份摘要（RunSummary）：一步一行，不存命令输出。
 */

import { t } from './i18n.ts'
import { truncate } from './text.ts'

export type PlanStatus = 'pending' | 'in_progress' | 'completed'

/** bot 用 todo_write 写的计划里的一项。 */
export interface PlanItem {
  readonly content: string
  readonly status: PlanStatus
}

export interface ProgressStep {
  /** 工具调用的 id，结果靠它对上。 */
  readonly id: string
  /** 一句话：跑命令时是模型写的说明，别的工具是“读取 a.md”这种。 */
  readonly label: string
  /** 跑命令时的原始命令（一行、截短）。 */
  readonly command: string | null
  /** 工具名和参数的指纹：看是不是在重复做同一步。 */
  readonly sig: string
  readonly startedAt: number
  /** 还在跑是 null。 */
  readonly endedAt: number | null
  /** 成了 true，出错 false，还在跑 null。 */
  readonly ok: boolean | null
}

export interface TurnProgress {
  readonly startedAt: number
  /** 这一轮一共调用了几次工具（改计划不算）；steps 只留最近的 PROGRESS_STEPS 步。 */
  readonly calls: number
  readonly steps: readonly ProgressStep[]
  /** 计划；没写是空的。上一轮没做完的计划带到这一轮。 */
  readonly plan: readonly PlanItem[]
  /** 计划最近一次更新时调用到了第几次工具：看计划多久没动了。 */
  readonly planCalls: number
  /** 正在想的最后一句；不在想时是 null。 */
  readonly thinking: string | null
  readonly thinkingSince: number | null
  /** 这一轮已经想了多久（不含正在想的这一段）。 */
  readonly thoughtMs: number
}

export interface RunStep {
  readonly label: string
  readonly ms: number
  readonly ok: boolean
}

/** 跑完以后记在回复上的摘要。 */
export interface RunSummary {
  readonly startedAt: number
  readonly ms: number
  readonly thoughtMs: number
  readonly calls: number
  readonly steps: readonly RunStep[]
  readonly plan: readonly PlanItem[]
}

export type HealthKind = 'long-step' | 'failing' | 'repeat' | 'stuck-plan'

export interface ProgressHealth {
  readonly kind: HealthKind
  readonly text: string
}

/** 进度里留最近几步。 */
export const PROGRESS_STEPS = 40

/** 调用了这么多次工具还没写计划，提醒 bot 列一个。 */
export const PLAN_NUDGE_CALLS = 8

/** 一步跑多久算太久。 */
const LONG_STEP_MS = 3 * 60_000

/** 连着几步出错、连着几次做同一步，算不太对。 */
const FAILING_STEPS = 3
const REPEAT_STEPS = 3

/** 计划多少次工具调用没更新算没进展。 */
const PLAN_STALE_CALLS = 15

/** 用了这么多步或者这么久的回答（或者列了计划的），跑完才记摘要；三两步的问答不记。 */
const SUMMARY_MIN_CALLS = 3
const SUMMARY_MIN_MS = 60_000

const PLAN_STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed'])

/** 新的一轮：计划还没做完就带过来，做完了的不带。 */
export function startProgress(at: number, previous: TurnProgress | null | undefined): TurnProgress {
  const plan = previous !== null && previous !== undefined && previous.plan.some((item) => item.status !== 'completed') ? previous.plan : []
  return { startedAt: at, calls: 0, steps: [], plan, planCalls: 0, thinking: null, thinkingSince: null, thoughtMs: 0 }
}

/** 想完了：这一段想的时间记进总数。 */
export function stopThinking(progress: TurnProgress, at: number): TurnProgress {
  if (progress.thinkingSince === null) return progress.thinking === null ? progress : { ...progress, thinking: null }
  return { ...progress, thinking: null, thinkingSince: null, thoughtMs: progress.thoughtMs + Math.max(0, at - progress.thinkingSince) }
}

/** 思考流的最后一句（最多 80 字）：最后一截太短就带上前一句。 */
export function lastThought(text: string): string {
  const pieces = text
    .split(/(?<=[。！？!?；;])|\n+|(?<=\.)\s+/)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '')
  const last = pieces.at(-1) ?? ''
  const previous = pieces.at(-2)
  const line = last.length < 8 && previous !== undefined ? `${previous} ${last}` : last
  return line.length > 80 ? `…${line.slice(-80)}` : line
}

/** 正在想：tail 是思考流最后一段。 */
export function withThought(progress: TurnProgress, tail: string, at: number): TurnProgress {
  const thinking = lastThought(tail)
  return { ...progress, thinking: thinking === '' ? progress.thinking : thinking, thinkingSince: progress.thinkingSince ?? at }
}

/** 开始调用一个工具。 */
export function withCall(progress: TurnProgress, step: ProgressStep): TurnProgress {
  const base = stopThinking(progress, step.startedAt)
  return { ...base, calls: base.calls + 1, steps: [...base.steps, step].slice(-PROGRESS_STEPS) }
}

/** bot 用 todo_write 写了或者更新了计划：换上新计划，不算一步（计划单独显示，算步数只会多出几行“更新待办”）。 */
export function withPlan(progress: TurnProgress, plan: readonly PlanItem[], at: number): TurnProgress {
  return { ...stopThinking(progress, at), plan, planCalls: progress.calls }
}

/** 工具调用有了结果。 */
export function withResult(progress: TurnProgress, id: string, ok: boolean, at: number): TurnProgress {
  if (!progress.steps.some((step) => step.id === id && step.ok === null)) return progress
  return { ...progress, steps: progress.steps.map((step) => (step.id === id && step.ok === null ? { ...step, endedAt: at, ok } : step)) }
}

/** todo_write 的参数换成计划；格式不对返回 undefined。 */
export function readPlan(args: unknown): readonly PlanItem[] | undefined {
  const todos = typeof args === 'object' && args !== null ? (args as { readonly todos?: unknown }).todos : undefined
  if (!Array.isArray(todos)) return undefined
  return todos.flatMap((todo: unknown) => {
    if (typeof todo !== 'object' || todo === null) return []
    const { content, status } = todo as { readonly content?: unknown; readonly status?: unknown }
    if (typeof content !== 'string' || content.trim() === '' || typeof status !== 'string' || !PLAN_STATUSES.has(status)) return []
    return [{ content: truncate(content.trim(), 80), status: status as PlanStatus }]
  })
}

/** 计划做到哪了。 */
export function planProgress(plan: readonly PlanItem[]): { readonly done: number; readonly total: number; readonly current: PlanItem | undefined } {
  return {
    done: plan.filter((item) => item.status === 'completed').length,
    total: plan.length,
    current: plan.find((item) => item.status === 'in_progress') ?? plan.find((item) => item.status === 'pending'),
  }
}

/** 看这一轮是不是不太对：一步跑了太久、连着出错、连着做同一步、计划很久没动。都没有返回 null。 */
export function progressHealth(progress: TurnProgress, now: number): ProgressHealth | null {
  const long = progress.steps.find((step) => step.ok === null && now - step.startedAt >= LONG_STEP_MS)
  if (long !== undefined) return { kind: 'long-step', text: t('「{label}」已经跑了 {floor} 分钟', { label: long.label, floor: Math.floor((now - long.startedAt) / 60_000) }) }
  const finished = progress.steps.filter((step) => step.ok !== null).slice(-FAILING_STEPS)
  if (finished.length === FAILING_STEPS && finished.every((step) => step.ok === false)) return { kind: 'failing', text: t('连着 {FAILING_STEPS} 步出错', { FAILING_STEPS }) }
  const recent = progress.steps.slice(-REPEAT_STEPS)
  const first = recent[0]
  if (first !== undefined && recent.length === REPEAT_STEPS && recent.every((step) => step.sig === first.sig)) {
    return { kind: 'repeat', text: t('连着 {REPEAT_STEPS} 次做同一步：{label}', { REPEAT_STEPS, label: first.label }) }
  }
  const idle = progress.calls - progress.planCalls
  if (progress.plan.some((item) => item.status !== 'completed') && idle >= PLAN_STALE_CALLS) return { kind: 'stuck-plan', text: t('计划已经 {idle} 步没有推进', { idle }) }
  return null
}

/** 跑完了：一步一行的摘要。 */
export function summarizeRun(progress: TurnProgress, endedAt: number): RunSummary {
  const done = stopThinking(progress, endedAt)
  return {
    startedAt: done.startedAt,
    ms: Math.max(0, endedAt - done.startedAt),
    thoughtMs: done.thoughtMs,
    calls: done.calls,
    steps: done.steps.map((step) => ({ label: step.label, ms: Math.max(0, (step.endedAt ?? endedAt) - step.startedAt), ok: step.ok !== false })),
    plan: done.plan,
  }
}

/** 值不值得记：三两步、一分钟以内、没列计划的回答不记。 */
export function worthSummary(run: RunSummary): boolean {
  return run.calls >= SUMMARY_MIN_CALLS || run.ms >= SUMMARY_MIN_MS || run.plan.length > 0
}

/** 从消息的 data 里读回摘要（库里的数据，只认对的形状）。 */
export function readRunSummary(value: unknown): RunSummary | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const run = value as Readonly<Record<string, unknown>>
  const number = (key: string): number => (typeof run[key] === 'number' && Number.isFinite(run[key]) ? (run[key] as number) : 0)
  if (!Array.isArray(run.steps)) return undefined
  const steps = run.steps.flatMap((step: unknown) => {
    if (typeof step !== 'object' || step === null) return []
    const { label, ms, ok } = step as { readonly label?: unknown; readonly ms?: unknown; readonly ok?: unknown }
    return typeof label === 'string' ? [{ label, ms: typeof ms === 'number' ? ms : 0, ok: ok !== false }] : []
  })
  return { startedAt: number('startedAt'), ms: number('ms'), thoughtMs: number('thoughtMs'), calls: number('calls'), steps, plan: readPlan({ todos: run.plan }) ?? [] }
}

/** 时长写成“40 秒”“3 分 12 秒”“1 小时 5 分”。 */
export function spoken(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return t('{seconds} 秒', { seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return seconds % 60 === 0 ? t('{minutes} 分', { minutes }) : t('{minutes} 分 {value} 秒', { minutes, value: seconds % 60 })
  return minutes % 60 === 0 ? t('{floor} 小时', { floor: Math.floor(minutes / 60) }) : t('{floor} 小时 {value} 分', { floor: Math.floor(minutes / 60), value: minutes % 60 })
}
