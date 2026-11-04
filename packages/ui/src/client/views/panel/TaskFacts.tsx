import { useState } from 'react'
import { t, type RoomSummary } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Button, clock, useNow } from '../../components/common.tsx'
import { spent, stamp } from '../../components/duration.ts'
import { TaskStateIcon, bucketLabel, bucketOf } from '../../components/TaskEntry.tsx'
import { useSnapshot } from '../../components/taskParts.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { TaskActivityBox } from './Activity.tsx'

/** 开始时间：今天的写「今天 11:21」，别的天带上月日。 */
function startedText(time: number, now: number): string {
  return new Date(time).toDateString() === new Date(now).toDateString() ? t('今天 {time}', { time: clock(time) }) : stamp(time)
}

/** 任务从哪来：派活的那个对话（单聊写「Super-agent 单聊」），下面是你的原话，点一下跳过去。 */
function Source(props: { readonly room: RoomSummary | undefined; readonly name: string | undefined; readonly quote: { readonly messageId: string | null; readonly text: string } | undefined; readonly rule: string | undefined; readonly onProblem: (text: string) => void }) {
  const app = useApp()
  const { room, quote } = props
  const jump = (messageId: string): void => {
    api
      .message(messageId)
      .then((message) => app.focusMessage(message.roomId, message.seq, message.id))
      .catch((reason: unknown) => props.onProblem(errorText(reason)))
  }
  if (room === undefined && quote === undefined) return <span className="pod-muted-inline">{props.rule ?? t('无')}</span>
  return (
    <span className="pod-task-source">
      {room === undefined ? null : (
        <button type="button" className="pod-link pod-ellipsis" onClick={() => app.openRoom(room.id)}>
          {room.kind === 'direct' && props.name !== undefined ? t('{name} 单聊', { name: props.name }) : room.title}
        </button>
      )}
      {quote === undefined || quote.messageId === null ? null : (
        <button type="button" className="pod-task-quote" title={t('跳到这句话')} onClick={() => jump(quote.messageId ?? '')}>
          {quote.text}
        </button>
      )}
    </span>
  )
}

/**
 * 任务对话右边「详情」最上面：这段对话的任务（状态、来源、在哪干活，没结束的写开始时间、能暂停和停止，暂停着的能继续，结束了写用时），
 * 下面是「动态」（有任务对话的按交代和每次接着说分组）。单聊放在干活的 bot 的详情里，群聊放在群详情里。
 */
export function TaskFacts(props: { readonly taskId: string; readonly title: string }) {
  const app = useApp()
  const { snapshot } = useSnapshot(props.taskId)
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  const now = useNow()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  if (snapshot === undefined) return null
  const { task } = snapshot
  const bucket = bucketOf(snapshot)
  const finished = bucket === 'done' || bucket === 'ended'
  const quote = (task.origin?.quotes ?? []).filter((item) => item.messageId !== null).at(-1)
  const sourceRoom = rooms?.find((room) => room.id === (task.origin?.roomId ?? task.roomId))
  const sourceBot = bots?.find((bot) => bot.id === sourceRoom?.botId)
  const control = (action: 'stop' | 'pause' | 'resume'): void => {
    setBusy(true)
    setProblem(undefined)
    api
      .controlTask(task.id, action)
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  return (
    <>
      <section className="pod-box pod-task-facts">
        <div className="pod-box-head">
          <strong>{props.title}</strong>
          {finished ? null : (
            <span className="pod-box-action">
              {snapshot.stage === 'paused' ? (
                <Button small kind="quiet" icon="play" disabled={busy} onClick={() => control('resume')}>
                  {t('继续')}
                </Button>
              ) : (
                <Button small kind="quiet" icon="pause" disabled={busy} onClick={() => control('pause')}>
                  {t('暂停')}
                </Button>
              )}
              <Button small kind="quiet" icon="stop" disabled={busy} onClick={() => control('stop')}>
                {t('停止')}
              </Button>
            </span>
          )}
        </div>
        <div className="pod-kv">
          <span>{t('状态')}</span>
          <span className={`pod-task-fact pod-task-fact-${snapshot.stage === 'failed' ? 'failed' : bucket}`}>
            <TaskStateIcon snapshot={snapshot} />
            {bucketLabel(snapshot, bucket)}
          </span>
        </div>
        <div className="pod-kv">
          <span>{t('来源')}</span>
          <Source room={sourceRoom} name={sourceBot?.name} quote={quote} rule={task.origin?.rule ?? undefined} onProblem={setProblem} />
        </div>
        <div className="pod-kv">
          <span>{t('在哪干活')}</span>
          <span>{t('这台电脑')}</span>
        </div>
        {finished ? (
          <div className="pod-kv">
            <span>{t('用时')}</span>
            <span>{spent((task.finishedAt ?? now) - (task.startedAt ?? task.createdAt))}</span>
          </div>
        ) : (
          <div className="pod-kv">
            <span>{t('开始')}</span>
            <span>{startedText(task.startedAt ?? task.createdAt, now)}</span>
          </div>
        )}
        {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
      </section>
      <TaskActivityBox taskId={task.id} rootId={task.rootId} back={null} />
    </>
  )
}
