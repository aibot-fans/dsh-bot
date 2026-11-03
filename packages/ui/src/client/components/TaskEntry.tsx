import { END_REASON_LABELS, TICKET_STAGE_LABELS, stageGroup, t, type Bot, type TaskSnapshot } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { useApp } from '../state/app.ts'
import { useResource } from '../state/resource.ts'
import { GroupMark } from './GroupMark.tsx'
import { Icon } from './Icon.tsx'
import { Undelivered, useSnapshot } from './taskParts.tsx'

/** 任务对你来说只有三种状态：进行中、等你、完成；完成里分做完了和结束了（你停掉的、无需处理的）。 */
export type TaskBucket = 'working' | 'attention' | 'done' | 'ended'

export function bucketOf(snapshot: TaskSnapshot): TaskBucket {
  const { task, stage } = snapshot
  if (task.status === 'done') return 'done'
  if (stage === 'ended') return task.endReason === 'done' ? 'done' : 'ended'
  // 子任务等组长验收是组长的事，不算等你。
  if (task.parentId !== null && stage === 'review') return 'working'
  return stageGroup(stage) === 'attention' ? 'attention' : 'working'
}

export function bucketLabel(snapshot: TaskSnapshot, bucket: TaskBucket): string {
  const { task, stage } = snapshot
  if (bucket === 'done') return t('已完成')
  if (bucket === 'ended') return task.endReason === null ? t('已结束') : t(END_REASON_LABELS[task.endReason])
  if (task.parentId !== null && stage === 'review') return t('等组长验收')
  // 组长开完子任务在等它们交上来：对你来说这件事还在做。
  if (stage === 'idle' && snapshot.children.some((child) => child.endedAt === null)) return t('进行中')
  if (bucket === 'attention' || stage === 'scheduled' || stage === 'idle') return t(TICKET_STAGE_LABELS[stage])
  return t('进行中')
}

/** 进行中的任务是不是真的在动：排队、在做、等子任务交上来转圈；等到点、等新消息只画一个圈。 */
export function isMoving(snapshot: TaskSnapshot): boolean {
  if (snapshot.stage === 'queued' || snapshot.stage === 'running') return true
  return snapshot.stage === 'idle' && snapshot.children.some((child) => child.endedAt === null)
}

/** 任务的状态图标：转圈是进行中，红点是等你，勾是完成（你停掉的、无需处理的是灰勾）。 */
export function TaskStateIcon(props: { readonly snapshot: TaskSnapshot }) {
  const bucket = bucketOf(props.snapshot)
  if (bucket === 'attention') return <span className="pod-state-icon pod-state-attention" aria-hidden />
  if (bucket === 'done' || bucket === 'ended') {
    return (
      <span className={`pod-state-icon pod-state-${bucket}`} aria-hidden>
        <Icon name="check" size={12} />
      </span>
    )
  }
  return isMoving(props.snapshot) ? <span className="pod-spinner pod-state-icon" aria-hidden /> : <span className="pod-state-icon pod-state-still" aria-hidden />
}

function useGroupMembers(roomId: string): readonly Bot[] {
  const app = useApp()
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  const room = rooms?.find((item) => item.id === roomId)
  return (room?.memberIds ?? []).map((id) => bots?.find((bot) => bot.id === id)).filter((bot): bot is Bot => bot !== undefined)
}

/** 进群聊的入口：群头像、群名，点一下进群。 */
export function GroupChip(props: { readonly roomId: string; readonly title: string }) {
  const app = useApp()
  const members = useGroupMembers(props.roomId)
  return (
    <button type="button" className="pod-group-chip" onClick={() => app.openRoom(props.roomId)} title={t('打开这个群聊')}>
      <GroupMark members={members} size={18} />
      <span className="pod-group-chip-title">{props.title}</span>
      <span className="pod-group-chip-go">
        {t('进群聊')}
        <Icon name="forward" size={12} />
      </span>
    </button>
  )
}

/**
 * 对话里的任务记号：状态图标加标题，不写用时、花费、进展，也不带按钮。点一下进这个任务的群；
 * 没开群的（单个 bot 做的）打开「过程」。要你定的事是 bot 在对话里说的那句话，按钮挂在那句话后面。
 */
export function TaskChip(props: { readonly taskId: string; readonly roomId: string }) {
  const app = useApp()
  const { snapshot, error } = useSnapshot(props.taskId)
  if (snapshot === undefined) return <span className="pod-task-chip pod-task-chip-loading">{error ?? t('正在读取任务…')}</span>
  const { task } = snapshot
  const bucket = bucketOf(snapshot)
  const group = snapshot.groupRoomId ?? null
  const label = bucketLabel(snapshot, bucket)
  const open = (): void => (group !== null && group !== props.roomId ? app.openRoom(group) : app.openTask(task.id))
  return (
    <span className="pod-task-chip-wrap">
      <button type="button" className={`pod-task-chip pod-task-chip-${bucket}`} onClick={open} title={label} aria-label={t('{label}：{title}', { label, title: task.title })}>
        <TaskStateIcon snapshot={snapshot} />
        <span className="pod-task-chip-title">{task.title}</span>
      </button>
      <Undelivered snapshot={snapshot} />
    </span>
  )
}
