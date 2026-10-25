import {
  STAGE_LABELS,
  TASK_STATUS_LABELS,
  acceptanceProgress,
  formatCost,
  stagesFor,
  truncate,
  type Task,
  type TaskActivity,
  type TaskSnapshot,
} from 'pod-domain'

function ago(time: number | null, now: number): string {
  if (time === null) return '还没有动作'
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  if (seconds < 60) return `${seconds} 秒前有动作`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes} 分钟前有动作` : `${Math.round(minutes / 60)} 小时前有动作`
}

function elapsed(task: Task, now: number): string {
  const start = task.startedAt ?? task.createdAt
  const end = task.finishedAt ?? now
  const minutes = Math.max(0, Math.round((end - start) / 60_000))
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

function activityLine(activity: TaskActivity | null | undefined, now: number): string {
  if (activity === null || activity === undefined) return ''
  const current = activity.current ?? activity.actions.at(-1)
  return `第 ${activity.steps} 步${current === undefined ? '' : `：${current}`} · ${ago(activity.lastEventAt, now)}${activity.stalled ? ' · 可能在绕圈' : ''}`
}

function taskLine(task: Task, activity: TaskActivity | undefined, owner: string | undefined, now: number): string {
  const progress = acceptanceProgress(task.acceptance)
  const parts = [
    `「${task.title}」`,
    owner,
    TASK_STATUS_LABELS[task.status],
    progress.total === 0 ? undefined : `验收项 ${progress.done}/${progress.total}`,
    task.status === 'running' ? activityLine(activity, now) : undefined,
    task.note === '' ? undefined : `说明：${truncate(task.note, 60)}`,
  ]
  return parts.filter((part): part is string => part !== undefined && part !== '').join(' · ')
}

/**
 * 进度快照的文字版：主管回答“做到哪了”时附在消息里，不超过 500 tokens，不调用模型。
 */
export function snapshotText(snapshot: TaskSnapshot, ownerName: (botId: string | null) => string | undefined, now: number): string {
  const { task, children } = snapshot
  const stages = stagesFor(task.level)
  const stage = task.stage === null ? '' : `阶段：${stages.map((item) => (item === task.stage ? `[${STAGE_LABELS[item]}]` : STAGE_LABELS[item])).join(' > ')}`
  const header = `任务「${task.title}」（${task.id}）· ${TASK_STATUS_LABELS[task.status]} · 已用 ${elapsed(task, now)}${snapshot.cost > 0 ? ` · 已花 ${formatCost(snapshot.cost)}` : ''}`
  const lines = [header, stage]
  if (children.length === 0) {
    lines.push(taskLine(task, snapshot.activity ?? undefined, snapshot.ownerName ?? undefined, now))
    if (snapshot.activity !== null && snapshot.activity.actions.length > 0) lines.push(`最近动作：${snapshot.activity.actions.join(' > ')}`)
  } else {
    const done = children.filter((child) => child.status === 'done').length
    lines.push(`子任务 ${done}/${children.filter((child) => child.status !== 'cancelled').length} 完成：`)
    for (const child of children.slice(0, 12)) {
      lines.push(`- ${taskLine(child, snapshot.childActivity[child.id], ownerName(child.ownerBotId), now)}`)
    }
  }
  if (snapshot.waits > 0) lines.push(`等你处理：${snapshot.waits} 件`)
  if (task.result !== null && task.result.files.length > 0) lines.push(`已产出文件：${task.result.files.slice(0, 8).join('、')}`)
  return truncate(lines.filter((line) => line !== '').join('\n'), 1400)
}
