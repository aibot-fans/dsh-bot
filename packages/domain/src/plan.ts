/**
 * 团队计划：主管或组长拆完任务提交的结构。计划里没有费用和时长的预估。
 * Pod 校验通过就开工：依赖没有环、引用的子任务都存在、负责人存在或是合法的新建草稿、
 * 工具档案覆盖子任务的需要、每个子任务都有交付物和验收项。
 */

import type { ToolProfile } from './bots.ts'
import { isRecord } from './text.ts'

export interface Assumption {
  readonly id: string
  /** 例：只看中国区公开报价。 */
  readonly text: string
  /** 依赖这条前提的子任务 id；前提被纠正时只重做它们。 */
  readonly affects: readonly string[]
}

export interface PlanSubtask {
  readonly id: string
  readonly title: string
  readonly brief: string
  /** 调研、写作、分析…… */
  readonly kind: string
  readonly deliverable: string
  /** 2–5 条验收项，也是进度单位。 */
  readonly acceptance: readonly string[]
  readonly dependsOn: readonly string[]
  readonly needs: { readonly browser: boolean; readonly shell: boolean }
  /** bot 的名字或 id，或者待新建 bot 的草稿 id。 */
  readonly owner: string
}

export interface BotDraftSpec {
  readonly draftId: string
  readonly name: string
  readonly title: string
  readonly persona: string
  readonly capabilities: readonly string[]
  readonly toolProfile: ToolProfile
}

export interface Revision {
  readonly reason: string
  readonly redo: readonly string[]
  readonly added: readonly string[]
  readonly dropped: readonly string[]
}

export interface TeamPlan {
  readonly version: number
  readonly goal: string
  readonly deliverables: readonly string[]
  readonly assumptions: readonly Assumption[]
  readonly level: 'L2' | 'L3'
  /** 为什么这样分。 */
  readonly reasons: readonly string[]
  /** 任务约定：表格的列、文件命名、语言、货币和日期格式、术语、出处写法。 */
  readonly conventions: readonly string[]
  readonly subtasks: readonly PlanSubtask[]
  readonly integration: { readonly owner: string; readonly method: string }
  readonly review: { readonly owner: string; readonly sampling: string }
  /** L3 时交给哪个正式团队（名字或 id）。 */
  readonly team: string | null
  /** 需要新建的临时 bot。 */
  readonly drafts: readonly BotDraftSpec[]
  readonly revision: Revision | null
  /** 群名：主管起的简短主题词，照原样用；没起时从目标里取。 */
  readonly name?: string
}

// ---------- 解析 ----------

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function needsOf(value: unknown): { readonly browser: boolean; readonly shell: boolean } {
  if (!isRecord(value)) return { browser: false, shell: false }
  return { browser: value.browser === true, shell: value.shell === true }
}

const PROFILES: readonly ToolProfile[] = ['talk', 'research', 'exec']

/** 从工具参数里读出计划；结构不对的字段按空处理，交给 validatePlan 报错。 */
export function parsePlan(input: unknown, version = 1): TeamPlan {
  const record = isRecord(input) ? input : {}
  const subtasks = Array.isArray(record.subtasks) ? record.subtasks : []
  const assumptions = Array.isArray(record.assumptions) ? record.assumptions : []
  const drafts = Array.isArray(record.drafts) ? record.drafts : []
  const integration = isRecord(record.integration) ? record.integration : {}
  const review = isRecord(record.review) ? record.review : {}
  return {
    version,
    goal: text(record.goal),
    deliverables: strings(record.deliverables),
    assumptions: assumptions.filter(isRecord).map((item, index) => ({
      id: text(item.id) || `a${index + 1}`,
      text: text(item.text),
      affects: strings(item.affects),
    })),
    level: record.level === 'L3' ? 'L3' : 'L2',
    reasons: strings(record.reasons),
    conventions: strings(record.conventions),
    subtasks: subtasks.filter(isRecord).map((item, index) => ({
      id: text(item.id) || `s${index + 1}`,
      title: text(item.title),
      brief: text(item.brief),
      kind: text(item.kind),
      deliverable: text(item.deliverable),
      acceptance: strings(item.acceptance),
      dependsOn: strings(item.dependsOn ?? item.depends_on),
      needs: needsOf(item.needs),
      owner: text(item.owner),
    })),
    integration: { owner: text(integration.owner), method: text(integration.method) },
    review: { owner: text(review.owner), sampling: text(review.sampling) },
    team: text(record.team) === '' ? null : text(record.team),
    drafts: drafts.filter(isRecord).map((item, index) => ({
      draftId: text(item.draftId ?? item.draft_id) || `d${index + 1}`,
      name: text(item.name),
      title: text(item.title),
      persona: text(item.persona),
      capabilities: strings(item.capabilities),
      toolProfile: PROFILES.includes(item.toolProfile as ToolProfile) ? (item.toolProfile as ToolProfile) : 'research',
    })),
    revision: null,
    name: text(record.group_name ?? record.groupName ?? record.name),
  }
}

// ---------- 校验 ----------

export interface PlanContext {
  /** 按名字或 id 找在用的 bot，返回它的工具档案；找不到返回 undefined。 */
  readonly profileOf: (owner: string) => ToolProfile | undefined
}

