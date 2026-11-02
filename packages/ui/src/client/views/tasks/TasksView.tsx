import { TASK_STATUS_LABELS, acceptanceProgress, formatCost, t, type Bot, type TaskSnapshot } from 'pod-domain'
import { Avatar, Badge, RelativeTime } from '../../components/common.tsx'
import { segmentTone } from '../../components/TaskCard.tsx'

export function TaskTile(props: { readonly snapshot: TaskSnapshot; readonly bots: ReadonlyMap<string, Bot>; readonly onOpen: () => void }) {
  const { task, children } = props.snapshot
  const progress = acceptanceProgress(task.acceptance)
  const owner = task.ownerBotId === null ? undefined : props.bots.get(task.ownerBotId)
  const done = children.filter((child) => child.status === 'done').length
  return (
    <button type="button" className={`pod-tile pod-tile-${segmentTone(task)}`} onClick={props.onOpen}>
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
