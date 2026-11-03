import { useMemo } from 'react'
import { t, type Bot, type TaskSnapshot } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { useNow } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { bucketLabel, bucketOf, isMoving, openTaskConversation } from '../../components/TaskEntry.tsx'
import { workLine } from '../../components/taskLines.ts'
import { Undelivered, elapsed, useSnapshot } from '../../components/taskParts.tsx'
import { TaskPeople, useTaskPeople } from '../../components/TaskPeople.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

/** 卡片右边的状态：在做（转圈加用时）、等你（红点）、没做成、完成（勾）；你停掉的、看过不用做的写原因。 */
function CardStatus(props: { readonly snapshot: TaskSnapshot }) {
  const now = useNow()
  const { snapshot } = props
  const bucket = bucketOf(snapshot)
  if (bucket === 'done') {
    return (
      <span className="pod-tcard-status pod-tcard-status-done">
        <Icon name="check" size={13} />
        {t('完成')}
      </span>
    )
  }
  if (bucket === 'ended') return <span className="pod-tcard-status pod-tcard-status-ended">{bucketLabel(snapshot, bucket)}</span>
  if (bucket === 'attention') {
    return (
      <span className="pod-tcard-status pod-tcard-status-attention">
        <span className="pod-state-icon pod-state-attention" aria-hidden />
        {snapshot.stage === 'failed' ? t('没做成') : t('等你')}
      </span>
    )
  }
  const moving = isMoving(snapshot)
  // 刚开工不到一分钟的不写用时。
  const started = snapshot.task.startedAt ?? snapshot.task.createdAt
  const label = snapshot.stage !== 'running' ? bucketLabel(snapshot, bucket) : now - started < 60_000 ? t('进行中') : t('进行中 · {time}', { time: elapsed(snapshot.task, now) })
  return (
    <span className="pod-tcard-status pod-tcard-status-working">
      {moving ? <span className="pod-spinner pod-state-icon" aria-hidden /> : <span className="pod-state-icon pod-state-still" aria-hidden />}
      {label}
    </span>
  )
}

/**
 * Super-agent 开任务时那句话下面的任务卡片：干活的 bot 的头像、任务名、状态；在做的时候第二行写它这一步在做什么，
 * 等你和完成只有一行。点一下在右边小窗打开任务的对话。
 */
export function TaskCardItem(props: { readonly taskId: string; readonly roomId: string }) {
  const app = useApp()
  const { snapshot, error } = useSnapshot(props.taskId)
  const people = useTaskPeople(snapshot)
  const { data: botList } = useResource(app.cache, 'bots', () => api.bots())
  const bots = useMemo(() => new Map((botList ?? []).map((bot): [string, Bot] => [bot.id, bot])), [botList])
  if (snapshot === undefined) return <div className="pod-tcard pod-tcard-loading">{error ?? t('正在读取任务…')}</div>
  const { task } = snapshot
  const bucket = bucketOf(snapshot)
  return (
    <div className="pod-tcard-wrap">
      <button type="button" className={`pod-tcard pod-tcard-${bucket}`} onClick={() => openTaskConversation(app, snapshot, props.roomId)}>
        <span className="pod-tcard-row">
          <TaskPeople people={people} size={20} />
          <span className="pod-tcard-title">{task.title}</span>
          <CardStatus snapshot={snapshot} />
          <Icon name="forward" size={13} />
        </span>
        {bucket === 'working' ? <span className="pod-tcard-step">{workLine(snapshot, bots)}</span> : null}
      </button>
      <Undelivered snapshot={snapshot} />
    </div>
  )
}
