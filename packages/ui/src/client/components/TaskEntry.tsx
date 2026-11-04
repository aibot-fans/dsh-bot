import { END_REASON_LABELS, TICKET_STAGE_LABELS, stageGroup, t, type ActivityState, type Bot, type TaskSnapshot } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { useApp, type AppState } from '../state/app.ts'
import { useResource } from '../state/resource.ts'
import { GroupMark } from './GroupMark.tsx'
import { Icon } from './Icon.tsx'
import { NARROW_QUERY, matches } from './media.ts'
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
  if (bucket === 'attention' || stage === 'scheduled' || stage === 'idle' || stage === 'paused') return t(TICKET_STAGE_LABELS[stage])
  return t('进行中')
}

/** 进行中的任务是不是真的在动：排队、在做、等子任务交上来转圈；等到点、等新消息只画一个圈。 */
export function isMoving(snapshot: TaskSnapshot): boolean {
  if (snapshot.stage === 'queued' || snapshot.stage === 'running') return true
  return snapshot.stage === 'idle' && snapshot.children.some((child) => child.endedAt === null)
}

/** 状态图标：转圈是在动，空心圈是在等（到点、新消息），两道竖线是暂停着，红点是等你，红叉是没做成，圈住的勾是完成（停掉的、无需处理的是灰勾）。 */
export function StateIcon(props: { readonly state: ActivityState }) {
  switch (props.state) {
    case 'paused':
      return <span className="pod-state-icon pod-state-paused" aria-hidden />
    case 'failed':
      return (
        <span className="pod-state-icon pod-state-failed" aria-hidden>
          <Icon name="close" size={8} />
        </span>
      )
    case 'attention':
      return <span className="pod-state-icon pod-state-attention" aria-hidden />
    case 'done':
    case 'ended':
      return (
        <span className={`pod-state-icon pod-state-${props.state}`} aria-hidden>
          <Icon name="check" size={9} />
        </span>
      )
    case 'moving':
      return <span className="pod-spinner pod-state-icon" aria-hidden />
    case 'still':
      return <span className="pod-state-icon pod-state-still" aria-hidden />
  }
}

/** 任务的状态图标，照 bucketOf 分：暂停着、没做成、等你、完成（做完了、结束了），其余看是不是真的在动。 */
export function TaskStateIcon(props: { readonly snapshot: TaskSnapshot }) {
  const bucket = bucketOf(props.snapshot)
  if (props.snapshot.stage === 'paused') return <StateIcon state="paused" />
  if (bucket === 'attention') return <StateIcon state={props.snapshot.stage === 'failed' ? 'failed' : 'attention'} />
  if (bucket === 'done' || bucket === 'ended') return <StateIcon state={bucket} />
  return <StateIcon state={isMoving(props.snapshot) ? 'moving' : 'still'} />
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
 * 打开任务的对话（另开的单聊、任务群）。在别的对话里点的（from 是点的地方所在的对话）在右边小窗打开，手机上直接进去；
 * 从任务栏、搜索这些地方点的（不给 from）整页打开；已经在它的对话里（比如群里开的任务就在群里干），在右边打开任务详情。
 * 没有自己对话的（就在原来的对话里干的、以前没开群的）：在对话里点的在右边打开任务详情，
 * 以前是跳到放结果的那条消息，可那条常常就在卡片旁边，点了像没反应；从搜索这些地方点的照旧跳过去。
 */
export function openTaskConversation(app: AppState, snapshot: TaskSnapshot, from?: string): void {
  const conversation = snapshot.conversationId ?? null
  if (conversation === null && from === undefined) app.openTaskResult(snapshot.task.id, snapshot.task.roomId)
  else if (conversation === null || conversation === app.getNav().roomId) app.showTask(snapshot.task.id)
  else if (from !== undefined && from !== conversation && !matches(NARROW_QUERY)) app.openTaskWindow(snapshot.task.id)
  else app.openRoom(conversation)
}

/** 只知道任务 id 时（搜索结果）：先取到任务，再照 openTaskConversation 打开。 */
export function openTaskById(app: AppState, taskId: string): Promise<void> {
  return api.taskSnapshot(taskId).then((snapshot) => openTaskConversation(app, snapshot))
}

/**
 * 对话里的任务记号：句子里说到任务标题的地方（inline），没说到标题的放在气泡开头。状态图标加任务名，
 * 图标跟着状态变（转圈在做，红点等你，勾是做完），不写用时、进展。点一下在右边小窗打开这个任务的对话。
 */
export function TaskChip(props: { readonly taskId: string; readonly roomId: string; readonly inline?: boolean }) {
  const app = useApp()
  const { snapshot, error } = useSnapshot(props.taskId)
  if (snapshot === undefined) return <span className="pod-task-chip pod-task-chip-loading">{error ?? t('正在读取任务…')}</span>
  const { task } = snapshot
  const bucket = bucketOf(snapshot)
  const label = bucketLabel(snapshot, bucket)
  return (
    <span className={props.inline === true ? 'pod-task-chip-wrap pod-task-chip-inline' : 'pod-task-chip-wrap'}>
      <button
        type="button"
        className={`pod-task-chip pod-task-chip-${bucket}`}
        onClick={() => openTaskConversation(app, snapshot, props.roomId)}
        title={label}
        aria-label={t('{label}：{title}', { label, title: task.title })}
      >
        <TaskStateIcon snapshot={snapshot} />
        <span className="pod-task-chip-title">{task.title}</span>
      </button>
      <Undelivered snapshot={snapshot} />
    </span>
  )
}
