import { useState } from 'react'
import { TICKET_STAGE_LABELS, WAIT_KIND_LABELS, t, type Bot, type TicketStage } from 'pod-domain'
import { api, type AttentionItem } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Badge, Button, useNow } from '../../components/common.tsx'
import { duration } from '../../components/duration.ts'
import { BotName } from '../../components/GroupMark.tsx'
import { WaitView } from '../../components/WaitCard.tsx'
import { useApp } from '../../state/app.ts'

type Action = 'answer' | 'accept' | 'retry' | 'stop' | 'redeliver'

const ACTION_LABELS: Readonly<Record<Action, string>> = { answer: '答复', accept: '收下', retry: '重试', stop: '停止', redeliver: '重试' }

/** 每种要你处理的事给哪几个按钮：等你答复的答复，等你验收的收下或重试，受阻、失败的重试或停止，消息没送到的重试。 */
function actionsFor(stage: TicketStage | null, hasWait: boolean): readonly Action[] {
  if (hasWait) return ['answer']
  switch (stage) {
    case 'review':
      return ['accept', 'retry']
    case 'blocked':
    case 'failed':
      return ['retry', 'stop']
    case 'undelivered':
      return ['redeliver']
    default:
      return []
  }
}

function tone(stage: TicketStage | null): 'warn' | 'danger' {
  return stage === 'failed' || stage === 'undelivered' ? 'danger' : 'warn'
}

/** 概览里要你处理的一件：阶段、任务、哪个 bot、发生了什么、等了多久，后面是按钮；答复在原地展开。 */
export function AttentionRow(props: { readonly item: AttentionItem; readonly bot: Bot | undefined }) {
  const app = useApp()
  const now = useNow(30_000)
  const { item } = props
  const [answering, setAnswering] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const taskId = item.taskId
  const run = (action: Action): void => {
    if (action === 'answer') {
      setAnswering((value) => !value)
      return
    }
    if (taskId === null) return
    setBusy(true)
    setProblem(undefined)
    const work = action === 'redeliver' ? api.redeliverTask(taskId) : api.controlTask(taskId, action)
    work.catch((reason: unknown) => setProblem(errorText(reason))).finally(() => setBusy(false))
  }
  const label = item.stage === null ? (item.wait === null ? t('等你') : t(WAIT_KIND_LABELS[item.wait.kind])) : t(TICKET_STAGE_LABELS[item.stage])
  return (
    <li className="pod-attention">
      <div className="pod-attention-row">
        <Badge tone={tone(item.stage)}>{label}</Badge>
        <div className="pod-attention-main">
          {taskId === null ? (
            <strong className="pod-ellipsis">{item.title}</strong>
          ) : (
            <button type="button" className="pod-link pod-attention-title" onClick={() => app.openTask(taskId)}>
              <strong className="pod-ellipsis">{item.title}</strong>
            </button>
          )}
          <span className="pod-attention-meta">
            {item.botId === null ? null : <BotName bot={props.bot} size={14} />}
            <span className="pod-muted-inline" title={new Date(item.since).toLocaleString()}>
              {t('等了 {time}', { time: duration(now - item.since) })}
            </span>
          </span>
          {item.summary === '' || (item.wait !== null && item.summary === item.title) ? null : <span className="pod-attention-summary">{item.summary}</span>}
        </div>
        <div className="pod-attention-actions">
          {actionsFor(item.stage, item.wait !== null).map((action) => (
            <Button key={action} small kind={action === 'answer' || action === 'accept' ? 'primary' : 'quiet'} disabled={busy} onClick={() => run(action)}>
              {t(ACTION_LABELS[action])}
            </Button>
          ))}
          {taskId === null ? null : (
            <Button small kind="quiet" onClick={() => app.openTask(taskId)}>
              {t('打开')}
            </Button>
          )}
        </div>
      </div>
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
      {answering && item.wait !== null ? <WaitView wait={item.wait} /> : null}
    </li>
  )
}
