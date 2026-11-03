import { useState } from 'react'
import { t, type Wait } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { errorText } from '../api/http.ts'
import { useApp } from '../state/app.ts'
import { ApprovalDetail } from './ApprovalDetail.tsx'
import { Button } from './common.tsx'
import { Markdown } from './Markdown.tsx'

/** 等你那句话怎么处理的：运行时记在消息上（data.settled），按钮收起后留的那行小字据此写。 */
export interface Settled {
  readonly status: string
  readonly answer: string | null
}

export function readSettled(value: unknown): Settled | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as Readonly<Record<string, unknown>>
  return typeof entry.status === 'string' ? { status: entry.status, answer: typeof entry.answer === 'string' ? entry.answer : null } : undefined
}

/** 答完留的那行小字：你批准了、你没批准、你答：……。 */
export function settledText(settled: Settled): string {
  const answer = (settled.answer ?? '').trim()
  if (settled.status === 'closed') return t('你说不用管')
  if (answer === t('批准') || answer === t('允许')) return answer === t('批准') ? t('你批准了') : t('你允许了一次')
  if (answer.startsWith(t('不批准')) || answer.startsWith(t('不允许'))) return answer.startsWith(t('不批准')) ? t('你没批准') : t('你没允许')
  if (answer === '' || answer === t('已处理')) return t('你处理好了')
  return t('你答：{answer}', { answer: answer.length > 60 ? `${answer.slice(0, 60)}…` : answer })
}

interface Choice {
  readonly label: string
  readonly primary: boolean
  /** 点了就是这句答复；去浏览器接管这类只是帮你打开地方，没有答复。 */
  readonly answer?: string
  readonly open?: () => void
}

function optionsOf(wait: Wait): readonly string[] {
  return Array.isArray(wait.data.options) ? wait.data.options.filter((option): option is string => typeof option === 'string' && option !== '') : []
}

/**
 * 等你：bot 要你定的那句话，后面两个按钮——批准、先不，允许一次、先不，去接管、登好了；bot 给了选项就是那几个选项。
 * 没有现成的选项时点“答复”写一句；也可以引用这句话直接回字。
 */
export function WaitAsk(props: { readonly wait: Wait; readonly onSettled?: (text: string) => void }) {
  const app = useApp()
  const { wait } = props
  const [replying, setReplying] = useState(false)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const tabId = typeof wait.data.tabId === 'string' ? wait.data.tabId : undefined
  const choices: readonly Choice[] = (() => {
    switch (wait.kind) {
      case 'write':
      case 'approval':
        return [
          { label: t('批准'), primary: true, answer: t('批准') },
          { label: t('先不'), primary: false, answer: t('不批准') },
        ]
      case 'security':
        return typeof wait.data.key === 'string'
          ? [
              { label: t('允许一次'), primary: true, answer: t('允许') },
              { label: t('先不'), primary: false, answer: t('不允许') },
            ]
          : [{ label: t('处理好了'), primary: true, answer: '' }]
      case 'login':
        return [
          ...(tabId === undefined
            ? []
            : [
                {
                  label: t('去接管'),
                  primary: false,
                  open: () => {
                    void api.takeover(tabId).catch(() => undefined)
                    app.openBrowserTab(tabId)
                  },
                },
              ]),
          { label: t('登好了'), primary: true, answer: '' },
        ]
      default:
        return optionsOf(wait).map((option, index) => ({ label: option, primary: index === 0, answer: option }))
    }
  })()
  const settle = (text: string): void => {
    setDone(text)
    props.onSettled?.(text)
    app.cache.invalidate('waits')
  }
  const answerWith = (text: string): void => {
    if (busy) return
    setBusy(true)
    setProblem(undefined)
    api
      .answerWait(wait.id, text)
      .then(() => settle(settledText({ status: 'resolved', answer: text })))
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  const act = (choice: Choice): void => {
    if (choice.answer === undefined) choice.open?.()
    else answerWith(choice.answer)
  }
  const send = (): void => {
    if (answer.trim() !== '') answerWith(answer.trim())
  }
  const dismiss = (): void => {
    setBusy(true)
    setProblem(undefined)
    api
      .dismissWait(wait.id)
      .then(() => settle(settledText({ status: 'closed', answer: null })))
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  if (done !== undefined) return <div className="pod-ask-done">{done}</div>
  // 没有现成的选项（拿不准的事、状态未知）：答复写一句，或者不用管。
  const free = choices.length === 0
  return (
    <div className="pod-ask">
      <Markdown text={wait.title} />
      {wait.kind === 'write' ? (
        <ApprovalDetail wait={wait} />
      ) : wait.detail === '' || wait.detail === wait.title ? null : (
        <details className="pod-ask-detail">
          <summary>{t('详情')}</summary>
          <Markdown text={wait.detail} />
        </details>
      )}
      <div className="pod-ask-actions">
        {choices.map((choice) => (
          <Button key={choice.label} small kind={choice.primary ? 'primary' : 'quiet'} disabled={busy} onClick={() => act(choice)}>
            {choice.label}
          </Button>
        ))}
        {free ? (
          <>
            <Button small kind="primary" disabled={busy} onClick={() => setReplying((value) => !value)}>
              {t('答复')}
            </Button>
            <Button small kind="quiet" disabled={busy} onClick={dismiss}>
              {t('不用管')}
            </Button>
          </>
        ) : (
          <button type="button" className="pod-link pod-ask-more" onClick={() => setReplying((value) => !value)}>
            {replying ? t('收起') : t('回一句')}
          </button>
        )}
      </div>
      {replying ? (
        <div className="pod-ask-reply">
          <textarea
            className="pod-textarea pod-textarea-small"
            rows={2}
            autoFocus
            value={answer}
            placeholder={wait.kind === 'login' ? t('登录好之后写一句“已登录”就行；不需要写密码') : t('你的答复')}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
              event.preventDefault()
              send()
            }}
          />
          <Button small kind="primary" disabled={busy || answer.trim() === ''} onClick={send}>
            {t('发送')}
          </Button>
        </div>
      ) : null}
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
    </div>
  )
}
