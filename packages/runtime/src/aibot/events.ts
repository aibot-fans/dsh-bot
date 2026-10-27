import { X_EVENT_LABELS, t, tc, truncate, xEventSummary, type XEventView } from 'pod-domain'
import { isJson, text, toTime, type Json } from './client.ts'

/** 事件流和补拉接口给的一条监控事件，按 Pod 用得到的字段整理好。 */
export interface XEvent {
  readonly id: string
  readonly detectedAt: string
  readonly view: XEventView
}

/** 只要 https 的链接：事件内容来自外面，别的协议（javascript: 之类）一律不要。 */
function https(value: string): string {
  return value.startsWith('https://') ? value : ''
}

function mediaUrls(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item) => {
      if (typeof item === 'string') return [item]
      if (!isJson(item)) return []
      return [text(item.previewUrl) || text(item.thumbnailUrl) || text(item.url) || text(item.mediaUrl)]
    })
    .filter((url) => https(url) !== '')
    .slice(0, 4)
}

/** 认不出 id 的不要：没法去重。 */
export function parseEvent(raw: unknown): XEvent | undefined {
  if (!isJson(raw)) return undefined
  const id = text(raw.id)
  if (id === '') return undefined
  const target: Json = isJson(raw.target) ? raw.target : {}
  const presentation: Json = isJson(raw.presentation) ? raw.presentation : {}
  const tweet: Json = isJson(presentation.tweet) ? presentation.tweet : {}
  const screenName = text(target.screenName)
  const type = text(raw.type)
  const label = tc(X_EVENT_LABELS[type] ?? '有新动态', 'X')
  return {
    id,
    detectedAt: text(raw.detectedAt) || text(raw.eventTime) || new Date().toISOString(),
    view: {
      id,
      type,
      screenName,
      name: text(target.name) || screenName,
      avatarUrl: https(text(target.avatarUrl)),
      title: text(presentation.title) || `@${screenName} ${label}`,
      summary: text(presentation.summary),
      url: https(text(presentation.url)) || https(text(tweet.url)),
      tweetText: text(tweet.text),
      tweetUrl: https(text(tweet.url)),
      media: mediaUrls(tweet.media),
      eventTime: toTime(raw.eventTime) ?? toTime(raw.detectedAt),
    },
  }
}

/** 群聊里这条消息的文字：标题、摘要、推文原文和链接。bot 读历史、搜索都靠它。 */
export function eventBody(view: XEventView): string {
  const lines = [`**${view.title}**`]
  const summary = xEventSummary(view)
  if (summary !== '') lines.push(summary)
  if (view.tweetText !== '') lines.push(view.tweetText.split('\n').map((line) => `> ${line}`).join('\n'))
  const link = view.tweetUrl || view.url
  if (link !== '') lines.push(link)
  return lines.join('\n\n')
}

/** 通知里的一句话。 */
export function eventNotice(view: XEventView): { readonly title: string; readonly body: string } {
  const who = view.screenName === '' ? view.name : `@${view.screenName}`
  return { title: t('X 监控：{truncate}', { truncate: truncate(view.title || who, 60) }), body: truncate(view.tweetText || view.summary, 200) }
}
