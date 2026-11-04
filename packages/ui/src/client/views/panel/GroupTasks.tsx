import { useMemo, type ReactNode } from 'react'
import { TASK_STATUS_LABELS, acceptanceProgress, formatCost, t, type Bot, type RoomSummary, type Task, type TaskSnapshot, type TaskStatus } from 'pod-domain'
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

const ENDED: ReadonlySet<TaskStatus> = new Set(['done', 'failed', 'cancelled'])
const HELD: ReadonlySet<TaskStatus> = new Set(['paused', 'stopped'])

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

/** 一串任务：进行中的在上面，停着的（暂停、停止，还能接着做）在中间，已结束的在下面；点一下看详情。 */
function TaskTiles(props: { readonly match: (snapshot: TaskSnapshot) => boolean; readonly bots: readonly Bot[]; readonly empty: ReactNode; readonly onOpen: (snapshot: TaskSnapshot) => void }) {
  const app = useApp()
  const { data: tasks, error } = useResource(app.cache, 'tasks', () => api.tasks())
  const byId = useMemo(() => new Map(props.bots.map((bot) => [bot.id, bot])), [props.bots])
  const mine = (tasks ?? []).filter(props.match)
  const finished = mine.filter((snapshot) => ENDED.has(snapshot.task.status))
  const held = mine.filter((snapshot) => HELD.has(snapshot.task.status))
  const running = mine.filter((snapshot) => !ENDED.has(snapshot.task.status) && !HELD.has(snapshot.task.status))
  if (error !== undefined) return <p className="pod-form-error">{error}</p>
  if (tasks !== undefined && mine.length === 0) return <>{props.empty}</>
  const tile = (snapshot: TaskSnapshot) => <TaskTile key={snapshot.task.id} snapshot={snapshot} bots={byId} onOpen={() => props.onOpen(snapshot)} />
  return (
    <div className="pod-stack">
      {running.length === 0 ? null : <div className="pod-section-title">{t('进行中')}</div>}
      {running.map(tile)}
      {held.length === 0 ? null : <div className="pod-section-title">{t('停着的')}</div>}
      {held.map(tile)}
      {finished.length === 0 ? null : <div className="pod-section-title">{t('已结束')}</div>}
      {finished.map(tile)}
    </div>
  )
}

/** 群详情的「任务」页：在这个群里开的任务和群自己的任务；在群里干的点一下在右边看详情（能回到这一页），有自己对话的打开那段对话。 */
export function GroupTasks(props: { readonly room: RoomSummary; readonly bots: readonly Bot[] }) {
  const app = useApp()
  const { room } = props
  const open = (snapshot: TaskSnapshot): void => {
    if ((snapshot.conversationId ?? room.id) === room.id) app.showTask(snapshot.task.id, { kind: 'group', roomId: room.id, tab: 'tasks' })
    else openTaskConversation(app, snapshot)
  }
  return (
    <TaskTiles
      match={(snapshot) => snapshot.task.roomId === room.id || (room.taskId !== null && snapshot.task.id === room.taskId)}
      bots={props.bots}
      empty={<Empty title={t('这个群还没有任务')}>{t('在群里交代一件事，组长会接，或者交给对口的成员。')}</Empty>}
      onOpen={open}
    />
  )
}

/** bot 详情的「任务」页：它负责的任务（Super-agent 是从它的对话里派出去的）；点一下在右边看详情，能回到这一页。 */
export function BotTasks(props: { readonly bot: Bot; readonly bots: readonly Bot[] }) {
  const app = useApp()
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const { bot } = props
  const own = new Set((rooms ?? []).filter((room) => room.kind === 'direct' && room.botId === bot.id).map((room) => room.id))
  const match = (snapshot: TaskSnapshot): boolean =>
    snapshot.task.ownerBotId === bot.id || (bot.role === 'lead' && snapshot.task.parentId === null && own.has(snapshot.task.origin?.roomId ?? snapshot.task.roomId ?? ''))
  return (
    <TaskTiles
      match={match}
      bots={props.bots}
      empty={<Empty title={t('{name}还没有任务', { name: bot.name })}>{t('跟它说要查、要跑、要写成长东西的事，它会开任务做。')}</Empty>}
      onOpen={(snapshot) => app.showTask(snapshot.task.id, { kind: 'bot', botId: bot.id, tab: 'tasks' })}
    />
  )
}
