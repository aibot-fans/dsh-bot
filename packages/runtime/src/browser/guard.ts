import { lookup } from 'node:dns/promises'
import { SITE_CONCURRENCY, SITE_GAP_MS, checkUrl, isPrivateHost, siteKey, type UrlCheck } from 'pod-domain'
import type { CdpEvent } from './cdp.ts'
import type { BrowserTab } from './tab.ts'

/**
 * 网址能不能打开：先按规则查（只允许 http/https，默认拦本机和局域网），再解析域名，
 * 解析到本机或局域网地址的也拦下（防 DNS 重绑定）。白名单里的地址不查。
 */
export async function checkReachable(raw: string, allowedHosts: readonly string[]): Promise<UrlCheck> {
  const checked = checkUrl(raw, allowedHosts)
  if (!checked.ok) return checked
  const host = checked.url.hostname
  const hostPort = checked.url.port === '' ? host : `${host}:${checked.url.port}`
  if (allowedHosts.includes(host) || allowedHosts.includes(hostPort)) return checked
  const addresses = await lookup(host, { all: true }).catch(() => [])
  if (addresses.some((address) => isPrivateHost(address.address))) return { ok: false, reason: '这个网址解析到了本机或局域网地址，默认不能访问' }
  return checked
}

/**
 * 页面里的请求也要防：网页可能用图片、脚本、跳转去碰本机的 dsh web 或家里的设备。
 * 用 Fetch 拦截字面上指向本机或局域网的请求（包括跳转），白名单以外的一律失败。
 * 拦截模式只匹配可疑的地址，普通请求不经过 Pod。
 */
export const GUARD_PATTERNS: readonly { readonly urlPattern: string }[] = [
  '*://localhost*',
  '*://127.*',
  '*://10.*',
  '*://192.168.*',
  '*://172.*',
  '*://169.254.*',
  '*://0.*',
  '*://100.*',
  '*://[*',
  '*.localhost*',
  '*.local/*',
  '*.local:*',
  '*.lan/*',
  '*.lan:*',
  '*.internal*',
].map((urlPattern) => ({ urlPattern }))

export async function enableGuard(tab: BrowserTab): Promise<void> {
  await tab.send('Fetch.enable', { patterns: GUARD_PATTERNS })
}

/** 处理一个被拦下来的请求：真指向本机或局域网就让它失败，误伤的放行。 */
export async function handlePaused(tab: BrowserTab, event: CdpEvent, allowedHosts: readonly string[]): Promise<string | undefined> {
  const requestId = String(event.params.requestId ?? '')
  const request = (event.params.request ?? {}) as { readonly url?: string }
  const url = request.url ?? ''
  const checked = checkUrl(url, allowedHosts)
  if (checked.ok || url.startsWith('data:') || url.startsWith('blob:')) {
    await tab.send('Fetch.continueRequest', { requestId }).catch(() => undefined)
    return undefined
  }
  await tab.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => undefined)
  return url
}

/** 按网站节流：同一网站同时加载的标签页不超过 2 个，两次跳转至少间隔 1.5 秒，少触发网站风控。 */
export class SiteThrottle {
  private readonly active = new Map<string, number>()
  private readonly lastStart = new Map<string, number>()
  private waiters: (() => void)[] = []

  async acquire(url: string, signal?: AbortSignal): Promise<() => void> {
    const key = siteKey(url)
    for (;;) {
      if (signal?.aborted === true) throw new Error('已取消')
      const busy = this.active.get(key) ?? 0
      const gap = Date.now() - (this.lastStart.get(key) ?? 0)
      if (busy < SITE_CONCURRENCY && gap >= SITE_GAP_MS) break
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, busy < SITE_CONCURRENCY ? SITE_GAP_MS - gap : 2000)
        function done(): void {
          clearTimeout(timer)
          resolve()
        }
        this.waiters = [...this.waiters, done]
      })
    }
    this.active.set(key, (this.active.get(key) ?? 0) + 1)
    this.lastStart.set(key, Date.now())
    let released = false
    return () => {
      if (released) return
      released = true
      this.active.set(key, Math.max(0, (this.active.get(key) ?? 1) - 1))
      const waiters = this.waiters
      this.waiters = []
      for (const wake of waiters) wake()
    }
  }
}
