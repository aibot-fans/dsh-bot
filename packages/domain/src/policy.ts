import { t } from './i18n.ts'
/**
 * 网络防护和站点规则：防止 bot 被网页诱导去调用本机的 dsh web 或家里的设备。
 * 默认不能访问 localhost、127.0.0.1、局域网地址和 file://；本地开发服务按地址加白名单。
 */

export type SiteMode = 'blocked' | 'read-only' | 'approve-writes' | 'free'

export interface SiteRule {
  readonly pattern: string
  readonly mode: SiteMode
  readonly note: string
}

export const SITE_MODE_LABELS: Readonly<Record<SiteMode, string>> = {
  blocked: '禁止',
  'read-only': '只读',
  'approve-writes': '写操作需审批',
  free: '免审批',
}

/** 内置的默认禁止清单：网银、支付、证券、网页邮箱、云服务控制台。可以修改。 */
export const DEFAULT_SITE_RULES: readonly SiteRule[] = [
  { pattern: '*.alipay.com', mode: 'blocked', note: '支付' },
  { pattern: 'pay.weixin.qq.com', mode: 'blocked', note: '支付' },
  { pattern: '*.paypal.com', mode: 'blocked', note: '支付' },
  { pattern: '*.icbc.com.cn', mode: 'blocked', note: '网银' },
  { pattern: '*.ccb.com', mode: 'blocked', note: '网银' },
  { pattern: '*.boc.cn', mode: 'blocked', note: '网银' },
  { pattern: '*.abchina.com', mode: 'blocked', note: '网银' },
  { pattern: '*.cmbchina.com', mode: 'blocked', note: '网银' },
  { pattern: '*.95599.cn', mode: 'blocked', note: '网银' },
  { pattern: '*.10jqka.com.cn', mode: 'read-only', note: '证券' },
  { pattern: '*.eastmoney.com', mode: 'read-only', note: '证券' },
  { pattern: 'mail.google.com', mode: 'blocked', note: '网页邮箱' },
  { pattern: 'outlook.live.com', mode: 'blocked', note: '网页邮箱' },
  { pattern: 'mail.qq.com', mode: 'blocked', note: '网页邮箱' },
  { pattern: 'mail.163.com', mode: 'blocked', note: '网页邮箱' },
  { pattern: 'console.aws.amazon.com', mode: 'blocked', note: '云服务控制台' },
  { pattern: 'console.cloud.google.com', mode: 'blocked', note: '云服务控制台' },
  { pattern: 'portal.azure.com', mode: 'blocked', note: '云服务控制台' },
  { pattern: '*.console.aliyun.com', mode: 'blocked', note: '云服务控制台' },
  { pattern: 'console.cloud.tencent.com', mode: 'blocked', note: '云服务控制台' },
]

function ipv4Private(host: string): boolean {
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a = 0, b = 0] = parts
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

function ipv6Private(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, '').toLowerCase()
  return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80') || value.startsWith('::ffff:127.') || value.startsWith('::ffff:10.') || value.startsWith('::ffff:192.168.')
}

/** 这个主机名本身指向本机或局域网吗（不做 DNS 解析；解析后的地址由调用方再查一次）。 */
export function isPrivateHost(host: string): boolean {
  const value = host.toLowerCase().replace(/\.$/, '')
  if (value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') || value.endsWith('.internal') || value.endsWith('.lan')) return true
  return ipv4Private(value) || (value.includes(':') && ipv6Private(value))
}

export type UrlCheck = { readonly ok: true; readonly url: URL } | { readonly ok: false; readonly reason: string }

/**
 * 网址能不能打开：只允许 http/https；默认拦本机和局域网，除非在白名单里。
 * @param allowedHosts - 你加了白名单的本地开发服务，例如 localhost:5173。
 */
export function checkUrl(raw: string, allowedHosts: readonly string[] = []): UrlCheck {
  const text = raw.trim()
  let url: URL
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`)
  } catch {
    return { ok: false, reason: t('网址格式不对') }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: t('不能打开 {protocol} 地址', { protocol: url.protocol }) }
  if (url.username !== '' || url.password !== '') return { ok: false, reason: t('网址里不能带账号密码') }
  const hostPort = url.port === '' ? url.hostname : `${url.hostname}:${url.port}`
  if (isPrivateHost(url.hostname) && !allowedHosts.includes(hostPort) && !allowedHosts.includes(url.hostname)) {
    return { ok: false, reason: t('默认不能访问本机和局域网地址（防止被网页诱导调用本机服务）；需要的话在设置里把它加进白名单') }
  }
  return { ok: true, url }
}

/** 你在地址栏里输的东西变成网址：像网址的补上 https://，像搜索词的（有空格、没有点）用必应搜。 */
export function addressToUrl(input: string): string {
  const text = input.trim()
  if (text === '' || text.includes('://')) return text
  const host = text.split(/[/?#]/)[0] ?? ''
  const looksLikeHost = /^[^\s]+$/.test(text) && (host.includes('.') || host.startsWith('localhost') || host.startsWith('['))
  return looksLikeHost ? `https://${text}` : `https://www.bing.com/search?q=${encodeURIComponent(text)}`
}

function matches(pattern: string, host: string): boolean {
  const p = pattern.toLowerCase()
  const h = host.toLowerCase()
  if (p.startsWith('*.')) return h === p.slice(2) || h.endsWith(p.slice(1))
  return h === p
}

/** 一个网站适用哪条站点规则：最具体（最长）的匹配优先，没有匹配时写操作需审批。 */
export function siteModeFor(host: string, rules: readonly SiteRule[]): { readonly mode: SiteMode; readonly rule: SiteRule | undefined } {
  const matched = rules.filter((rule) => matches(rule.pattern, host)).sort((left, right) => right.pattern.length - left.pattern.length)[0]
  return { mode: matched?.mode ?? 'approve-writes', rule: matched }
}
