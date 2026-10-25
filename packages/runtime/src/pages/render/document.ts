import { POSTER_DIMENSIONS, type PageDoc, type PageKind } from 'pod-domain'
import { esc } from './html.ts'
import { KIT_HASH, KIT_SCRIPT } from './kit.ts'
import { layout, type RenderMode } from './layouts.ts'
import { BASE_CSS } from './styles.ts'
import { POSTER_CSS, PROTO_CSS, SLIDES_CSS } from './styles-design.ts'
import { POSTER_TOKENS_CSS, TOKENS_CSS } from './theme.ts'

export type PageTheme = 'light' | 'dark' | 'auto'

export interface RenderPageInput {
  readonly title: string
  readonly kind: PageKind
  readonly doc: PageDoc
  /** 图片哈希 → 内嵌数据（data:…）。 */
  readonly assets: ReadonlyMap<string, string>
  /** 页头的小字：种类、第几版、更新时间。 */
  readonly meta: string
  /** view：在 Pod 里显示；export：给共享浏览器打印或截图（不带脚本）；file：导出的单个 HTML 文件。 */
  readonly mode: RenderMode
  readonly theme: PageTheme
}

const COMMON = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"

/** 页面路由的响应头：只放行内联样式和组件脚本，不能联网；sandbox 让页面就算被直接打开也是不透明来源。 */
export const VIEW_CSP = `${COMMON}; script-src '${KIT_HASH}'; frame-ancestors 'self'; sandbox allow-scripts`

/** 单个 HTML 文件里用 meta 写的 CSP（meta 不支持 frame-ancestors 和 sandbox）。 */
const FILE_CSP = `${COMMON}; script-src '${KIT_HASH}'`

/** 原型导出 PDF 时一屏一页，纸张按设备外框（屏幕加边框）的大小留边。 */
const DEVICE_FRAME = { phone: [414, 868], tablet: [856, 1216], desktop: [1280, 830] } as const

function pageRule(kind: PageKind, doc: PageDoc): string {
  if (kind === 'slides') return '@page{size:1280px 720px;margin:0}'
  if (kind === 'prototype') {
    const [width, height] = DEVICE_FRAME[doc.device]
    return `@page{size:${width + 80}px ${height + 120}px;margin:40px}`
  }
  if (kind === 'poster') {
    const { width, height } = POSTER_DIMENSIONS[doc.poster?.size ?? 'portrait']
    return `@page{size:${width}px ${height}px;margin:0}`
  }
  if (kind === 'dashboard' || kind === 'tracker') return '@page{size:A4 landscape;margin:12mm}'
  return '@page{size:A4;margin:14mm 12mm}'
}

function kindCss(kind: PageKind): string {
  if (kind === 'slides') return SLIDES_CSS
  if (kind === 'poster') return `${POSTER_TOKENS_CSS}\n${POSTER_CSS}`
  if (kind === 'prototype') return PROTO_CSS
  return ''
}

/** 拼出完整的页面 HTML。 */
export function renderPage(input: RenderPageInput): string {
  let counter = 0
  const body = layout({
    title: input.title,
    kind: input.kind,
    doc: input.doc,
    meta: input.meta,
    mode: input.mode,
    context: (width, cards) => ({ assets: input.assets, width, cards, uid: () => `arrow-${(counter += 1)}` }),
  })
  const theme = input.theme === 'auto' ? '' : ` data-theme="${input.theme}"`
  const csp = input.mode === 'file' ? FILE_CSP : input.mode === 'export' ? COMMON : ''
  const meta = csp === '' ? '' : `<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">`
  const script = input.mode === 'export' ? '' : `<script>${KIT_SCRIPT}</script>`
  const css = [TOKENS_CSS, BASE_CSS, kindCss(input.kind), pageRule(input.kind, input.doc)].join('\n')
  return `<!doctype html><html lang="zh-CN"${theme} data-accent="${input.doc.accent}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${meta}<title>${esc(input.title)}</title><style>${css}</style></head><body class="mode-${input.mode} kind-${input.kind}">${body}${script}</body></html>`
}
