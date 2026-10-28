import { tweetId, tweetUrl, userHandle, type XPost } from 'aibot-x-post'
import { t, truncate } from 'pod-domain'

/** 一次 X 写操作。审批卡和“状态未知”提醒里存的就是它，要能存成 JSON。 */
export type XWrite =
  | { readonly action: 'post'; readonly text: string; readonly replyTo?: string; readonly quote?: string }
  | { readonly action: 'delete' | 'like' | 'unlike' | 'repost' | 'unrepost'; readonly tweet: string }
  | { readonly action: 'follow' | 'unfollow'; readonly user: string }

export interface XField {
  readonly label: string
  readonly value: string
}

export interface XDone {
  readonly ok: boolean
  /** 给 bot 看的结果。 */
  readonly message: string
  readonly data: Readonly<Record<string, unknown>>
}

/** 点赞这类开关式操作做成了、或者本来就是这样时的说法。 */
const DONE_WORDS: Readonly<Record<'like' | 'unlike' | 'repost' | 'unrepost' | 'follow' | 'unfollow', readonly [string, string]>> = {
  like: ['已点赞', '本来就点过赞'],
  unlike: ['已取消点赞', '本来就没点赞'],
  repost: ['已转推', '本来就转过'],
  unrepost: ['已取消转推', '本来就没转'],
  follow: ['已关注', '本来就关注了'],
  unfollow: ['已取消关注', '本来就没关注'],
}

function tweetLink(input: string): string {
  return /^https?:\/\//.test(input) ? input : tweetUrl('', tweetId(input))
}

function profileLink(input: string): string {
  return /^https?:\/\//.test(input) ? input : `https://x.com/${userHandle(input)}`
}

/** 审批卡标题、审计和提醒里用的一句话。 */
export function describe(write: XWrite): string {
  switch (write.action) {
    case 'post': {
      const text = truncate(write.text.replace(/\s+/g, ' '), 60)
      if (write.replyTo !== undefined) return t('回复推文：{text}', { text })
      if (write.quote !== undefined) return t('引用推文：{text}', { text })
      return t('发推：{text}', { text })
    }
    case 'delete':
      return t('删推：{link}', { link: tweetLink(write.tweet) })
    case 'like':
      return t('点赞：{link}', { link: tweetLink(write.tweet) })
    case 'unlike':
      return t('取消点赞：{link}', { link: tweetLink(write.tweet) })
    case 'repost':
      return t('转推：{link}', { link: tweetLink(write.tweet) })
    case 'unrepost':
      return t('取消转推：{link}', { link: tweetLink(write.tweet) })
    case 'follow':
      return t('关注：{link}', { link: profileLink(write.user) })
    case 'unfollow':
      return t('取消关注：{link}', { link: profileLink(write.user) })
  }
}

/** 这次操作针对的推文或主页；单纯发推没有。 */
export function linkOf(write: XWrite): string {
  switch (write.action) {
    case 'post':
      return write.replyTo !== undefined ? tweetLink(write.replyTo) : write.quote !== undefined ? tweetLink(write.quote) : ''
    case 'follow':
    case 'unfollow':
      return profileLink(write.user)
    default:
      return tweetLink(write.tweet)
  }
}

/** 审批卡上逐项列出的内容：发推时是完整正文。 */
export function fields(write: XWrite): readonly XField[] {
  if (write.action !== 'post') return []
  return [
    { label: t('正文'), value: write.text },
    ...(write.replyTo === undefined ? [] : [{ label: t('回复'), value: tweetLink(write.replyTo) }]),
    ...(write.quote === undefined ? [] : [{ label: t('引用'), value: tweetLink(write.quote) }]),
  ]
}

/** 照做一次，返回给 bot 看的结果。出错时抛 XPostError 或别的错。 */
export async function perform(xpost: XPost, write: XWrite): Promise<XDone> {
  switch (write.action) {
    case 'post': {
      const posted = await xpost.post({ text: write.text, ...(write.replyTo === undefined ? {} : { replyTo: write.replyTo }), ...(write.quote === undefined ? {} : { quote: write.quote }) })
      if (posted.id === '') return { ok: false, message: 'X 没报错，但也没给出新推文：可能被 X 悄悄拦下了，也可能只是读不出来。先确认（比如看看账号最近的推文），别直接重发。', data: { confirmed: false } }
      const note = posted.confirmed ? '' : '（发完马上读回来没读到，可能要过一会儿才看得到）'
      return { ok: true, message: `已发出：${posted.url}${note}`, data: { id: posted.id, url: posted.url, confirmed: posted.confirmed } }
    }
    case 'delete':
      await xpost.deleteTweet(write.tweet)
      return { ok: true, message: `已删除：${tweetLink(write.tweet)}`, data: {} }
    case 'like':
    case 'unlike':
    case 'repost':
    case 'unrepost': {
      const done = await xpost[write.action](write.tweet)
      const [changed, already] = DONE_WORDS[write.action]
      return { ok: true, message: `${done.already ? already : changed}：${tweetLink(write.tweet)}`, data: { already: done.already } }
    }
    case 'follow':
    case 'unfollow': {
      const done = await xpost[write.action](write.user)
      const [changed, already] = DONE_WORDS[write.action]
      const who = done.user.handle === '' ? write.user : `@${done.user.handle}`
      return { ok: true, message: `${done.already ? already : changed} ${who}`, data: { already: done.already, userId: done.user.id } }
    }
  }
}
