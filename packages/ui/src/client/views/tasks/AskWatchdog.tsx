import { useState } from 'react'
import { t } from 'pod-domain'
import { api, type TaskEvent } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Badge, Button, clock } from '../../components/common.tsx'

export const WATCHDOG_VERDICTS: Readonly<Record<string, string>> = {
  continue: '在推进',
  remind: '提醒换做法',
  blocked: '判断受阻',
}

/** 看门狗：最近一次判断，和“问看门狗”（为什么卡住、有没有在推进；只读，回答里引用决策链里的 #id）。 */
export function AskWatchdog(props: { readonly taskId: string; readonly events: readonly TaskEvent[] }) {
  const [answer, setAnswer] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const latest = props.events.filter((event) => event.kind === 'watchdog_verdict').at(-1)
  const verdict = typeof latest?.data.verdict === 'string' ? latest.data.verdict : undefined
  const ask = (): void => {
    setBusy(true)
    setProblem(undefined)
    api
      .diagnoseTask(props.taskId)
      .then((result) => setAnswer(result.text))
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  return (
    <section>
      <div className="pod-section-title">{t('看门狗')}</div>
      {latest === undefined || verdict === undefined ? null : (
        <div className="pod-row pod-wrap">
          <Badge tone={verdict === 'blocked' ? 'danger' : verdict === 'remind' ? 'warn' : 'ok'}>{t(WATCHDOG_VERDICTS[verdict] ?? verdict)}</Badge>
          <span>{typeof latest.data.reason === 'string' ? latest.data.reason : ''}</span>
          <time className="pod-muted-inline">{clock(latest.createdAt)}</time>
        </div>
      )}
      <div className="pod-row pod-wrap">
        <Button small disabled={busy} onClick={ask}>
          {busy ? t('正在问…') : t('问看门狗')}
        </Button>
        <span className="pod-hint">{t('问它为什么卡住、有没有在推进；只读，不会打断任务')}</span>
      </div>
      {answer === undefined ? null : <p className="pod-pre">{answer}</p>}
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
    </section>
  )
}
