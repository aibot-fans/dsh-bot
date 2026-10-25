import { TASK_STATUS_LABELS, acceptanceProgress, truncate, type Task, type TaskResult, type TeamPlan } from 'pod-domain'

/** 编排器发给组长、成员和房间的文字。都只用任务数据拼出来，不调用模型。 */

export type NameOf = (botId: string | null) => string

/** 开工说明：目标、分工、前提、任务约定、为什么这样分。它是通知，不等你确认。 */
export function composeKickoff(plan: TeamPlan, subtasks: readonly Task[], nameOf: NameOf, leaderName: string, pending: boolean): string {
  const byOwner = new Map<string, string[]>()
  for (const task of subtasks) {
    const owner = nameOf(task.ownerBotId)
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), task.title])
  }
  const division = [...byOwner.entries()].map(([owner, titles]) => `${owner}负责${titles.join('、')}`).join('；')
  const drafts = plan.drafts.length === 0 ? '' : `新建临时 bot：${plan.drafts.map((draft) => draft.name).join('、')}。`
  const lines = [
    `**${plan.level === 'L3' ? '交给正式团队做' : '按临时小组做'}**：${division}。${drafts}${plan.review.owner === '' ? '' : `抽查由${plan.review.owner}负责。`}组长是${leaderName}。`,
    plan.assumptions.length === 0 ? undefined : `**前提**：${plan.assumptions.map((item) => item.text).join('；')}`,
    plan.conventions.length === 0 ? undefined : `**约定**：${plan.conventions.join('；')}`,
    plan.reasons.length === 0 ? undefined : `**为什么这样分**：${plan.reasons.join('；')}`,
    plan.deliverables.length === 0 ? undefined : `**交付物**：${plan.deliverables.join('、')}`,
    pending ? '**谨慎档**：计划等你点“开始”才动。' : undefined,
  ]
  return lines.filter((line): line is string => line !== undefined).join('\n\n')
}

/** 任务板摘要：给组长的事件消息和 task_board 工具用。 */
export function boardSummary(root: Task, subtasks: readonly Task[], keys: ReadonlyMap<string, string>, nameOf: NameOf): string {
  const keyOf = new Map([...keys.entries()].map(([key, id]) => [id, key]))
  const lines = subtasks.map((task) => {
    const progress = acceptanceProgress(task.acceptance)
    const deps = task.dependsOn.length === 0 ? '' : `，依赖 ${task.dependsOn.map((id) => keyOf.get(id) ?? id).join('、')}`
    return `- [${keyOf.get(task.id) ?? task.id}] 「${task.title}」${nameOf(task.ownerBotId)} · ${TASK_STATUS_LABELS[task.status]} · 验收项 ${progress.done}/${progress.total}${deps}${task.note === '' ? '' : ` · ${truncate(task.note, 40)}`}`
  })
  const done = subtasks.filter((task) => task.status === 'done').length
  const live = subtasks.filter((task) => task.status !== 'cancelled').length
  return [`任务「${root.title}」（${root.id}）：子任务 ${done}/${live} 完成`, ...lines].join('\n')
}

function resultBlock(result: TaskResult): string {
  return [
    `摘要：${result.summary}`,
    result.files.length === 0 ? undefined : `文件：${result.files.join('、')}`,
    result.assumptions.length === 0 ? undefined : `假设：${result.assumptions.join('；')}`,
    result.unverified.length === 0 ? undefined : `没核实：${result.unverified.join('；')}`,
    result.skipped.length === 0 ? undefined : `跳过：${result.skipped.join('；')}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n')
}

/** 子任务提交：唤醒组长验收。 */
export function submitEvent(task: Task, key: string, ownerName: string, result: TaskResult, board: string): string {
  return [
    `[子任务提交] 「${task.title}」（${key}，负责人：${ownerName}）`,
    resultBlock(result),
    `验收项：\n${task.acceptance.map((item, index) => `${index + 1}. ${item.text}`).join('\n')}`,
    `请对照验收项检查（研究类结论抽查出处），然后调用 review_task(subtask="${key}", pass=true/false, feedback="...")。`,
    `[任务板]\n${board}`,
  ].join('\n\n')
}

export function allDoneEvent(root: Task, board: string): string {
  return [
    `[全部子任务已通过] 「${root.title}」`,
    '请按任务约定合并各成员的结果；结论有冲突的先核实，核实不了就在交付里标出来。最终产物放进 shared/，然后调用 deliver_task 交付。',
    `[任务板]\n${board}`,
  ].join('\n\n')
}

export function stalledEvent(task: Task, key: string, reason: string, board: string): string {
  return [
    `[子任务停滞] 「${task.title}」（${key}）：${reason}`,
    '先让负责人换个做法（直接回复会转给它）；还不行就用 reassign_task 换人，或者用 revise_plan 拆小；信息确实找不到就降级，并在交付里注明。',
    `[任务板]\n${board}`,
  ].join('\n\n')
}

export function rejectText(task: Task, feedback: string, attempt: number): string {
  return [`[组长打回] 「${task.title}」第 ${attempt} 次打回：`, feedback, '请按意见修改后重新调用 complete_task 提交。'].join('\n')
}

/** 组长协调会话的背景：开工时注入，不唤醒它。 */
export function coordContext(plan: TeamPlan, board: string): string {
  return [
    `[你负责协调这个任务] 目标：${plan.goal}`,
    plan.conventions.length === 0 ? undefined : `任务约定：${plan.conventions.join('；')}`,
    plan.assumptions.length === 0 ? undefined : `前提：${plan.assumptions.map((item) => `${item.id}：${item.text}`).join('；')}`,
    `汇总方式：${plan.integration.method || '按任务约定合并'}；抽查：${plan.review.sampling || '研究类结论抽查 20% 的出处'}`,
    '你现在不需要做任何事。子任务提交、成员提问、停滞、失败或计划变更时，Pod 会发消息给你。',
    `[任务板]\n${board}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n\n')
}

export function changeEvent(rootTitle: string, quote: string, message: string, board: string): string {
  return [
    `[用户要改需求，经主管转达] 任务「${rootTitle}」`,
    `[用户原话] ${quote}`,
    message === '' ? undefined : `说明：${message}`,
    '请评估后用 revise_plan 出新版计划：纠正前提时只重做依赖它的子任务，已完成且不受影响的保留。',
    `[任务板]\n${board}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n\n')
}

export function revisionLine(version: number, reason: string, added: number, dropped: number, redo: number): string {
  const parts = [added > 0 ? `新增 ${added} 个子任务` : undefined, dropped > 0 ? `取消 ${dropped} 个` : undefined, redo > 0 ? `重做 ${redo} 个` : undefined].filter(Boolean)
  return `计划第 ${version} 版：${parts.length === 0 ? '调整了说明' : parts.join('，')}（${reason}）`
}
