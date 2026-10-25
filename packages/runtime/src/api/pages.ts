import type { PageTheme } from '../pages/render/document.ts'
import { VIEW_CSP, renderPage } from '../pages/render/document.ts'
import { capture, captureWidth } from '../pages/export.ts'
import type { FetchRoute } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { POD_API_PREFIX, get, post, type RouteSpec } from './router.ts'

/** 下载的文件不在 dsh 的页面里执行任何东西。 */
const SANDBOX = "default-src 'none'; sandbox"

/** 页面库的接口：列表、回收站、详情和版本、置顶、改名、删除恢复、回滚、修改对话。 */
export function pageRoutes(pod: PodRuntime): readonly RouteSpec[] {
  const library = pod.pageLibrary
  return [
    get('/pages', (input) => library.list(input)),
    get('/pages/trash', () => library.trash()),
    get('/page', (input) => library.detail(input)),
    get('/page/thread', (input) => library.thread(input)),
    post('/page/pin', (input) => library.pin(input)),
    post('/page/rename', (input) => library.rename(input)),
    post('/page/delete', (input) => library.remove(input)),
    post('/page/restore', (input) => library.restore(input)),
    post('/page/rollback', (input) => library.rollback(input)),
    post('/page/edit', (input) => library.edit(input)),
  ]
}

function plain(status: number, text: string): Response {
  return new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
}

function versionOf(raw: string | null): number | undefined {
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function themeOf(raw: string | null): PageTheme {
  return raw === 'light' || raw === 'dark' ? raw : 'auto'
}

/** 下载用的文件名：去掉路径里不能用的字符，中文按 RFC 5987 编码。 */
function attachment(title: string, extension: string): string {
  const clean = `${title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || '页面'}.${extension}`
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename*=UTF-8''${encoded}`
}

/**
 * 显示和导出页面（不是 JSON，所以单独注册）：
 * - /page/view：给 Pod 里的 iframe（sandbox="allow-scripts"，不带 allow-same-origin）。CSP 只放行内联样式和 Pod 的组件脚本，
 *   不能联网；响应头里的 sandbox 让页面就算被单独打开也是不透明来源，碰不到 dsh 的登录状态。
 * - /page/export：PDF 和 PNG 用共用浏览器生成，HTML 是带组件脚本的单个文件。
 */
export function pageViewRoutes(pod: PodRuntime): readonly FetchRoute[] {
  const view: FetchRoute = {
    path: `${POD_API_PREFIX}/page/view`,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const params = new URL(request.url).searchParams
      const source = pod.pages.source(params.get('id') ?? '', versionOf(params.get('v')))
      if (source === undefined) return plain(404, '找不到这个页面')
      const { version } = source
      const html = renderPage({ title: version.title, kind: version.kind, doc: version.doc, assets: source.assets, meta: source.meta, mode: 'view', theme: themeOf(params.get('theme')) })
      return new Response(html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': VIEW_CSP,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
        },
      })
    },
  }
  const download: FetchRoute = {
    path: `${POD_API_PREFIX}/page/export`,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const params = new URL(request.url).searchParams
      const source = pod.pages.source(params.get('id') ?? '', versionOf(params.get('v')))
      if (source === undefined) return plain(404, '找不到这个页面')
      const { version } = source
      const format = params.get('format')
      const input = { title: version.title, kind: version.kind, doc: version.doc, assets: source.assets, meta: source.meta }
      if (format === 'html') {
        const html = renderPage({ ...input, mode: 'file', theme: 'auto' })
        return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-disposition': attachment(version.title, 'html'), 'content-security-policy': SANDBOX, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
      }
      if (format !== 'pdf' && format !== 'png') return plain(400, 'format 只能是 pdf、png 或 html')
      if (pod.browser.browser.executable === undefined) return plain(503, '没找到本机的 Chrome，导出 PDF 和图片要用它；可以先导出 HTML')
      // PDF 一律浅色（打印用）；长图跟着你现在看的深浅色。
      const theme = format === 'png' && params.get('theme') === 'dark' ? 'dark' : 'light'
      try {
        const data = await capture(pod.browser.browser, renderPage({ ...input, mode: 'export', theme }), format, captureWidth(version.kind, version.doc))
        return new Response(new Uint8Array(data), {
          status: 200,
          headers: { 'content-type': format === 'pdf' ? 'application/pdf' : 'image/png', 'content-disposition': attachment(version.title, format), 'content-security-policy': SANDBOX, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
        })
      } catch (error) {
        pod.ctx.logger.warn('导出页面失败', error)
        return plain(500, `导出失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
  return [view, download]
}
