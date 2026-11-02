import { useState } from 'react'
import { t, type Bot, type FollowKind, type TopicKind } from 'pod-domain'
import { api, type TaskDetail } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { FoldText } from '../../components/FoldText.tsx'
import { useApp } from '../../state/app.ts'
import { Actor } from './events.tsx'

const FOLLOW_LABELS: Readonly<Record<FollowKind, string>> = { own: '自带', attached: '挂上的', readonly: '只读' }
const TOPIC_LABELS: Readonly<Record<TopicKind, string>> = { thread: '消息串', team: '任务群', x: 'X 上的对话' }

/** 任务页顶上：来由（你的原话，点开跳到原消息）和跟进的话题。 */
export function TaskOrigin(props: { readonly detail: TaskDetail; readonly bots: ReadonlyMap<string, Bot> }) {
  const app = useApp()
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const { task } = props.detail.snapshot
  const origin = task.origin
  const quotes = origin?.quotes ?? []
  const jump = (messageId: string): void => {
    setProblem(undefined)
    api
      .message(messageId)
      .then((message) => app.focusMessage(message.roomId, message.seq, message.id))
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  if (quotes.length === 0 && (origin?.note ?? '') === '' && props.detail.follows.length === 0) return null
  return (
    <section className="pod-stack">
      {quotes.length === 0 && (origin?.note ?? '') === '' ? null : (
        <div>
          <div className="pod-section-title">{t('来由')}</div>
          {quotes.map((quote, index) => (
            <blockquote key={`${quote.messageId ?? ''}:${index}`} className="pod-origin-quote">
              <span className="pod-tl-who">
                <Actor actor={quote.author} bots={props.bots} />
              </span>
              <span className="pod-origin-text">
                <FoldText text={quote.text} />
              </span>
              {quote.messageId === null ? null : (
                <button type="button" className="pod-link" onClick={() => jump(quote.messageId ?? '')}>
                  {t('看原消息')}
                </button>
              )}
            </blockquote>
          ))}
          {origin === null || origin.note === '' ? null : <p className="pod-muted">{t('备注：{note}', { note: origin.note })}</p>}
        </div>
      )}
      {props.detail.follows.length === 0 ? null : (
        <div>
          <div className="pod-section-title">{t('跟进的话题')}</div>
          <ul className="pod-follows">
            {props.detail.follows.map((follow) => (
              <li key={follow.topicId} className="pod-row pod-wrap">
                <span className="pod-badge pod-badge-muted">{t(FOLLOW_LABELS[follow.follow])}</span>
                <span>{t(TOPIC_LABELS[follow.topic])}</span>
                {follow.roomTitle === null ? null : <span className="pod-muted-inline">{follow.roomTitle}</span>}
                {follow.roomId === null || follow.rootMessage === null || follow.seq === null ? (
                  <span className="pod-ellipsis">{follow.excerpt}</span>
                ) : (
                  <button type="button" className="pod-link pod-ellipsis" onClick={() => app.focusMessage(follow.roomId ?? '', follow.seq ?? 0, follow.rootMessage ?? '')}>
                    {follow.excerpt === '' ? t('打开') : `「${follow.excerpt}」`}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
    </section>
  )
}
