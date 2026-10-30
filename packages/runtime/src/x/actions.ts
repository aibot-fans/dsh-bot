import { XError, endpointName, uploadMedia, variablesOf, type XClient, type XRequest } from 'aibot-x-post'
import { t, truncate } from 'pod-domain'
import { dig, record, strings, textAt } from './json.ts'
import { kindLabel, readMedia, sizeLabel, type XMedia } from './media.ts'

/** 一次 X 写操作：按目录补全好的请求，和要先传的文件。审批卡和“状态未知”提醒里存的就是它，要能存成 JSON。 */
export interface XWrite {
  readonly request: XRequest
  /** 执行时先传，拿到的 media_id 按顺序填进 variables.media.media_entities。 */
  readonly media?: readonly XMedia[]
}

export interface XField {
  readonly label: string
  readonly value: string
}

/** 常用写操作的叫法；别的就用接口名。 */
const LABELS: Readonly<Record<string, string>> = {
  CreateTweet: '发推',
  DeleteTweet: '删推',
  FavoriteTweet: '点赞',
  UnfavoriteTweet: '取消点赞',
  CreateRetweet: '转推',
  DeleteRetweet: '取消转推',
  CreateBookmark: '加书签',
  DeleteBookmark: '删书签',
  PinTweet: '置顶推文',
  UnpinTweet: '取消置顶推文',
  'POST /1.1/friendships/create.json': '关注',
  'POST /1.1/friendships/destroy.json': '取消关注',
  'POST /1.1/blocks/create.json': '拉黑',
  'POST /1.1/blocks/destroy.json': '取消拉黑',
  'POST /1.1/mutes/users/create.json': '静音',
  'POST /1.1/mutes/users/destroy.json': '取消静音',
}
/** 带视频时要传完、等 X 处理完。 */
const UPLOAD_TIMEOUT_MS = 10 * 60_000

function isId(value: unknown): value is string | number {
  return (typeof value === 'string' || typeof value === 'number') && /^\d{1,25}$/.test(String(value))
}

/** 请求里的参数：GraphQL 看 variables，REST 看查询参数和请求体。 */
function argumentsOf(request: XRequest): Readonly<Record<string, unknown>> {
  return request.path.startsWith('/graphql/') ? variablesOf(request) : { ...request.params, ...request.data }
}

function tweetText(write: XWrite): string {
  return textAt(argumentsOf(write.request), 'tweet_text')
}

function labelOf(write: XWrite): string {
  const name = endpointName(write.request)
  if (name === 'CreateTweet') {
    const args = argumentsOf(write.request)
    if (isId(dig(args, 'reply', 'in_reply_to_tweet_id'))) return t('回复推文')
    if (textAt(args, 'attachment_url') !== '') return t('引用推文')
  }
  const known = LABELS[name]
  return known === undefined ? name : t(known)
}

/** 常用的写操作（上面 LABELS 里的：发推、删推、点赞、转推、书签、置顶、关注、拉黑、静音）：x.com 免审批时只直接做这些。 */
export function isRoutine(write: XWrite): boolean {
  return LABELS[endpointName(write.request)] !== undefined
}

/** 这次操作针对的推文或用户；找不到就是空串。 */
export function linkOf(write: XWrite): string {
  const args = argumentsOf(write.request)
  const tweet = [args.tweet_id, args.tweetId, args.focalTweetId, args.source_tweet_id, dig(args, 'reply', 'in_reply_to_tweet_id')].find(isId)
  if (tweet !== undefined) return `https://x.com/i/status/${tweet}`
  const quoted = textAt(args, 'attachment_url')
  if (/^https:\/\/(x|twitter)\.com\//.test(quoted)) return quoted
  const user = [args.user_id, args.userId].find(isId)
  if (user !== undefined) return `https://x.com/i/user/${user}`
  const handle = textAt(args, 'screen_name')
  return /^\w{1,15}$/.test(handle) ? `https://x.com/${handle}` : ''
}

/** 审批卡标题、审计和提醒里用的一句话。 */
export function describe(write: XWrite): string {
  const count = write.media?.length ?? 0
  const words = truncate(tweetText(write).replace(/\s+/g, ' ').trim(), 60)
  const text = count === 0 ? words : words === '' ? t('{count} 个附件', { count }) : t('{text}（带 {count} 个附件）', { text: words, count })
  const target = text === '' ? linkOf(write) : text
  const label = labelOf(write)
  return target === '' ? label : t('{label}：{target}', { label, target })
}

/** 审批卡上逐项列出的内容：接口、正文、照原样要发的参数，和每个附件（名字、种类、大小、说明文字）。 */
export function fields(write: XWrite): readonly XField[] {
  const request = write.request
  const text = tweetText(write)
  return [
    { label: t('接口'), value: `${request.method} ${request.path}` },
    ...(text === '' ? [] : [{ label: t('正文'), value: text }]),
    { label: t('参数'), value: JSON.stringify(argumentsOf(request), null, 2) },
    ...(write.media ?? []).flatMap((item, index) => [
      { label: t('附件 {index}', { index: index + 1 }), value: `${item.name} · ${kindLabel(item.kind)} · ${sizeLabel(item.size)}` },
      ...(item.alt === undefined ? [] : [{ label: t('附件 {index} 的说明', { index: index + 1 }), value: item.alt }]),
    ]),
  ]
}

/** 要发到 X 上的文字：参数里所有的字符串和附件的说明文字，查有没有夹带私有信息用。 */
export function outgoingText(write: XWrite): string {
  return [...strings(argumentsOf(write.request)), ...(write.media ?? []).map((item) => item.alt ?? '')].filter((part) => part !== '').join('\n')
}

/** 能不能带文件：像 CreateTweet 那样 variables 里有 media.media_entities 的 GraphQL 写操作。 */
export function acceptsMedia(request: XRequest): boolean {
  return request.method === 'POST' && request.path.startsWith('/graphql/') && Array.isArray(record(variablesOf(request).media)?.media_entities)
}

function withMedia(request: XRequest, ids: readonly string[]): XRequest {
  const variables = variablesOf(request)
  const media = { ...record(variables.media), media_entities: ids.map((media_id) => ({ media_id, tagged_users: [] })) }
  return { ...request, data: { ...request.data, variables: { ...variables, media } } }
}

/** 照做一次：有文件先传，再发请求，返回 X 的原始响应。 */
export async function perform(client: XClient, write: XWrite): Promise<unknown> {
  const files = await readMedia(write.media ?? [])
  const ids =
    files.length === 0
      ? []
      : await uploadMedia(client, [...files], { timeoutMs: UPLOAD_TIMEOUT_MS }).catch((error: unknown) => {
          throw error instanceof XError ? error : new XError('media-rejected', error instanceof Error ? error.message : String(error))
        })
  return client.dispatch(ids.length === 0 ? write.request : withMedia(write.request, ids))
}

/** 发推成功时新推文的链接；别的写操作是空串。 */
export function createdLink(response: unknown): string {
  const id = dig(response, 'data', 'create_tweet', 'tweet_results', 'result', 'rest_id')
  return isId(id) ? `https://x.com/i/status/${id}` : ''
}
