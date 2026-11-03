import { useMemo } from 'react'
import { TASK_STATUS_LABELS, acceptanceProgress, formatCost, t, type Bot, type RoomSummary, type Task, type TaskSnapshot } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { Avatar, Badge, Empty, RelativeTime } from '../../components/common.tsx'
import { openTaskConversation } from '../../components/TaskEntry.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

function toneOf(task: Task): string {
  switch (task.status) {
    case 'done':
      return 'done'
    case 'running':
    case 'review':
      return 'running'
    case 'waiting':
      return 'waiting'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'queued'
  }
}

function TaskTile(props: { readonly snapshot: TaskSnapshot; readonly bots: ReadonlyMap<string, Bot>; readonly onOpen: () => void }) {
  const { task, children } = props.snapshot
  const progress = acceptanceProgress(task.acceptance)
  const owner = task.ownerBotId === null ? undefined : props.bots.get(task.ownerBotId)
  const done = children.filter((child) => child.status === 'done').length
  return (
    <button type="button" className={`pod-tile pod-tile-${toneOf(task)}`} onClick={props.onOpen}>
      <div className="pod-row">
        {owner === undefined ? null : <Avatar bot={owner} size={20} />}
        <strong className="pod-ellipsis">{task.title}</strong>
      </div>
      <div className="pod-tile-meta">
        <span>{t(TASK_STATUS_LABELS[task.status])}</span>
        {children.length > 0 ? <span>{t('子任务 {done}/{length}', { done, length: children.length })}</span> : progress.total > 0 ? <span>{t('验收项 {done}/{total}', { done: progress.done, total: progress.total })}</span> : null}
        {props.snapshot.cost > 0 ? <span>{formatCost(props.snapshot.cost)}</span> : null}
        {props.snapshot.waits > 0 ? <Badge tone="warn">{t('等你 {waits}', { waits: props.snapshot.waits })}</Badge> : null}
      </div>
      <div className="pod-tile-time">
        <RelativeTime time={task.updatedAt} />
      </div>
    </button>
  )
}

/** 群详情的「任务」页：在这个群里开的任务和群自己的任务，进行中的在上面；点一下打开那个任务的对话。 */
export function GroupTasks(props: { readonly room: RoomSummary; readonly bots: readonly Bot[] }) {
  const app = useApp()
  const { data: tasks, error } = useResource(app.cache, 'tasks', () => api.tasks())
  const byId = useMemo(() => new Map(props.bots.map((bot) => [bot.id, bot])), [props.bots])
  const mine = (tasks ?? []).filter((snapshot) => snapshot.task.roomId === props.room.id || (props.room.taskId !== null && snapshot.task.id === props.room.taskId))
  const running = mine.filter((snapshot) => !['done', 'failed', 'cancelled'].includes(snapshot.task.status))
  const finished = mine.filter((snapshot) => ['done', 'failed', 'cancelled'].includes(snapshot.task.status))
  if (error !== undefined) return <p className="pod-form-error">{error}</p>
  if (tasks !== undefined && mine.length === 0) return <Empty title={t('这个群还没有任务')}>{t('在群里交代一件事，Super-agent 会安排。')}</Empty>
  const tile = (snapshot: TaskSnapshot) => <TaskTile key={snapshot.task.id} snapshot={snapshot} bots={byId} onOpen={() => openTaskConversation(app, snapshot)} />
  return (
    <div className="pod-stack">
      {running.length === 0 ? null : <div className="pod-section-title">{t('进行中')}</div>}
      {running.map(tile)}
      {finished.length === 0 ? null : <div className="pod-section-title">{t('已结束')}</div>}
      {finished.map(tile)}
    </div>
  )
}