/** 工具档案覆盖子任务的需要吗：要 shell 的必须是执行档案，要浏览器的至少是研究档案。 */
export function profileCovers(profile: ToolProfile, needs: { readonly browser: boolean; readonly shell: boolean }): boolean {
  if (needs.shell && profile !== 'exec') return false
  if (needs.browser && profile === 'talk') return false
  return true
}

/** 依赖有没有环；有就返回环上的一个子任务 id。 */
export function findCycle(subtasks: readonly Pick<PlanSubtask, 'id' | 'dependsOn'>[]): string | undefined {
  const deps = new Map(subtasks.map((item) => [item.id, item.dependsOn]))
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (id: string): string | undefined => {
    const current = state.get(id)
    if (current === 'done') return undefined
    if (current === 'visiting') return id
    state.set(id, 'visiting')
    for (const next of deps.get(id) ?? []) {
      if (!deps.has(next)) continue
      const found = visit(next)
      if (found !== undefined) return found
    }
    state.set(id, 'done')
    return undefined
  }
  for (const item of subtasks) {
    const found = visit(item.id)
    if (found !== undefined) return found
  }
  return undefined
}

/** 校验一份计划；返回发现的全部问题，空数组表示可以开工。 */
export function validatePlan(plan: TeamPlan, context: PlanContext): readonly string[] {
  const problems: string[] = []
  if (plan.goal === '') problems.push('缺少目标（goal）')
  if (plan.subtasks.length === 0) problems.push('至少要有一个子任务')
  const ids = new Set<string>()
  for (const subtask of plan.subtasks) {
    if (ids.has(subtask.id)) problems.push(`子任务 id「${subtask.id}」重复`)
    ids.add(subtask.id)
  }
  const drafts = new Map(plan.drafts.map((draft) => [draft.draftId, draft]))
  for (const draft of plan.drafts) {
    if (draft.name === '' || draft.persona === '') problems.push(`新建草稿「${draft.draftId}」要写名字和人设`)
  }
  for (const subtask of plan.subtasks) {
    const label = subtask.title === '' ? subtask.id : `「${subtask.title}」`
    if (subtask.title === '') problems.push(`子任务 ${subtask.id} 缺少标题`)
    if (subtask.deliverable === '') problems.push(`${label} 缺少交付物`)
    if (subtask.acceptance.length === 0) problems.push(`${label} 至少要有一条验收项`)
    if (subtask.acceptance.length > 8) problems.push(`${label} 的验收项太多（最多 8 条），拆小一点`)
    for (const dependency of subtask.dependsOn) {
      if (!ids.has(dependency)) problems.push(`${label} 依赖的子任务「${dependency}」不存在`)
      if (dependency === subtask.id) problems.push(`${label} 不能依赖自己`)
    }
    if (subtask.owner === '') {
      problems.push(`${label} 没有负责人`)
      continue
    }
    const draft = drafts.get(subtask.owner)
    const profile = draft?.toolProfile ?? context.profileOf(subtask.owner)
    if (profile === undefined) problems.push(`${label} 的负责人「${subtask.owner}」不存在，也不是新建草稿`)
    else if (!profileCovers(profile, subtask.needs)) {
      problems.push(`${label} 需要${subtask.needs.shell ? ' shell' : ''}${subtask.needs.browser ? ' 浏览器' : ''}，负责人「${subtask.owner}」的工具档案不够`)
    }
  }
  const cycle = findCycle(plan.subtasks)
  if (cycle !== undefined) problems.push(`子任务依赖有环（经过「${cycle}」）`)
  for (const assumption of plan.assumptions) {
    for (const affected of assumption.affects) if (!ids.has(affected)) problems.push(`前提「${assumption.text}」挂的子任务「${affected}」不存在`)
  }
  return problems
}

/** 已完成的子任务集合里，哪些子任务的依赖都满足了、可以开工。 */
export function readySubtasks(subtasks: readonly Pick<PlanSubtask, 'id' | 'dependsOn'>[], done: ReadonlySet<string>, started: ReadonlySet<string>): readonly string[] {
  return subtasks.filter((item) => !started.has(item.id) && item.dependsOn.every((dependency) => done.has(dependency))).map((item) => item.id)
}

/** 前提被纠正时要重做的子任务：直接挂在这条前提上的，以及依赖它们的下游。 */
export function affectedByAssumption(plan: Pick<TeamPlan, 'assumptions' | 'subtasks'>, assumptionId: string): readonly string[] {
  const direct = new Set(plan.assumptions.find((item) => item.id === assumptionId)?.affects ?? [])
  let grew = true
  while (grew) {
    grew = false
    for (const subtask of plan.subtasks) {
      if (!direct.has(subtask.id) && subtask.dependsOn.some((dependency) => direct.has(dependency))) {
        direct.add(subtask.id)
        grew = true
      }
    }
  }
  return plan.subtasks.filter((item) => direct.has(item.id)).map((item) => item.id)
}

/** 两个档案取交集：派活不能放大权限。 */
export function intersectProfiles(left: ToolProfile, right: ToolProfile): ToolProfile {
  const rank: Readonly<Record<ToolProfile, number>> = { talk: 0, research: 1, exec: 2 }
  return rank[left] <= rank[right] ? left : right
}
