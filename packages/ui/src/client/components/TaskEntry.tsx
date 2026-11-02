import { END_REASON_LABELS, TICKET_STAGE_LABELS, stageGroup, t, type Bot, type TaskSnapshot } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { useApp } from '../state/app.ts'
import { useResource } from '../state/resource.ts'
import { Button } from './common.tsx'
import { BotName, GroupMark } from './GroupMark.tsx'
import { Icon } from './Icon.tsx'
import { TaskQuestion } from './TaskQuestion.tsx'
import { ActionButtons, Delivery, ReportLine, Undelivered, actionsFor, elapsed, type ControlAction } from './taskParts.tsx'

/** 任务对你来说只有四种状态：在做、等你、做完了、结束了（你停掉的、无需处理的）。 */
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
 * 主对话里开了群的任务：只放一个进群的入口，一行写清是哪件事、现在怎样，过程都在群里。
 * 要你处理时下面带上要做的事（问题、收下、重试）；做完了原地变成结果。
 */
export function GroupEntry(props: { readonly snapshot: TaskSnapshot; readonly now: number; readonly control: (action: ControlAction) => void; readonly owner: Bot | undefined }) {
  const app = useApp()
  const { snapshot, now } = props
  const { task } = snapshot
  const roomId = snapshot.groupRoomId ?? ''
  const members = useGroupMembers(roomId)
  const bucket = bucketOf(snapshot)
  const open = (): void => app.openRoom(roomId)
  if (bucket === 'done') {
    return (
      <div className="pod-task-inline-done">
        <Delivery snapshot={snapshot} />
        <div className="pod-task-inline-meta">
          {snapshot.ownerName === null ? null : <BotName bot={props.owner} fallback={snapshot.ownerName} size={14} />}
          <span>{t('「{title}」 · 用时 {elapsed}', { title: task.title, elapsed: elapsed(task, now) })}</span>
          <Button small kind="quiet" onClick={open}>
            {t('进群聊')}
          </Button>
          <Button small kind="quiet" onClick={() => app.openTask(task.rootId)}>
            {t('看报告')}
          </Button>
        </div>
        <Undelivered snapshot={snapshot} />
      </div>
    )
  }
  const actions = bucket === 'working' ? [] : actionsFor(snapshot)
  return (
    <div className="pod-entry-wrap">
      <button type="button" className={`pod-entry pod-entry-${bucket}`} onClick={open} title={t('打开这个任务的群聊')}>
        <span className="pod-entry-dot" aria-hidden />
        <GroupMark members={members} size={22} />
        <span className="pod-entry-title">{task.title}</span>
        <span className="pod-entry-status">
          {bucketLabel(snapshot, bucket)}
          {bucket === 'working' && snapshot.stage !== 'scheduled' ? ` · ${elapsed(task, now)}` : ''}
        </span>
        <span className="pod-entry-go">
          {t('进群聊')}
          <Icon name="forward" size={12} />
        </span>
      </button>
      {bucket !== 'attention' ? null : <ReportLine snapshot={snapshot} />}
      {bucket === 'attention' && snapshot.question !== null && snapshot.question !== undefined ? <TaskQuestion wait={snapshot.question} more={Math.max(0, snapshot.waits - 1)} /> : null}
      {actions.length === 0 ? null : (
        <div className="pod-task-actions">
          <ActionButtons actions={actions} control={props.control} />
        </div>
      )}
      <Undelivered snapshot={snapshot} />
    </div>
  )
}

/** 任务群里的子任务：一行写谁做哪件、现在怎样；做完的结果是成员回在它下面的话。点开看详情。 */
export function SubtaskLine(props: { readonly snapshot: TaskSnapshot; readonly now: number; readonly owner: Bot | undefined }) {
  const app = useApp()
  const { snapshot, now } = props
  const { task } = snapshot
  const bucket = bucketOf(snapshot)
  const time = bucket === 'working' && snapshot.stage !== 'scheduled' ? ` · ${elapsed(task, now)}` : bucket === 'done' ? ` · ${t('用时')} ${elapsed(task, now)}` : ''
  return (
    <button type="button" className={`pod-subtask-line pod-entry-${bucket}`} onClick={() => app.openTask(task.id)} title={t('详情')}>
      <span className="pod-entry-dot" aria-hidden />
      {snapshot.ownerName === null ? null : <BotName bot={props.owner} fallback={snapshot.ownerName} size={16} />}
      <span className="pod-entry-title">{task.title}</span>
      <span className="pod-entry-status">
        {bucketLabel(snapshot, bucket)}
        {time}
      </span>
    </button>
  )
}
