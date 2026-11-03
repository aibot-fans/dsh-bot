import { useState } from 'react'
import { WAIT_KIND_LABELS, t, type RoomMessage, type Wait } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { errorText } from '../api/http.ts'
import { useApp } from '../state/app.ts'
import { useResource } from '../state/resource.ts'
import { ApprovalDetail } from './ApprovalDetail.tsx'
import { Badge, Button, RelativeTime } from './common.tsx'
import { Markdown } from './Markdown.tsx'
import { WaitAsk, readSettled, settledText } from './WaitAsk.tsx'

const PLACEHOLDER: Readonly<Record<string, string>> = {
  login: '登录好之后写一句“已登录”就行；不需要写密码',
  write: '不批准时可以写原因，会转给 bot',
  security: '不允许时可以写原因',
  ambiguity: '你的决定',
  'unknown-state': '写清楚现在实际是什么状态',
  approval: '写“批准”或者说明原因',
}

/** 一件等你处理的事：说明、背景，以及答复框。答复会转回给原来的会话。 */
export function WaitView(props: { readonly wait: Wait; readonly showTask?: boolean }) {
  const app = useApp()
  const { wait } = props
  // bot 问问题时给的几个选项：点一下就是答复。
  const options = Array.isArray(wait.data.options) ? wait.data.options.filter((option): option is string => typeof option === 'string' && option !== '') : []
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const act = (work: () => Promise<unknown>): void => {
    setBusy(true)
    setError(undefined)
    work()
      .then(() => {
        setAnswer('')
        app.cache.invalidate('waits')
      })
      .catch((reason: unknown) => setError(errorText(reason)))
      .finally(() => setBusy(false))
  }
  return (
    <div className={`pod-wait pod-wait-${wait.kind}`}>
      <div className="pod-wait-head">
        <Badge tone="warn">{t(WAIT_KIND_LABELS[wait.kind])}</Badge>
        {wait.status === 'bypassed' ? <Badge tone="muted">{t('已先绕过')}</Badge> : null}
        <strong>{wait.title}</strong>
        <span className="pod-muted-inline">
          <RelativeTime time={wait.createdAt} />
        </span>
      </div>
      {wait.detail === '' || wait.kind === 'write' ? null : (
        <div className="pod-wait-detail">
          <Markdown text={wait.detail} />
        </div>
      )}
      {wait.kind === 'write' ? <ApprovalDetail wait={wait} /> : null}
      {wait.kind === 'login' && typeof wait.data.tabId === 'string' ? (
        <div>
          <Button
            small
            icon="browser"
            onClick={() => {
              const tabId = wait.data.tabId as string
              void api.takeover(tabId).catch(() => undefined)
              app.openBrowserTab(tabId)
            }}
          >
            {t('去浏览器接管')}
          </Button>
        </div>
      ) : null}
      {props.showTask === true && wait.rootId !== null ? (
        <button type="button" className="pod-link" onClick={() => app.openTask(wait.rootId ?? '')}>
          {t('查看所属任务')}
        </button>
      ) : null}
      {options.length === 0 ? null : (
        <div className="pod-wait-options">
          {options.map((option) => (
            <Button key={option} small disabled={busy} onClick={() => act(() => api.answerWait(wait.id, option))}>
              {option}
            </Button>
          ))}
        </div>
      )}
      <div className="pod-wait-answer">
        <textarea
          className="pod-textarea pod-textarea-small"
          value={answer}
          placeholder={t(PLACEHOLDER[wait.kind] ?? '你的答复')}
          onChange={(event) => setAnswer(event.target.value)}
          rows={2}
        />
        {wait.kind === 'write' || (wait.kind === 'security' && typeof wait.data.key === 'string') ? (
          <div className="pod-wait-actions">
            <Button kind="primary" small disabled={busy} onClick={() => act(() => api.answerWait(wait.id, wait.kind === 'write' ? t('批准') : t('允许')))}>
              {wait.kind === 'write' ? t('批准') : t('允许一次')}
            </Button>
            <Button kind="danger" small disabled={busy} onClick={() => act(() => api.answerWait(wait.id, answer.trim() === '' ? t('不批准') : t('不批准：{answer}', { answer })))}>
              {wait.kind === 'write' ? t('不批准') : t('不允许')}
            </Button>
          </div>
        ) : (
          <div className="pod-wait-actions">
            <Button kind="primary" small disabled={busy} onClick={() => act(() => api.answerWait(wait.id, answer))}>
              {t('处理好了')}
            </Button>
            <Button kind="quiet" small disabled={busy} onClick={() => act(() => api.dismissWait(wait.id))}>
              {t('不用管')}
            </Button>
          </div>
        )}
        {error === undefined ? null : <p className="pod-form-error">{error}</p>}
      </div>
    </div>
  )
}

/**
 * 对话里的等你：还开着就是那句话后面带按钮（见 WaitAsk）；处理过了按钮收起，留一行小字。
 * 怎么处理的运行时记在消息上；刚点完、消息还没刷新时用这边记下的。
 */
export function WaitCard(props: { readonly message: RoomMessage }) {
  const app = useApp()
  const { message } = props
  const { data: waits } = useResource(app.cache, 'waits', () => api.waits())
  const [settled, setSettled] = useState<string | undefined>(undefined)
  const waitId = String(message.data.waitId ?? '')
  const wait = waits?.find((item) => item.id === waitId)
  const recorded = readSettled(message.data.settled)
  const closed = (text: string) => (
    <div className="pod-ask pod-ask-closed">
      <Markdown text={message.body} />
      <div className="pod-ask-done">{text}</div>
    </div>
  )
  if (settled !== undefined) return closed(settled)
  if (recorded !== undefined) return closed(settledText(recorded))
  if (waits === undefined) return <div className="pod-ask">{message.body}</div>
  if (wait === undefined) return closed(t('已处理'))
  return <WaitAsk wait={wait} onSettled={setSettled} />
}
