import { t, type RoomMessage } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { useApp } from '../state/app.ts'
import { useResource } from '../state/resource.ts'
import { ApproveCard } from './ApproveCard.tsx'
import { QuestionCard } from './QuestionCard.tsx'
import { readSettled, settledText } from './waitAnswer.ts'

/**
 * 对话里等你处理的事，按种类画成卡片：要你拿主意的是问题卡片，要批准、允许的是批准卡片，要你登录的卡片上是去接管、登好了。
 * 挂在问的那句话上（任务对话里干活的 bot 问的，主对话里 Super-agent 转告的那句下面）；处理过的也留着，画出怎么处理的。
 */
export function WaitCard(props: { readonly message: RoomMessage }) {
  const app = useApp()
  const { message } = props
  const waitId = typeof message.data.waitId === 'string' ? message.data.waitId : ''
  const { data: wait, error } = useResource(app.cache, waitId === '' ? null : `waits:${waitId}`, () => api.wait(waitId))
  const place = { roomId: message.roomId, messageId: message.id }
  if (wait !== undefined) return wait.kind === 'ambiguity' || wait.kind === 'unknown-state' ? <QuestionCard wait={wait} place={place} /> : <ApproveCard wait={wait} place={place} />
  // 还在读，或者这件事已经不在了：转告的那句话已经说了在问什么，不再画；问的那句话写出来，处理过的带上结果。
  if (message.kind !== 'wait') return null
  const settled = readSettled(message.data.settled)
  return (
    <div className="pod-acard">
      <span className="pod-acard-title">{message.body}</span>
      {settled !== undefined ? <div className="pod-acard-result">{settledText(settled)}</div> : error === undefined ? null : <div className="pod-acard-result">{t('已处理')}</div>}
    </div>
  )
}
