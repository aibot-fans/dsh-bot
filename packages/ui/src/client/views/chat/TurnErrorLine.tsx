import { useState } from 'react'
import { t, type RoomMessage } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { clock } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { useApp } from '../../state/app.ts'

interface TurnError {
  readonly code: string
  readonly detail: string
  readonly retry: boolean
  readonly retried: boolean
}

/** 消息里的 data.turnError：模型服务出错、这一轮没回成时 dsh-bot 记下的。 */
export function readTurnError(value: unknown): TurnError | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Readonly<Record<string, unknown>>
  if (typeof raw.code !== 'string') return undefined
  return { code: raw.code, detail: typeof raw.detail === 'string' ? raw.detail : '', retry: raw.retry === true, retried: raw.retried === true }
}

/** Key、额度、模型选错这几种重试也没用，给个去模型设置的入口。 */
const SETTINGS_CODES = new Set(['AUTH', 'MISSING_CREDENTIAL', 'QUOTA', 'NO_ADAPTER', 'UNKNOWN_MODEL'])

/**
 * bot 这一轮没回成（模型服务出错）：红色的一行写明原因，原始报错收在“详情”里；
 * 单聊和群聊的可以点“重试”请它接着回答，Key 和额度这类问题给个去模型设置的入口。
 */
export function TurnErrorLine(props: { readonly message: RoomMessage; readonly error: TurnError }) {
  const app = useApp()
  const { message, error } = props
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const retry = (): void => {
    setBusy(true)
    setProblem(undefined)
    api
      .retryTurn(message.id)
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  return (
    <div className="pod-line pod-line-error" role="alert">
      <span className="pod-line-text">
        <Icon name="alert" size={14} />
        <span>
          {message.body}
          {error.detail === '' ? null : (
            <>
              {' '}
              <button type="button" className="pod-link" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
                {open ? t('收起') : t('详情')}
              </button>
            </>
          )}
          {open ? (
            <span className="pod-line-detail">
              {error.code} · {error.detail}
            </span>
          ) : null}
          {problem === undefined ? null : <span className="pod-form-error">{problem}</span>}
        </span>
      </span>
      <span className="pod-line-actions">
        {SETTINGS_CODES.has(error.code) ? (
          <button type="button" className="pod-link" onClick={() => app.openSettings('models')}>
            {t('模型设置')}
          </button>
        ) : null}
        {error.retry ? (
          <button type="button" className="pod-link" disabled={busy} onClick={retry}>
            {t('重试')}
          </button>
        ) : error.retried ? (
          <span>{t('已重试')}</span>
        ) : null}
        <time>{clock(message.createdAt)}</time>
      </span>
    </div>
  )
}
