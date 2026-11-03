import { useMemo } from 'react'
import { t, type Bot, type TaskSnapshot } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { IconButton } from '../../components/common.tsx'
import { bucketOf, isMoving, type TaskBucket } from '../../components/TaskEntry.tsx'
import { useNarrow } from '../../components/media.ts'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { TaskRow, WaitRow } from './TaskRow.tsx'

/** 完成的只列最近这么多件。 */
const DONE_SHOWN = 20

interface Sorted {
  readonly snapshot: TaskSnapshot
  readonly bucket: TaskBucket
}

/**
 * 概览：等你（最上面，等了最久的在前，按钮就在那句话后面）、进行中（在动的在前）、完成（收起来，最近的在前）。
 * 每件一行：状态图标、标题、成员头像、多久前有动静。系统出问题、暂停处理时顶上有横幅。
 */
export function OverviewView() {
  const app = useApp()
  const narrow = useNarrow()
  const { data: snapshots, error } = useResource(app.cache, 'tasks', () => api.tasks())
  const { data: overview } = useResource(app.cache, 'overview', () => api.overview())
  const { data: botList } = useResource(app.cache, 'bots', () => api.bots())
  const bots = useMemo(() => new Map((botList ?? []).map((bot): [string, Bot] => [bot.id, bot])), [botList])
  const roots: readonly Sorted[] = (snapshots ?? []).filter((snapshot) => snapshot.task.parentId === null).map((snapshot) => ({ snapshot, bucket: bucketOf(snapshot) }))
  const waiting = roots.filter((item) => item.bucket === 'attention').sort((left, right) => left.snapshot.task.updatedAt - right.snapshot.task.updatedAt)
  const working = roots
    .filter((item) => item.bucket === 'working')
    .sort((left, right) => Number(isMoving(right.snapshot)) - Number(isMoving(left.snapshot)) || right.snapshot.task.updatedAt - left.snapshot.task.updatedAt)
  const finished = roots
    .filter((item) => item.bucket === 'done' || item.bucket === 'ended')
    .sort((left, right) => right.snapshot.task.updatedAt - left.snapshot.task.updatedAt)
    .slice(0, DONE_SHOWN)
  // 对话里 bot 直接问你的，不挂在哪个任务上。
  const loose = (overview?.attention ?? []).flatMap((item) => (item.taskId === null && item.wait !== null ? [item.wait] : []))
  const row = (item: Sorted) => <TaskRow key={item.snapshot.task.id} snapshot={item.snapshot} bucket={item.bucket} bots={bots} />
  return (
    <main className="pod-convo pod-overview">
      <header className="pod-viewer-head">
        {narrow ? <IconButton icon="back" label={t('返回')} onClick={() => app.showList()} /> : null}
        <strong className="pod-grow">{t('概览')}</strong>
        {narrow ? null : <IconButton icon="close" label={t('关闭概览')} onClick={() => app.navigate({ overview: false })} />}
      </header>
      <div className="pod-overview-body">
        {snapshots === undefined ? (
          <p className="pod-muted">{error ?? t('正在读取…')}</p>
        ) : (
          <>
            <section className="pod-overview-section">
              <div className="pod-section-title">{t('等你（{count}）', { count: waiting.length + loose.length })}</div>
              {waiting.length + loose.length === 0 ? (
                <p className="pod-muted">{t('没有要你处理的事。')}</p>
              ) : (
                <ul className="pod-otask-list">
                  {loose.map((wait) => (
                    <WaitRow key={wait.id} wait={wait} bot={wait.botId === null ? undefined : bots.get(wait.botId)} />
                  ))}
                  {waiting.map(row)}
                </ul>
              )}
            </section>
            <section className="pod-overview-section">
              <div className="pod-section-title">{t('进行中（{count}）', { count: working.length })}</div>
              {working.length === 0 ? <p className="pod-muted">{t('现在没有在做的任务。')}</p> : <ul className="pod-otask-list">{working.map(row)}</ul>}
            </section>
            {finished.length === 0 ? null : (
              <details className="pod-overview-section pod-overview-done">
                <summary className="pod-section-title">{t('完成（{count}）', { count: finished.length })}</summary>
                <ul className="pod-otask-list">{finished.map(row)}</ul>
              </details>
            )}
          </>
        )}
      </div>
    </main>
  )
}
