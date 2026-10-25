/**
 * 共用浏览器的领域规则：标签页归属和控制权、读写分开、填写检查、外传检查。
 * 都是纯函数，浏览器那一侧只负责取到页面元素的描述。
 */

import { classifySensitiveFill } from './secrets.ts'

/** 标签页的归属者：某个 bot 的某条会话、你，或者 Pod 自己（盯网页时临时打开）。 */
export type TabOwner =
  | { readonly kind: 'bot'; readonly botId: string; readonly sessionId: string; readonly taskId: string | null }
  /** 你自己开的；roomId 是在哪个群的浏览器页里开的，那个群的浏览器页里也列出来。 */
  | { readonly kind: 'owner'; readonly roomId?: string }
  /** hidden：导出页面用的临时标签页，几秒就关，不在浏览器面板里列出。 */
  | { readonly kind: 'pod'; readonly hidden?: boolean }

/** 谁在操作：默认归属者；你接管后是你。 */
export type TabController = 'bot' | 'owner'

export interface TabDialog {
  readonly type: 'alert' | 'confirm' | 'prompt' | 'beforeunload'
  readonly message: string
  readonly defaultPrompt: string
}

export interface TabAction {
  readonly at: number
  readonly text: string
}

export interface TabInfo {
  readonly id: string
  readonly url: string
  readonly title: string
  readonly owner: TabOwner
  readonly controller: TabController
  readonly loading: boolean
  /** 无痕环境：不带登录状态，关掉就销毁。 */
  readonly incognito: boolean
  readonly dialog: TabDialog | null
  /** 页面弹出了选择文件的框。 */
  readonly fileChooser: boolean
  /** 请你接管时关联的等你事项。 */
  readonly waitId: string | null
  /** 最近的动作记录，浏览器视图里显示在画面旁边。 */
  readonly actions: readonly TabAction[]
  readonly createdAt: number
  readonly lastUsedAt: number
}

/** 页面里一个元素的描述：快照给每个可操作元素一个引用，点击和输入前用它判断读写。 */
export interface ElementInfo {
  readonly ref: string
  readonly tag: string
  readonly role: string
  /** input 的 type，或 button 的 type。 */
  readonly type: string
  readonly name: string
  readonly href: string
  /** 所在表单的提交方式：get、post，不在表单里为空。 */
  readonly formMethod: string
  readonly formAction: string
  /** 点它会提交表单。 */
  readonly isSubmit: boolean
  readonly autocomplete: string
  /** 输入框的 name、id、placeholder 和标签文字，用来认密码、验证码这类字段。 */
  readonly fieldName: string
}

export type ActionClass = { readonly write: false } | { readonly write: true; readonly reason: string }

const WRITE_WORDS_ZH = [
  '提交', '发送', '发布', '发表', '删除', '移除', '清空', '购买', '下单', '支付', '付款', '结算', '确认', '确定', '保存',
  '退出登录', '退出账号', '登出', '注销', '切换账号', '切换帐号', '转账', '订阅', '回复', '评论', '上传', '申请', '报名',
  '预订', '预约', '授权', '注册', '提现', '充值',
]
const WRITE_WORDS_EN =
  /\b(submit|send|post|publish|delete|remove|buy|purchase|order|checkout|pay|confirm|save|sign ?out|log ?out|switch account|transfer|subscribe|unsubscribe|reply|comment|upload|apply|register|sign ?up|book|reserve|authori[sz]e|withdraw)\b/i

/** 链接默认是读；只有这类明显会改状态的链接才算写。 */
const DESTRUCTIVE_LINK = /删除|退出登录|登出|注销|切换账号|取消订阅|\b(delete|log ?out|sign ?out|unsubscribe)\b/i

/** 搜索类按钮一律是读，哪怕它会提交表单。 */
const SEARCH_WORDS = /搜索|查询|筛选|过滤|\b(search|find|filter|go)\b/i

function writeWord(text: string): string | undefined {
  const zh = WRITE_WORDS_ZH.find((word) => text.includes(word))
  if (zh !== undefined) return zh
  return WRITE_WORDS_EN.exec(text)?.[0]
}

/** 点击这个元素算读还是写。写操作要审批：提交 POST 表单、点“提交、发送、删除、购买、确认”一类按钮、退出登录和切换账号。 */
export function classifyClick(element: ElementInfo): ActionClass {
  const label = element.name.trim()
  if (element.tag === 'a' && element.href !== '' && !element.isSubmit) {
    return DESTRUCTIVE_LINK.test(label) ? { write: true, reason: `链接「${label}」会改变账号或数据` } : { write: false }
  }
  if (SEARCH_WORDS.test(label) && writeWord(label) === undefined) return { write: false }
  const word = writeWord(label)
  if (word !== undefined) return { write: true, reason: `按钮「${label}」属于“${word}”一类操作` }
  if (element.isSubmit && element.formMethod === 'post') return { write: true, reason: '会提交 POST 表单' }
  return { write: false }
}

/** 在输入框里按回车会不会提交写操作：只有在 POST 表单里才算。 */
export function classifyEnter(element: ElementInfo | undefined): ActionClass {
  if (element === undefined || element.formMethod !== 'post') return { write: false }
  if (element.tag === 'textarea') return { write: false }
  return { write: true, reason: '在 POST 表单里按回车会提交表单' }
}

