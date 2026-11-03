import { useState } from 'react'
import { t } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Button } from '../../components/common.tsx'
import { TaskStateIcon, bucketLabel, bucketOf } from '../../components/TaskEntry.tsx'
import { useSnapshot } from '../../components/taskParts.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

/** 来源里引用的原话最多显示几个字。 */
const QUOTE_MAX = 40

/**
 * 任务群详情顶上的三行：状态、在哪干活、来源（点开跳到原消息），加上不显眼的“停止”和“过程”。
 * 群里只有对话，这些放在这里，要看再点开。
 */
export function TaskFacts(props: { readonly taskId: string }) {
  const app = useApp()
  const { snapshot } = useSnapshot(props.taskId)
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  if (snapshot === undefined) return null
  const { task } = snapshot
  const bucket = bucketOf(snapshot)
  const finished = bucket === 'done' || bucket === 'ended'
  const quote = (task.origin?.quotes ?? []).filter((item) => item.messageId !== null).at(-1)
  const sourceRoom = rooms?.find((room) => room.id === (task.origin?.roomId ?? task.roomId))
  const jump = (messageId: string): void => {
    setProblem(undefined)
    api
      .message(messageId)
      .then((message) => app.focusMessage(message.roomId, message.seq, message.id))
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  const stop = (): void => {
    setBusy(true)
    setProblem(undefined)
    api
      .controlTask(task.id, 'stop')
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  const source =
    quote !== undefined ? (
      <button type="button" className="pod-link pod-ellipsis" title={quote.text} onClick={() => jump(quote.messageId ?? '')}>
        {t('「{title}」', { title: quote.text.length > QUOTE_MAX ? `${quote.text.slice(0, QUOTE_MAX)}…` : quote.text })}
      </button>
    ) : sourceRoom !== undefined ? (
      <button type="button" className="pod-link pod-ellipsis" onClick={() => app.openRoom(sourceRoom.id)}>
        {sourceRoom.title}
      </button>
    ) : (
      <span className="pod-muted-inline">{task.origin?.rule ?? t('无')}</span>
    )
  return (
    <section className="pod-box pod-task-facts">
      <div className="pod-kv">
        <span>{t('状态')}</span>
        <span className="pod-task-fact">
          <TaskStateIcon snapshot={snapshot} />
          {bucketLabel(snapshot, bucket)}
        </span>
      </div>
      <div className="pod-kv">
        <span>{t('在哪干活')}</span>
        <span>{t('这台电脑')}</span>
      </div>
      <div className="pod-kv">
        <span>{t('来源')}</span>
        {source}
      </div>
      <div className="pod-row pod-task-facts-actions">
        {finished ? null : (
          <Button small kind="quiet" icon="stop" disabled={busy} onClick={stop}>
            {t('停止')}
          </Button>
        )}
        <Button small kind="quiet" onClick={() => app.openTask(task.id)}>
          {t('过程')}
        </Button>
      </div>
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
    </section>
  )
}
