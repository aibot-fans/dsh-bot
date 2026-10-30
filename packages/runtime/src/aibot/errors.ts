import { t } from 'pod-domain'
/**
 * aibot 返回的错误：HTTP 状态、错误码和原因。错误码翻成一句能照着处理的中文，
 * 给设置页、bot 和日志用；原始 message 来自 aibot，可以直接给模型看。
 */
export class AibotError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Readonly<Record<string, unknown>>
  /** 服务端说多久以后再试（秒）：error.details.retryAfterSeconds 或 Retry-After 头。 */
  readonly retryAfterSeconds: number | null

  constructor(spec: { readonly status: number; readonly code: string; readonly message: string; readonly details?: Readonly<Record<string, unknown>>; readonly retryAfterSeconds?: number | null }) {
    super(spec.message)
    this.status = spec.status
    this.code = spec.code
    this.details = spec.details ?? {}
    this.retryAfterSeconds = spec.retryAfterSeconds ?? null
  }
}

/** 网络不通、超时、aibot 返回的不是 JSON：稍后自动重试。 */
export class AibotNetworkError extends Error {}

const SIGNUP: Readonly<Record<string, string>> = {
  pod_signup_ip_limit: '这个网络今天开通的设备太多，明天再试',
  pod_signup_network_limit: '这个网络今天开通的设备太多，明天再试',
  pod_signup_busy: '现在开通的人太多，稍后再试',
  pod_signup_paused: 'aibot 暂时不能开通',
  pod_unavailable: 'aibot 暂时不能开通',
}

const QUOTA: Readonly<Record<string, string>> = {
  pod_daily_quota_exhausted: '今天的免费次数用完了，明早 8 点恢复',
  pod_ip_device_limit: '这个网络今天使用 aibot 免费额度的设备太多，明早 8 点恢复',
  pod_free_paused: 'aibot 今天的免费额度已经发完，明早 8 点恢复',
  pod_free_unavailable: 'aibot 免费额度暂时不可用',
}

export const DEVICE_DISABLED = 'pod_device_disabled'
export const INVALID_KEY = 'invalid_api_key'
export const DISABLED_TEXT = '这台电脑上 dsh-bot 的 aibot 接入已被停用'

/** 开通失败时给你看的话。 */
export function signupText(error: AibotError): string {
  if (error.code === DEVICE_DISABLED) return t(DISABLED_TEXT)
  if (error.code === 'rate_limit_exceeded') return t('请求太频繁，稍后自动再试')
  const known = SIGNUP[error.code]
  return known === undefined ? t('开通失败：{message}', { message: error.message }) : t(known)
}

/** 额度类报错（402）的中文；不是额度问题返回 undefined。 */
export function quotaText(code: string): string | undefined {
  const known = QUOTA[code]
  return known === undefined ? undefined : t(known)
}

export function isQuotaCode(code: string): boolean {
  return QUOTA[code] !== undefined
}

/** 用登录的 X 账号读写 X 时额度用完，告诉 bot 的话。 */
export function localQuotaText(code: string): string {
  return t('{quota}。x_ 工具读写 X 也从这份免费次数里扣，今天别再重试，把情况告诉用户。', { quota: quotaText(code) ?? code })
}

/** 调 X 工具出错时告诉 bot 的话：额度、停用、频率、X 临时失败各说各的，其余用 aibot 的原话。 */
export function toolErrorText(code: string, message: string): string {
  const quota = quotaText(code)
  if (quota !== undefined) return t('{quota}。今天别再重试这个请求，把情况告诉用户；监控照常能用。', { quota })
  if (code === DEVICE_DISABLED) return t('{DISABLED_TEXT}，X 工具暂时不能用，告诉用户去设置里看看。', { DISABLED_TEXT: t(DISABLED_TEXT) })
  if (code === 'twitter_api_scope_denied') return t('这把 Key 没有这个工具的权限（dsh-bot 专用 Key 只能读数据和管理监控，不能发推）。要发推、点赞，用会话里别的 X 写工具；没有的话用共用浏览器。')
  if (code === 'rate_limit_exceeded' || code === 'too_many_requests') return t('调用太频繁，过一会儿再试。')
  if (code === 'subscription_quota_exceeded') return t('免费监控最多 40 个账号，已经满了：先删掉不需要的监控再加。')
  return message
}

const BIND: Readonly<Record<string, string>> = {
  pod_bind_unavailable: '绑定账号还没开放',
  pod_device_already_bound: '这台电脑上的 dsh-bot 已经绑定过账号了',
  pod_bind_rate_limited: '申请太频繁了，过一小时再试',
}

/** 绑定账号出错时给你看的话。 */
export function bindText(error: unknown): string {
  if (error instanceof AibotError) return error.code === DEVICE_DISABLED ? t(DISABLED_TEXT) : t(BIND[error.code] ?? '绑定失败：{message}', { message: error.message })
  return error instanceof Error ? error.message : String(error)
}
