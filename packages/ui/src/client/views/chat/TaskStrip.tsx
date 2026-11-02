import { t } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Button, useNow } from '../../components/common.tsx'
import { bucketLabel, bucketOf } from '../../components/TaskEntry.tsx'
import { ActionButtons, actionsFor, elapsed, useSnapshot, type ControlAction } from '../../components/taskParts.tsx'
import { useApp } from '../../state/app.ts'

/**
 * 任务群顶上的一行：这件事现在怎样、用了多久、子任务做完几个，能暂停、停止、继续，详情在任务页。
 * 谁在做哪件看群里的子任务那几行，这里不再列成员。
 */
export function TaskStrip(props: { readonly taskId: string }) {
  const app = useApp()
  const now = useNow(30_000)
  const { snapshot } = useSnapshot(props.taskId)
  if (snapshot === undefined) return null
  const { task, children } = snapshot
  const bucket = bucketOf(snapshot)
  const counted = children.filter((child) => child.status !== 'cancelled')
  const done = counted.filter((child) => child.status === 'done').length
  const control = (action: ControlAction): void => {
    api.controlTask(task.id, action).catch((reason: unknown) => window.alert(errorText(reason)))
  }
  const parts = [
    snapshot.stage === 'scheduled' ? undefined : `${bucket === 'done' || bucket === 'ended' ? t('用时') : t('已用')} ${elapsed(task, now)}`,
    counted.length === 0 ? undefined : t('子任务 {done}/{total}', { done, total: counted.length }),
  ].filter((part): part is string => part !== undefined)
  return (
    <div className={`pod-task-strip pod-entry-${bucket}`} role="status">
      <span className="pod-entry-dot" aria-hidden />
      <span className="pod-entry-status">{bucketLabel(snapshot, bucket)}</span>
      {parts.length === 0 ? null : <span className="pod-muted-inline">{parts.join(' · ')}</span>}
      <span className="pod-task-strip-actions">
        <ActionButtons actions={actionsFor(snapshot)} control={control} />
        <Button small kind="quiet" onClick={() => app.openTask(task.id)}>
          {t('详情')}
        </Button>
      </span>
    </div>
  )
}