const OTP_FIELD = /验证码|校验码|动态码|动态密码|短信码|口令|\b(otp|2fa|mfa|totp|captcha|verification|verify code|security code|one[- ]time|passcode|cvv|cvc|cvn)\b/i
const CARD_FIELD = /卡号|银行卡|信用卡|\b(card ?number|cc-?number|credit card)\b/i
const PASSWORD_FIELD = /密码|\bpass(word|wd)?\b/i

/** 页面快照和审批卡里只说填没填、不给值的字段：和 bot 不填的字段同一套规则（快照脚本在页面里按这些正则认）。 */
export const SECRET_FIELD_PATTERNS: readonly RegExp[] = [PASSWORD_FIELD, OTP_FIELD, CARD_FIELD]
export const SECRET_AUTOCOMPLETE = /current-password|new-password|one-time-code|cc-/

export interface FillBlock {
  readonly kind: 'password' | 'otp' | 'card-number' | 'id-number' | 'secret'
  readonly reason: string
}

/** 填写检查：密码、验证码、银行卡号、身份证号、密钥一律不由 bot 填，交给你。 */
export function checkFill(element: ElementInfo | undefined, value: string): FillBlock | undefined {
  if (element !== undefined) {
    const field = `${element.fieldName} ${element.name} ${element.autocomplete}`
    if (element.type === 'password' || /current-password|new-password/.test(element.autocomplete) || PASSWORD_FIELD.test(element.fieldName)) {
      return { kind: 'password', reason: '这是密码框：bot 永远不填密码，请用户接管登录' }
    }
    if (/one-time-code/.test(element.autocomplete) || OTP_FIELD.test(field)) return { kind: 'otp', reason: '这是验证码或安全码：bot 不填，请用户接管' }
    if (/cc-number|cc-csc/.test(element.autocomplete) || CARD_FIELD.test(field)) return { kind: 'card-number', reason: '这是银行卡字段：bot 不填' }
  }
  const sensitive = classifySensitiveFill(value)
  if (sensitive === 'card-number') return { kind: 'card-number', reason: '内容像银行卡号：bot 不填' }
  if (sensitive === 'id-number') return { kind: 'id-number', reason: '内容像身份证号：bot 不填' }
  if (sensitive !== undefined) return { kind: 'secret', reason: '内容像密码或密钥：bot 不填' }
  return undefined
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const PHONE = /(?<!\d)1[3-9]\d{9}(?!\d)/g
const LONG_DIGITS = /\d{6,}/g
const CJK_RUN = /[一-鿿]{6,}/g
const CJK_WINDOW = 8

/** 长的中文句子切成重叠的 8 字片段，句子的一部分被夹带出去也认得出来。 */
function cjkFragments(run: string): readonly string[] {
  if (run.length < CJK_WINDOW) return [run]
  const windows: string[] = []
  for (let start = 0; start + CJK_WINDOW <= run.length; start += 2) windows.push(run.slice(start, start + CJK_WINDOW))
  return windows
}

/**
 * 私有内容片段：从你的档案和私密记忆里取出来、足够具体的片段（邮箱、手机号、长数字、六个字以上的中文短句）。
 * 太短的词（城市名、常用词）不算，免得正常搜索也被拦。
 */
export function privateFragments(texts: readonly string[]): readonly string[] {
  const found = new Set<string>()
  for (const text of texts) {
    for (const pattern of [EMAIL, PHONE, LONG_DIGITS]) {
      for (const match of text.matchAll(pattern)) found.add(match[0].toLowerCase())
    }
    for (const match of text.matchAll(CJK_RUN)) for (const fragment of cjkFragments(match[0])) found.add(fragment)
  }
  return [...found].slice(0, 3000)
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

/** 外传检查：要打开的网址或要填的内容里夹带了私有片段，或网址参数里塞了很长的数据。返回可疑的原因。 */
export function exfiltrationHits(candidate: string, fragments: readonly string[]): readonly string[] {
  const haystack = decoded(candidate).toLowerCase()
  const hits = fragments.filter((fragment) => haystack.includes(fragment)).map((fragment) => `夹带了你的私有信息“${fragment.slice(0, 12)}${fragment.length > 12 ? '…' : ''}”`)
  try {
    const url = new URL(candidate)
    const long = [...url.searchParams.values()].some((value) => value.length >= 300)
    if (long || url.hash.length >= 300) return [...hits, '网址里夹带了很长的数据']
  } catch {
    // 不是网址，只查片段。
  }
  return hits
}

/** 同一网页只开一次：比较时去掉 # 后面的部分和末尾的斜杠。 */
export function sameUrl(left: string, right: string): boolean {
  const normalize = (raw: string): string => {
    try {
      const url = new URL(raw)
      url.hash = ''
      return url.toString().replace(/\/$/, '')
    } catch {
      return raw
    }
  }
  return normalize(left) === normalize(right)
}

/** 按网站节流用的键：去掉 www.。 */
export function siteKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** 标签页归属者的显示名。 */
export function tabOwnerLabel(owner: TabOwner, botName: (botId: string) => string | undefined): string {
  if (owner.kind === 'owner') return '你'
  if (owner.kind === 'pod') return 'Pod'
  return botName(owner.botId) ?? '已归档的 bot'
}

/** 浏览器视图里的空闲阈值：bot 的标签页 10 分钟没人用就先存快照再关掉。 */
export const TAB_IDLE_MS = 10 * 60_000
/** 同一网站同时加载的标签页数和两次跳转的最小间隔。 */
export const SITE_CONCURRENCY = 2
export const SITE_GAP_MS = 1500
