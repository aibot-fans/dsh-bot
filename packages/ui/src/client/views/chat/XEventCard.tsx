import { X_EVENT_LABELS, t, tc, xEventSummary, type XEventView } from 'pod-domain'
import { clock } from '../../components/common.tsx'

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 只认 https 链接：内容来自 X，别的协议一律不要。 */
function https(value: unknown): string {
  const url = str(value)
  return url.startsWith('https://') ? url : ''
}

/** 消息 data.xEvent 里的监控事件；字段不对就当普通消息显示。 */
export function readXEvent(value: unknown): XEventView | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Readonly<Record<string, unknown>>
  const id = str(record.id)
  if (id === '') return undefined
  return {
    id,
    type: str(record.type),
    screenName: str(record.screenName),
    name: str(record.name),
    avatarUrl: https(record.avatarUrl),
    title: str(record.title),
    summary: str(record.summary),
    url: https(record.url),
    tweetText: str(record.tweetText),
    tweetUrl: https(record.tweetUrl),
    media: Array.isArray(record.media) ? record.media.map(https).filter((url) => url !== '').slice(0, 4) : [],
    eventTime: typeof record.eventTime === 'number' ? record.eventTime : null,
  }
}

/** 「X 监控」群里的一条动态：谁、做了什么、推文原文和图，点链接去 X 上看。 */
export function XEventCard(props: { readonly view: XEventView }) {
  const { view } = props
  const label = tc(X_EVENT_LABELS[view.type] ?? '新动态', 'X')
  const link = view.tweetUrl || view.url
  const who = view.name || view.screenName
  const summary = xEventSummary(view)
  return (
    <article className="pod-xevent">
      <header className="pod-xevent-head">
        {view.avatarUrl === '' ? (
          <span className="pod-xevent-avatar" aria-hidden="true">
            {(who || 'X').slice(0, 1).toUpperCase()}
          </span>
        ) : (
          <img className="pod-xevent-avatar" src={view.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
        )}
        <span className="pod-xevent-who">
          <strong>{who}</strong>
          {view.screenName === '' ? null : <span>@{view.screenName}</span>}
        </span>
        <span className="pod-xevent-type">{label}</span>
      </header>
      {view.title === '' ? null : <p className="pod-xevent-title">{view.title}</p>}
      {summary === '' ? null : <p className="pod-xevent-summary">{summary}</p>}
      {view.tweetText === '' ? null : <blockquote className="pod-xevent-tweet">{view.tweetText}</blockquote>}
      {view.media.length === 0 ? null : (
        <div className={`pod-xevent-media pod-xevent-media-${Math.min(view.media.length, 4)}`}>
          {view.media.map((url) => (
            <a key={url} href={link || url} target="_blank" rel="noopener noreferrer">
              <img src={url} alt={t('推文里的图')} loading="lazy" referrerPolicy="no-referrer" />
            </a>
          ))}
        </div>
      )}
      <footer className="pod-xevent-foot">
        {view.eventTime === null ? null : <time dateTime={new Date(view.eventTime).toISOString()}>{clock(view.eventTime)}</time>}
        {link === '' ? null : (
          <a className="pod-link" href={link} target="_blank" rel="noopener noreferrer">
            {t('在 X 上看')}
          </a>
        )}
      </footer>
    </article>
  )
}
