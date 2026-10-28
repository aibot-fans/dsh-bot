import { tweetId, userHandle } from 'aibot-x-post'
import { SITE_MODE_LABELS, xWriteMode, type PodSession } from 'pod-domain'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import type { XWrite } from '../x/actions.ts'
import type { XWriteOutcome } from '../x/writes.ts'
import { bool, failure, flag, podTool, str, success, text, type ToolValue } from './define.ts'

/** 免审批时要现开 x.com 再发请求，给足时间。 */
const TIMEOUT_MS = 120_000

const ASK_FIRST = '只在用户明确要求时做；默认要用户先批准，批准后结果会发给你。'

function outcome(result: XWriteOutcome): ToolValue {
  return result.ok ? success(result.message, result.data ?? {}) : failure(result.message)
}

function validTweet(value: string): boolean {
  try {
    tweetId(value)
    return true
  } catch {
    return false
  }
}

function validUser(value: string): boolean {
  if (/^\d{1,25}$/.test(value)) return true
  try {
    userHandle(value)
    return true
  } catch {
    return false
  }
}

/** 推文参数：必填，id 或链接。 */
function tweetArg(args: Readonly<Record<string, unknown>>): { readonly tweet: string; readonly undo: boolean } | string {
  const tweet = text(args, 'tweet')
  if (tweet === '') return '缺少 tweet'
  if (!validTweet(tweet)) return 'tweet 要填推文 id 或推文链接'
  return { tweet, undo: flag(args, 'undo') === true }
}

/**
 * 用 dsh-bot 浏览器里登录的 X 账号发推、删推、点赞、转推、关注（x_ 开头）。
 * 写操作按 x.com 的站点规则：默认交给用户批准，免审批的直接做，只读和禁止的不做；dsh web 对外开放时一律不做。
 */
export function xPostTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const current = (): PodSession => pod.registry.get(session.id) ?? session
  const write = async (input: XWrite): Promise<ToolValue> => outcome(await pod.x.writes.request(current(), input))
  const tweet = str('推文 id 或推文链接')
  const undo = (what: string) => bool(`true 表示取消${what}`)

  const account = podTool<Record<string, never>>({
    name: 'x_account',
    description: '看 dsh-bot 浏览器里登录的是哪个 X 账号（x_ 工具都用它），以及 X 写操作现在要不要用户批准。',
    properties: {},
    parse: () => ({}),
    timeoutMs: TIMEOUT_MS,
    run: async () => {
      const status = await pod.x.account.check()
      const mode = SITE_MODE_LABELS[xWriteMode(pod.settings.get().siteRules)]
      const data = { state: status.state, handle: status.handle, name: status.name, writes: mode }
      if (status.state === 'ready') return success(`登录的是 @${status.handle}${status.name === '' ? '' : `（${status.name}）`}。X 写操作：${mode}。`, data)
      if (status.state === 'signed-out') return success('dsh-bot 的浏览器里没登录 X。请用户在 设置 → 通用 → X 账号 里点“登录”，登录好再用 x_ 工具。', data)
      return failure(status.message === '' ? '没查到登录的 X 账号' : status.message)
    },
  })

  const post = podTool<{ readonly text: string; readonly replyTo: string; readonly quote: string }>({
    name: 'x_post',
    description: `用 dsh-bot 浏览器里登录的 X 账号发一条推文（只支持文字）；回复别人填 reply_to，引用填 quote。正文按用户的意思写好再发。${ASK_FIRST}`,
    properties: { text: str('推文正文'), reply_to: str('回复哪条推文：推文 id 或链接'), quote: str('引用哪条推文：推文 id 或链接') },
    required: ['text'],
    timeoutMs: TIMEOUT_MS,
    parse: (args) => {
      const body = typeof args.text === 'string' ? args.text.trim() : ''
      const replyTo = text(args, 'reply_to')
      const quote = text(args, 'quote')
      if (body === '') return '缺少 text'
      if (replyTo !== '' && !validTweet(replyTo)) return 'reply_to 要填推文 id 或推文链接'
      if (quote !== '' && !validTweet(quote)) return 'quote 要填推文 id 或推文链接'
      return { text: body, replyTo, quote }
    },
    run: (args) => write({ action: 'post', text: args.text, ...(args.replyTo === '' ? {} : { replyTo: args.replyTo }), ...(args.quote === '' ? {} : { quote: args.quote }) }),
  })

  const remove = podTool<{ readonly tweet: string }>({
    name: 'x_delete',
    description: `删掉登录账号自己的一条推文。${ASK_FIRST}`,
    properties: { tweet },
    required: ['tweet'],
    timeoutMs: TIMEOUT_MS,
    parse: tweetArg,
    run: (args) => write({ action: 'delete', tweet: args.tweet }),
  })

  const like = podTool<{ readonly tweet: string; readonly undo: boolean }>({
    name: 'x_like',
    description: `用登录的 X 账号给推文点赞，undo=true 取消点赞。${ASK_FIRST}`,
    properties: { tweet, undo: undo('点赞') },
    required: ['tweet'],
    timeoutMs: TIMEOUT_MS,
    parse: tweetArg,
    run: (args) => write({ action: args.undo ? 'unlike' : 'like', tweet: args.tweet }),
  })

  const repost = podTool<{ readonly tweet: string; readonly undo: boolean }>({
    name: 'x_repost',
    description: `用登录的 X 账号转推（不加评论；要加评论用 x_post 的 quote），undo=true 取消转推。${ASK_FIRST}`,
    properties: { tweet, undo: undo('转推') },
    required: ['tweet'],
    timeoutMs: TIMEOUT_MS,
    parse: tweetArg,
    run: (args) => write({ action: args.undo ? 'unrepost' : 'repost', tweet: args.tweet }),
  })

  const follow = podTool<{ readonly user: string; readonly undo: boolean }>({
    name: 'x_follow',
    description: `用登录的 X 账号关注用户，undo=true 取消关注。${ASK_FIRST}`,
    properties: { user: str('@用户名、用户名或主页链接'), undo: undo('关注') },
    required: ['user'],
    timeoutMs: TIMEOUT_MS,
    parse: (args) => {
      const user = text(args, 'user')
      if (user === '') return '缺少 user'
      if (!validUser(user)) return 'user 要填 @用户名、用户名或主页链接'
      return { user, undo: flag(args, 'undo') === true }
    },
    run: (args) => write({ action: args.undo ? 'unfollow' : 'follow', user: args.user }),
  })

  return [account, post, remove, like, repost, follow]
}
