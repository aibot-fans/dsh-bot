import { useState } from 'react'
import { t } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { errorText } from '../api/http.ts'
import { Button } from './common.tsx'
import { useSnapshot, type ControlAction } from './taskParts.tsx'

/** 你怎么定的（运行时记在那句话上，data.decided）：按钮收起后留的那行小字。 */
export function decidedText(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  switch ((value as Readonly<Record<string, unknown>>).action) {
    case 'accept':
      return t('你收下了')
    case 'retry':
    case 'resume':
      return t('你让它重试了')
    case 'stop':
    case 'cancel':
      return t('你说不做了')
    default:
      return undefined
  }
}

/**
 * 任务要你定的那句话后面的两个按钮：交上来等你验收的“收下”“再改改”，受阻、没做成的“重试”“不做了”。
 * 再改改就是引用这句话说要改哪里；子任务由组长验收，不给按钮。答完按钮收起，留一行小字。
 */
export function TaskDecision(props: { readonly taskId: string; readonly onRevise: () => void }) {
  const { snapshot } = useSnapshot(props.taskId)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  if (done !== undefined) return <div className="pod-ask-done">{done}</div>
  if (snapshot === undefined || snapshot.task.parentId !== null) return null
  const act = (action: ControlAction, after: string): void => {
    setBusy(true)
    setProblem(undefined)
    api
      .controlTask(snapshot.task.id, action)
      .then(() => setDone(after))
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  const { stage } = snapshot
  if (stage !== 'review' && stage !== 'failed' && stage !== 'blocked') return null
  return (
    <div className="pod-ask-actions">
      {stage === 'review' ? (
        <>
          <Button small kind="primary" disabled={busy} onClick={() => act('accept', t('你收下了'))}>
            {t('收下')}
          </Button>
          <Button small kind="quiet" disabled={busy} onClick={props.onRevise}>
            {t('再改改')}
          </Button>
        </>
      ) : (
        <>
          <Button small kind="primary" disabled={busy} onClick={() => act('retry', t('你让它重试了'))}>
            {t('重试')}
          </Button>
          <Button small kind="quiet" disabled={busy} onClick={() => act('stop', t('你说不做了'))}>
            {t('不做了')}
          </Button>
        </>
      )}
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
    </div>
  )
}
