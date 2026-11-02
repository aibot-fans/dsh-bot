import { useState } from 'react'
import { t, type TriggerSource } from 'pod-domain'
import { api, type TriggerView } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Badge, Button } from '../../components/common.tsx'
import { stamp } from '../../components/duration.ts'
import { useApp } from '../../state/app.ts'

const SOURCE_LABELS: Readonly<Record<TriggerSource, string>> = { routine: '例程', brief: '每日简报', wake: '自己定的', open: '开任务时带的' }

function TriggerRow(props: { readonly taskId: string; readonly trigger: TriggerView }) {
  const app = useApp()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const { trigger } = props
  const closed = trigger.closedAt !== null
  const act = (call: () => Promise<unknown>): void => {
    setBusy(true)
    setProblem(undefined)
    call()
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => {
        setBusy(false)
        app.cache.invalidate(`detail:${props.taskId}`)
      })
  }
  const state = closed ? t('已关掉') : !trigger.enabled ? t('已暂停') : trigger.nextAt === null ? t('等着') : t('下次 {time}', { time: stamp(trigger.nextAt) })
  return (
    <li className={`pod-trigger${closed ? ' pod-trigger-closed' : ''}`}>
      <div className="pod-row pod-wrap">
        <Badge tone="muted">{t(SOURCE_LABELS[trigger.source])}</Badge>
        <strong>{trigger.text}</strong>
        <span className="pod-muted-inline">{state}</span>
      </div>
      {trigger.note === '' ? null : <p className="pod-trigger-note">{trigger.note}</p>}
      {trigger.lastAt === null && trigger.lastStatus === '' ? null : (
        <p className="pod-muted">
          {trigger.lastAt === null ? '' : t('上次叫醒 {time}', { time: stamp(trigger.lastAt) })}
          {trigger.lastStatus === '' ? '' : `${trigger.lastAt === null ? '' : ' · '}${trigger.lastStatus}`}
        </p>
      )}
      {closed ? null : (
        <div className="pod-row pod-wrap">
          <Button small kind="quiet" icon="play" disabled={busy} onClick={() => act(() => api.runTrigger(trigger.id))}>
            {t('现在跑一次')}
          </Button>
          <Button small kind="quiet" disabled={busy} onClick={() => act(() => api.updateTrigger(trigger.id, !trigger.enabled))}>
            {trigger.enabled ? t('暂停') : t('打开')}
          </Button>
          <Button small kind="quiet" disabled={busy} onClick={() => act(() => api.deleteTrigger(trigger.id))}>
            {t('删掉')}
          </Button>
        </div>
      )}
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
    </li>
  )
}

/** 任务页上的触发器：什么时候叫醒、下次几点、上次怎样；能现在跑一次、暂停、删掉。 */
export function TaskTriggers(props: { readonly taskId: string; readonly triggers: readonly TriggerView[] }) {
  if (props.triggers.length === 0) return null
  return (
    <section>
      <div className="pod-section-title">{t('触发器')}</div>
      <ul className="pod-triggers">
        {props.triggers.map((trigger) => (
          <TriggerRow key={trigger.id} taskId={props.taskId} trigger={trigger} />
        ))}
      </ul>
    </section>
  )
}
