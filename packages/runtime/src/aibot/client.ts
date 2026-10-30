import { t } from 'pod-domain'
import type { XUsage } from '../x/meter.ts'
import { AibotError, AibotNetworkError } from './errors.ts'

/** aibot 的地址；开发时可以用 POD_AIBOT_URL 指到别的环境。 */
export const AIBOT_URL = process.env.POD_AIBOT_URL ?? 'https://api.aibot.fans'
/** 绑定账号时打开的网页。 */
export const AIBOT_SITE = 'https://aibot.fans'

const REQUEST_TIMEOUT_MS = 20_000
/** 用登录的 X 账号读写 X 前扣次数最多等多久：等不到就照常做、不扣，不让读写 X 卡太久。 */
const LOCAL_USAGE_TIMEOUT_MS = 8_000

export type Json = Readonly<Record<string, unknown>>

export function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** ISO 时间或毫秒数转成毫秒；认不出来返回 null。 */
export function toTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || value === '') return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

export function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.name === 'TimeoutError' ? t('超时了') : error.message
  return String(error)
}

/** 请求没发出去或没等到回复时的一句话：超时说等了多久，别的说连不上。 */
export function unreachable(error: unknown, timeoutMs: number): AibotNetworkError {
  if (error instanceof Error && error.name === 'TimeoutError') return new AibotNetworkError(t('aibot {round} 秒内没有回复', { round: Math.round(timeoutMs / 1000) }))
  return new AibotNetworkError(t('连不上 aibot：{reasonOf}', { reasonOf: reasonOf(error) }))
}

/** 网络问题给你和 bot 看的话（AibotNetworkError 自己已经说清楚了）。 */
export function networkText(error: unknown): string {
  return error instanceof AibotNetworkError ? error.message : t('连不上 aibot：{reasonOf}', { reasonOf: reasonOf(error) })
}

function parseJson(body: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(body)
    return isJson(value) ? value : undefined
  } catch {
    return undefined
  }
}

function errorFrom(response: Response, body: Json | undefined): AibotError {
  const error = isJson(body?.error) ? body.error : {}
  const details = isJson(error.details) ? error.details : {}
  const header = Number(response.headers.get('retry-after'))
  const retryAfterSeconds = typeof details.retryAfterSeconds === 'number' ? details.retryAfterSeconds : Number.isFinite(header) && header > 0 ? header : null
  return new AibotError({
    status: response.status,
    code: text(error.code) || `http_${response.status}`,
    message: text(error.message) || t('aibot 返回 HTTP {status}', { status: response.status }),
    details,
    retryAfterSeconds,
  })
}

export interface AibotPage {
  readonly data: unknown
  readonly meta: Json
}

/**
 * aibot 的 REST 接口：开通、设备状态、补拉事件、绑定账号，用登录的 X 账号读写 X 时扣次数。
 * Key 只放在请求头里，不进日志；出错抛 AibotError（带错误码）或 AibotNetworkError（网络问题）。
 */
export class AibotClient {
  private readonly baseUrl: string

  constructor(baseUrl: string = AIBOT_URL) {
    this.baseUrl = baseUrl
  }

  url(path: string): URL {
    return new URL(path, this.baseUrl)
  }

  async request(
    method: 'GET' | 'POST',
    path: string,
    options: { readonly key?: string; readonly body?: unknown; readonly query?: Readonly<Record<string, string | number | undefined>>; readonly timeoutMs?: number } = {},
  ): Promise<AibotPage> {
    const url = this.url(path)
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value))
    }
    const headers: Record<string, string> = { accept: 'application/json' }
    if (options.key !== undefined) headers.authorization = `Bearer ${options.key}`
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    let response: Response
    try {
      response = await fetch(url, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: AbortSignal.timeout(timeoutMs) })
    } catch (error) {
      throw unreachable(error, timeoutMs)
    }
    const body = parseJson(await response.text().catch(() => ''))
    if (!response.ok) throw errorFrom(response, body)
    if (body === undefined) throw new AibotNetworkError(t('aibot 返回的内容看不懂（HTTP {status}）', { status: response.status }))
    return { data: body.data, meta: isJson(body.meta) ? body.meta : {} }
  }

  /** 用安装码开通：同一个安装码拿回同一把 Key。不发机器名、用户名。 */
  async provision(installSecret: string, podVersion: string): Promise<{ readonly apiKey: string; readonly deviceId: string; readonly created: boolean }> {
    const { data } = await this.request('POST', '/pod/devices', { body: { installSecret, platform: process.platform.slice(0, 32), podVersion: podVersion.slice(0, 32) } })
    const value = isJson(data) ? data : {}
    const device = isJson(value.device) ? value.device : {}
    const apiKey = text(value.apiKey)
    if (apiKey === '') throw new AibotNetworkError(t('aibot 开通成功但没有返回 Key'))
    return { apiKey, deviceId: text(device.id), created: value.created === true }
  }

  async device(key: string): Promise<Json> {
    const { data } = await this.request('GET', '/pod/device', { key })
    return isJson(data) ? data : {}
  }

  /** 补拉事件：从新到旧，一页最多 100 条。 */
  async events(key: string, since: string, cursor?: string): Promise<{ readonly events: readonly unknown[]; readonly next: string | undefined }> {
    const { data, meta } = await this.request('GET', '/twitter/monitor/events', { key, query: { since, limit: 100, cursor } })
    const list = Array.isArray(data) ? data : isJson(data) && Array.isArray(data.items) ? data.items : isJson(data) && Array.isArray(data.events) ? data.events : []
    const next = text(meta.nextCursor)
    return { events: list, next: next === '' ? undefined : next }
  }

  async bindStart(key: string): Promise<Json> {
    const { data } = await this.request('POST', '/pod/bind', { key, body: {} })
    return isJson(data) ? data : {}
  }

  async bindPoll(key: string, id: string): Promise<Json> {
    const { data } = await this.request('GET', `/pod/bind/${encodeURIComponent(id)}`, { key })
    return isJson(data) ? data : {}
  }

  /** 用登录的 X 账号访问 X 前扣次数：只发工具名、读还是写、带几个文件，不发请求的内容。 */
  async chargeLocal(key: string, usage: XUsage): Promise<Json> {
    const { data } = await this.request('POST', '/pod/local-usage', { key, body: usage, timeoutMs: LOCAL_USAGE_TIMEOUT_MS })
    return isJson(data) ? data : {}
  }

  /** X 那边没做成：凭扣的时候给的回执把次数退回去。 */
  async refundLocal(key: string, receipt: string, reason: string): Promise<Json> {
    const { data } = await this.request('POST', '/pod/local-usage/refund', { key, body: { receipt, reason } })
    return isJson(data) ? data : {}
  }
}
