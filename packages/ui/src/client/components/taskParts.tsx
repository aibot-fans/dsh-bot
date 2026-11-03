import { useEffect } from 'react'
import { t, type TaskSnapshot } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { useApp } from '../state/app.ts'
import { useResource } from '../state/resource.ts'
import { Button } from './common.tsx'

/** 任务卡、群聊入口和任务群顶上共用的任务快照：任务动了会刷新（整棵树一起记下）。 */
export function useSnapshot(taskId: string): { readonly snapshot: TaskSnapshot | undefined; readonly error: string | undefined } {
  const app = useApp()
  const { data: snapshot, error } = useResource(app.cache, taskId === '' ? null : `snapshot:${taskId}`, () => api.taskSnapshot(taskId))
  useEffect(() => {
    if (snapshot !== undefined) app.rememberTree(snapshot.task.rootId, [snapshot.task.id, ...snapshot.children.map((child) => child.id)])
  }, [app, snapshot])
  return { snapshot, error }
}

export type ControlAction = 'pause' | 'resume' | 'stop' | 'cancel' | 'retry' | 'accept'

/** 发不出去的消息：交不进会话的，或者发不到聊天室的回复；点重试马上再试。 */
export function Undelivered(props: { readonly snapshot: TaskSnapshot }) {
  const { undelivered, task } = props.snapshot
  if (undelivered === null || undelivered === undefined) return null
  return (
    <div className="pod-task-wait">
      {t('消息没送到：{error}', { error: undelivered.error })}{' '}
      <Button onClick={() => void api.redeliverTask(task.id)}>{t('重试')}</Button>
    </div>
  )
}
