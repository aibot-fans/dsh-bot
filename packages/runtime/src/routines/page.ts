import { checkUrl, t } from 'pod-domain'
import { checkReachable } from '../browser/guard.ts'
import type { PageContent } from './service.ts'

const TIMEOUT_MS = 20_000
const MAX_BYTES = 2_000_000

/** HTML 转成纯文本：去掉脚本、样式和标签，解开常见实体。 */
export function htmlToText(html: string): { readonly title: string; readonly text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? ''
  const text = html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
  return { title, text }
}

/**
 * 没有共用浏览器时读网页：直接请求，解析出正文。
 * 先解析域名，指向本机或局域网的一律拒绝（防 DNS 重绑定）。
 */
export async function readPageOverHttp(raw: string, allowedHosts: readonly string[] = []): Promise<PageContent> {
  const checked = await checkReachable(raw, allowedHosts)
  if (!checked.ok) throw new Error(checked.reason)
  const response = await fetch(checked.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) DeepSeekPod/0.2', accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
  })
  if (!response.ok) throw new Error(t('网页返回 {status}', { status: response.status }))
  const final = checkUrl(response.url, allowedHosts)
  if (!final.ok) throw new Error(t('跳转到了不能访问的地址：{reason}', { reason: final.reason }))
  const buffer = await response.arrayBuffer()
  const body = new TextDecoder().decode(buffer.byteLength > MAX_BYTES ? buffer.slice(0, MAX_BYTES) : buffer)
  const type = response.headers.get('content-type') ?? ''
  return type.includes('html') ? htmlToText(body) : { title: checked.url.hostname, text: body }
}
