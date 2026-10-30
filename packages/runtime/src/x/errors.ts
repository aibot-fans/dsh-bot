import { XError, type XErrorCode } from 'aibot-x-post'
import { t } from 'pod-domain'

/** X 出错时给人看的说法；英文译文在 locales/en-x.ts。 */
const TEXTS: Readonly<Record<XErrorCode, string>> = {
  'not-logged-in': 'dsh-bot 的浏览器里没登录 X：在 设置 → 通用 → X 账号 里点“登录”，登录好再试',
  locked: 'X 锁了这个账号：在 dsh-bot 的浏览器里打开 x.com，按提示解锁后再试',
  suspended: 'X 停用了这个账号',
  automated: 'X 觉得这次操作像自动发的，拒绝了：先别重试，过一阵再做',
  duplicate: '和最近发过的一条重复了，X 不让发',
  'too-long': '推文太长了：普通账号最多 280 个字符，中文一个字算两个；有 Premium 的账号可以改发长帖（CreateNoteTweet）',
  'rate-limited': 'X 说操作太频繁了，先停一会儿再试',
  'not-found': '没找到这条推文或这个用户',
  already: '本来就是这个状态',
  blocked: '对方屏蔽了这个账号，做不了',
  'media-rejected': 'X 处理不了这个文件：换个格式、小一点的文件，或者少带几个再试',
  'not-ready': 'X 的网页没加载出来，过一会儿再试',
  'invalid-input': '参数不对',
  'x-error': 'X 返回了错误',
}

/** 一句说人话的原因，X 自己的说法附在括号里。 */
export function xErrorText(error: unknown): string {
  if (!(error instanceof XError)) return error instanceof Error ? error.message : String(error)
  const text = t(TEXTS[error.code])
  return error.message === '' ? text : t('{text}（{message}）', { text, message: error.message.slice(0, 300) })
}
