import { useState } from 'react'
import { WAIT_KIND_LABELS, type Wait } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { errorText } from '../api/http.ts'
import { useApp } from '../state/app.ts'
import { useResource } from '../state/resource.ts'
import { ApprovalDetail } from './ApprovalDetail.tsx'
import { Badge, Button, RelativeTime } from './common.tsx'

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
        <Badge tone="warn">{WAIT_KIND_LABELS[wait.kind]}</Badge>
        {wait.status === 'bypassed' ? <Badge tone="muted">已先绕过</Badge> : null}
        <strong>{wait.title}</strong>
        <span className="pod-muted-inline">
          <RelativeTime time={wait.createdAt} />
        </span>
      </div>
      {wait.detail === '' || wait.kind === 'write' ? null : <p className="pod-wait-detail">{wait.detail}</p>}
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
            去浏览器接管
          </Button>
        </div>
      ) : null}
      {props.showTask === true && wait.rootId !== null ? (
        <button type="button" className="pod-link" onClick={() => app.openTask(wait.rootId ?? '')}>
          查看所属任务
        </button>
      ) : null}
      <div className="pod-wait-answer">
        <textarea
          className="pod-textarea pod-textarea-small"
          value={answer}
          placeholder={PLACEHOLDER[wait.kind] ?? '你的答复'}
          onChange={(event) => setAnswer(event.target.value)}
          rows={2}
        />
        {wait.kind === 'write' || (wait.kind === 'security' && typeof wait.data.key === 'string') ? (
          <div className="pod-wait-actions">
            <Button kind="primary" small disabled={busy} onClick={() => act(() => api.answerWait(wait.id, wait.kind === 'write' ? '批准' : '允许'))}>
              {wait.kind === 'write' ? '批准' : '允许一次'}
            </Button>
            <Button kind="danger" small disabled={busy} onClick={() => act(() => api.answerWait(wait.id, answer.trim() === '' ? '不批准' : `不批准：${answer}`))}>
              {wait.kind === 'write' ? '不批准' : '不允许'}
            </Button>
          </div>
        ) : (
          <div className="pod-wait-actions">
            <Button kind="primary" small disabled={busy} onClick={() => act(() => api.answerWait(wait.id, answer))}>
              处理好了
            </Button>
            <Button kind="quiet" small disabled={busy} onClick={() => act(() => api.dismissWait(wait.id))}>
              不用管
            </Button>
          </div>
        )}
        {error === undefined ? null : <p className="pod-form-error">{error}</p>}
      </div>
    </div>
  )
}

/** 时间线里的等你卡：还开着就显示答复框，处理过就收成一行。 */
export function WaitCard(props: { readonly waitId: string; readonly title: string }) {
  const app = useApp()
  const { data: waits } = useResource(app.cache, 'waits', () => api.waits())
  const wait = waits?.find((item) => item.id === props.waitId)
  if (waits === undefined) return <div className="pod-wait pod-wait-closed">等你：{props.title}</div>
  if (wait === undefined) return <div className="pod-wait pod-wait-closed">已处理：{props.title}</div>
  return <WaitView wait={wait} />
}
