import type { Page, PageVersionInfo, RoomMessage } from 'pod-domain'
import { apiGet, apiPost, mediaUrl } from './http.ts'

export type PageTheme = 'light' | 'dark'

export type ExportFormat = 'pdf' | 'png' | 'html'

export interface PageDetail {
  readonly page: Page
  /** 新的在前。 */
  readonly versions: readonly PageVersionInfo[]
}

/** 页面库的接口。显示和导出不是 JSON，用下面两个地址。 */
export const pageApi = {
  list: () => apiGet<{ readonly pages: readonly Page[] }>('/pages').then((result) => result.pages),
  trash: () => apiGet<{ readonly pages: readonly Page[] }>('/pages/trash').then((result) => result.pages),
  detail: (id: string) => apiGet<PageDetail>('/page', { id }),
  thread: (id: string) => apiGet<{ readonly messages: readonly RoomMessage[] }>('/page/thread', { id }).then((result) => result.messages),
  pin: (id: string, pinned: boolean) => apiPost<Page>('/page/pin', { id, pinned }),
  rename: (id: string, title: string) => apiPost<Page>('/page/rename', { id, title }),
  remove: (id: string) => apiPost<Page>('/page/delete', { id }),
  restore: (id: string) => apiPost<Page>('/page/restore', { id }),
  rollback: (id: string, version: number) => apiPost<Page>('/page/rollback', { id, version }),
  edit: (id: string, text: string) => apiPost<RoomMessage>('/page/edit', { id, text }),
}

/** iframe 的地址：给了 version 看那一版，不给看最新版；latest 是最新版本号，页面存了新版地址就变，iframe 跟着刷新。 */
export function pageViewUrl(id: string, options: { readonly version: number | undefined; readonly latest: number; readonly theme: PageTheme }): string {
  return mediaUrl('/page/view', { id, theme: options.theme, r: String(options.latest), ...(options.version === undefined ? {} : { v: String(options.version) }) })
}

function exportUrl(id: string, format: ExportFormat, version: number | undefined, theme: PageTheme): string {
  return mediaUrl('/page/export', { id, format, theme, ...(version === undefined ? {} : { v: String(version) }) })
}

/** 响应头里 RFC 5987 写法的文件名。 */
function fileName(disposition: string | null): string | undefined {
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? '')
  if (match === null) return undefined
  try {
    return decodeURIComponent(match[1] ?? '')
  } catch {
    return undefined
  }
}

/** 导出并下载：PDF 和长图要等共用浏览器生成几秒；失败时抛出服务端给的原因（比如没装 Chrome）。 */
export async function exportPage(input: { readonly id: string; readonly title: string; readonly format: ExportFormat; readonly version: number | undefined; readonly theme: PageTheme }): Promise<void> {
  const response = await fetch(exportUrl(input.id, input.format, input.version, input.theme), { credentials: 'same-origin' })
  if (!response.ok) throw new Error((await response.text()).trim() || `导出失败（${response.status}）`)
  const blob = await response.blob()
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = fileName(response.headers.get('content-disposition')) ?? `${input.title}.${input.format}`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(link.href), 30_000)
}
