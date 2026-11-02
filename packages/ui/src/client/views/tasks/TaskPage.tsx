import { useEffect, useMemo, useState } from 'react'
import { SESSION_KIND_LABELS, t, tc, type Bot } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Avatar, Button, IconButton } from '../../components/common.tsx'
import { TaskCard } from '../../components/TaskCard.tsx'
import { WaitView } from '../../components/WaitCard.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { Library } from '../panel/Library.tsx'
import { AskWatchdog } from './AskWatchdog.tsx'
import { Subtasks } from './Subtasks.tsx'
import { TaskOrigin } from './TaskOrigin.tsx'
import { TaskReports } from './TaskReports.tsx'
import { TaskTimeline } from './TaskTimeline.tsx'

/** 底部输入框：就是“直接对任务说”，说的话直接进任务会话，做完了的接着做。 */
function TalkBox(props: { readonly taskId: string }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const send = (): void => {
    const value = text.trim()
    if (value === '' || busy) return
    setBusy(true)
    setProblem(undefined)
    api
      .talkToTask(props.taskId, value)
      .then(() => setText(''))
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  return (
    <footer className="pod-taskpage-talk">
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
      <div className="pod-row">
        <textarea
          className="pod-textarea pod-textarea-small pod-grow"
          rows={2}
          value={text}
          disabled={busy}
          placeholder={t('直接对任务说，例如：先别查官网了，用第三方数据')}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            send()
          }}
        />
        <Button kind="primary" small disabled={busy || text.trim() === ''} onClick={send}>
          {t('发送')}
        </Button>
      </div>
    </footer>
  )
}

/**
 * 任务页（工单的话题，相当于 PR）：顶上是任务卡、来由、跟进的话题、最新的报告；中间是时间线；
 * 旁边是任务文件夹里的文件和会话；底部输入框直接对任务说。
 */
export function TaskPage(props: { readonly taskId: string }) {
  const app = useApp()
  const { data: detail, error } = useResource(app.cache, `detail:${props.taskId}`, () => api.taskDetail(props.taskId))
  const { data: botList } = useResource(app.cache, 'bots', () => api.bots())
  const bots = useMemo(() => new Map((botList ?? []).map((bot): [string, Bot] => [bot.id, bot])), [botList])
  useEffect(() => {
    if (detail !== undefined) app.rememberTree(detail.snapshot.task.rootId, [detail.snapshot.task.id, ...detail.snapshot.children.map((child) => child.id)])
  }, [app, detail])
  const parentId = detail?.snapshot.task.parentId ?? null
  return (
    <main className="pod-convo pod-taskpage">
      <header className="pod-viewer-head">
        <IconButton icon="back" label={t('返回')} onClick={() => app.closeTask()} />
        <strong className="pod-ellipsis pod-grow">{detail?.snapshot.task.title ?? t('任务')}</strong>
        {parentId === null ? null : (
          <Button small kind="quiet" onClick={() => app.openTask(parentId)}>
            {t('上级任务')}
          </Button>
        )}
      </header>
      {detail === undefined ? (
        <p className="pod-muted pod-taskpage-empty">{error ?? t('正在读取…')}</p>
      ) : (
        <div className="pod-taskpage-body">
          <div className="pod-taskpage-main">
            <TaskCard taskId={props.taskId} />
            <TaskOrigin detail={detail} bots={bots} />
            {detail.waits.length === 0 ? null : (
              <section className="pod-stack">
                <div className="pod-section-title">{t('等你处理')}</div>
                {detail.waits.map((wait) => (
                  <WaitView key={wait.id} wait={wait} />
                ))}
              </section>
            )}
            <TaskReports reports={detail.reports} bots={bots} />
            <AskWatchdog taskId={props.taskId} events={detail.events} />
            <Subtasks detail={detail} bots={bots} />
            {detail.snapshot.task.brief === '' ? null : (
              <details className="pod-taskpage-brief">
                <summary>{t('任务说明')}</summary>
                <p className="pod-pre">{detail.snapshot.task.brief}</p>
              </details>
            )}
            <TaskTimeline items={detail.timeline} bots={bots} />
          </div>
          <aside className="pod-taskpage-side" aria-label={t('文件和会话')}>
            <div className="pod-section-title">{t('文件和产出')}</div>
            <Library taskId={props.taskId} />
            {detail.sessions.length === 0 ? null : (
              <section>
                <div className="pod-section-title">{t('会话')}</div>
                {detail.sessions.map((session) => (
                  <div key={session.id} className="pod-row pod-session-row">
                    <Avatar bot={bots.get(session.botId)} size={20} />
                    <span className="pod-grow">
                      {bots.get(session.botId)?.name ?? session.botId} · {tc(SESSION_KIND_LABELS[session.kind], '会话')}
                      {session.status === 'retired' ? t('（已换段）') : ''}
                    </span>
                    <Button small kind="quiet" icon="open" onClick={() => app.host.openSession(session.id)}>
                      {t('查看过程')}
                    </Button>
                  </div>
                ))}
              </section>
            )}
          </aside>
        </div>
      )}
      <TalkBox taskId={props.taskId} />
    </main>
  )
}
