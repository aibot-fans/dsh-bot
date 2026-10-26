import type { Task } from 'pod-domain'

export interface BriefContext {
  readonly fromName: string
  readonly assumptions: readonly string[]
  readonly conventions: readonly string[]
  /** 上游子任务的结果摘要和文件路径。 */
  readonly upstream: readonly { readonly title: string; readonly summary: string; readonly files: readonly string[] }[]
  readonly workspaceRoot: string
}

function numbered(items: readonly string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n')
}

/** 交给任务会话的第一条消息：任务说明、交付物、验收项、文件夹和上游结果。 */
export function composeBrief(task: Task, context: BriefContext): string {
  const sections = [
    `[${context.fromName}交给你的任务]`,
    `任务：${task.title}`,
    task.brief === '' ? undefined : `说明：\n${task.brief}`,
    task.deliverable === '' ? undefined : `交付物：${task.deliverable}`,
    task.acceptance.length === 0 ? undefined : `验收项（完成一条就用 update_task 勾上，编号从 1 开始）：\n${numbered(task.acceptance.map((item) => item.text))}`,
    context.assumptions.length === 0 ? undefined : `已定下的前提：\n${context.assumptions.map((item) => `- ${item}`).join('\n')}`,
    context.conventions.length === 0 ? undefined : `任务约定（所有子任务都照着做）：\n${context.conventions.map((item) => `- ${item}`).join('\n')}`,
    context.upstream.length === 0
      ? undefined
      : `上游结果：\n${context.upstream
          .map((item) => `- ${item.title}：${item.summary}${item.files.length === 0 ? '' : `（文件：${item.files.join('、')}）`}`)
          .join('\n')}`,
    `任务文件夹：${context.workspaceRoot}/${task.folder}/（过程文件和产出都放这里）`,
    '全部完成后调用 complete_task 提交摘要和文件路径。',
  ]
  return sections.filter((section): section is string => section !== undefined).join('\n\n')
}

/** 一轮结束却没提交时的提醒。 */
export function nudgeText(task: Task, count: number): string {
  const lead = count >= 2 ? '这已经是第 ' + String(count) + ' 次提醒。' : ''
  return [
    `[dsh-bot 提醒] 任务「${task.title}」还没有提交。${lead}`,
    '- 已经做完：调用 complete_task 提交。',
    '- 卡在必须用户出面的事上：用 ask_owner 说明（能绕过的先绕过，继续做其余部分）。',
    '- 还没做完：继续做下一步，并用 update_task 写一句进度说明。',
  ].join('\n')
}

/** 停止或暂停后继续时发给任务会话的话。 */
export function resumeText(task: Task, after: 'paused' | 'stopped'): string {
  const why = after === 'paused' ? '任务暂停后继续了' : '任务被停止后，用户让它继续'
  const note = task.note === '' ? '' : `你最近的进度说明是：「${task.note}」。`
  return `[dsh-bot] ${why}。${note}从停下的地方接着做；已完成的部分不用重做。`
}
