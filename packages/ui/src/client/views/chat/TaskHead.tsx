import { t, type RoomSummary } from 'pod-domain'
import { Icon } from '../../components/Icon.tsx'
import { TaskStateIcon, bucketLabel, bucketOf } from '../../components/TaskEntry.tsx'
import { useSnapshot } from '../../components/taskParts.tsx'
import { useApp, useNav } from '../../state/app.ts'

/** 右边开着的是不是这个对话的详情（bot 详情或群详情，哪一页都算）。 */
function useDetailsOpen(room: RoomSummary): boolean {
  const panel = useNav().panel
  if (room.kind !== 'direct') return panel?.kind === 'group' && panel.roomId === room.id
  return panel?.kind === 'bot' && panel.botId === room.botId && panel.from === undefined
}

/** 右边那一栏收起来以后，顶上留着任务状态；点一下再打开详情。 */
export function TaskStatusPill(props: { readonly room: RoomSummary; readonly taskId: string }) {
  const app = useApp()
  const open = useDetailsOpen(props.room)
  const { snapshot } = useSnapshot(props.taskId)
  if (open || snapshot === undefined) return null
  const bucket = bucketOf(snapshot)
  return (
    <button type="button" className={`pod-task-pill pod-task-pill-${bucket}`} title={t('打开详情')} onClick={() => app.showRoomDetails(props.room.id)}>
      <TaskStateIcon snapshot={snapshot} />
      {bucketLabel(snapshot, bucket)}
    </button>
  )
}

/** 收起、打开右边的详情。 */
export function DetailsToggle(props: { readonly room: RoomSummary }) {
  const app = useApp()
  const open = useDetailsOpen(props.room)
  const label = open ? t('收起详情') : t('打开详情')
  return (
    <button type="button" className={`pod-head-button${open ? ' pod-head-button-on' : ''}`} aria-pressed={open} aria-label={label} title={label} onClick={() => (open ? app.closePanel() : app.showRoomDetails(props.room.id))}>
      <Icon name="panel" size={17} />
    </button>
  )
}
