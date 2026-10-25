import { esc, safeHref } from './html.ts'

/**
 * 自由排版的 HTML 片段按白名单清洗：只留排版用的标签和属性，去掉脚本、内嵌框架、表单、事件属性、
 * javascript 链接和外链资源。页面的 CSP 不放行内联脚本、也不能联网，这里是第二道防线。
 */

const ALLOWED = new Set(
  (
    'div span p br hr h1 h2 h3 h4 h5 h6 strong b em i u s small sub sup mark code pre blockquote ul ol li dl dt dd ' +
    'table thead tbody tfoot tr th td caption colgroup col figure figcaption section article header footer aside a img ' +
    'svg g path rect circle ellipse line polyline polygon text tspan defs lineargradient radialgradient stop'
  ).split(' '),
)

/** 这些标签连同里面的内容整个去掉。 */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'textarea', 'select', 'title', 'foreignobject', 'math', 'frameset', 'frame', 'applet', 'audio', 'video', 'canvas', 'form', 'button'])

const VOID = new Set(['br', 'hr', 'img', 'col', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'stop'])

const ATTRIBUTES = new Set(
  (
    'class style title colspan rowspan align width height alt href src id role aria-label ' +
    'viewbox d x y x1 y1 x2 y2 cx cy r rx ry points fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray ' +
    'opacity fill-opacity stroke-opacity transform text-anchor dominant-baseline font-size font-weight offset stop-color stop-opacity ' +
    'gradienttransform gradientunits preserveaspectratio xmlns'
  ).split(' '),
)

const SVG_CASE: Readonly<Record<string, string>> = { viewbox: 'viewBox', lineargradient: 'linearGradient', radialgradient: 'radialGradient', gradienttransform: 'gradientTransform', gradientunits: 'gradientUnits', preserveaspectratio: 'preserveAspectRatio' }

const IMAGE_DATA = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i

function cleanStyle(value: string): string {
  return value.replace(/url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding/gi, '').replace(/position\s*:\s*fixed/gi, 'position:static')
}

function attributes(tag: string, raw: string): string | undefined {
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  const kept: string[] = []
  for (const match of raw.matchAll(pattern)) {
    const name = (match[1] ?? '').toLowerCase()
    const value = (match[2] ?? match[3] ?? match[4] ?? '').replace(/&#(x?[0-9a-f]+);?/gi, (_entity, code: string) => String.fromCodePoint(Number.parseInt(code.startsWith('x') || code.startsWith('X') ? code.slice(1) : code, code.startsWith('x') || code.startsWith('X') ? 16 : 10) || 32))
    if (!ATTRIBUTES.has(name) || name.startsWith('on')) continue
    if (name === 'href') {
      const href = tag === 'a' ? safeHref(value) : undefined
      if (href !== undefined) kept.push(`href="${esc(href)}" rel="noopener noreferrer" target="_blank"`)
      continue
    }
    if (name === 'src') {
      if (tag !== 'img' || !IMAGE_DATA.test(value)) return undefined
      kept.push(`src="${esc(value.replace(/\s/g, ''))}"`)
      continue
    }
    if (/javascript:|vbscript:|data:/i.test(value) && name !== 'style') continue
    kept.push(`${SVG_CASE[name] ?? name}="${esc(name === 'style' ? cleanStyle(value) : value)}"`)
  }
  return kept.length === 0 ? '' : ` ${kept.join(' ')}`
}

export function sanitizeHtml(source: string): string {
  const tokens = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>|[^<]+|</g
  const stack: string[] = []
  let output = ''
  let dropping: string | undefined
  for (const match of source.matchAll(tokens)) {
    const text = match[0]
    if (text.startsWith('<!--')) continue
    const name = match[1]?.toLowerCase()
    const closing = text.startsWith('</')
    if (dropping !== undefined) {
      if (closing && name === dropping) dropping = undefined
      continue
    }
    if (name === undefined) {
      output += text.replace(/&(?![a-z][a-z0-9]*;|#\d+;|#x[0-9a-f]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      continue
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !text.endsWith('/>')) dropping = name
      continue
    }
    if (!ALLOWED.has(name)) continue
    const tag = SVG_CASE[name] ?? name
    if (closing) {
      const at = stack.lastIndexOf(tag)
      if (at === -1) continue
      output += stack.splice(at).reverse().map((open) => `</${open}>`).join('')
      continue
    }
    const attrs = attributes(name, match[2] ?? '')
    if (attrs === undefined) continue
    const selfClosing = VOID.has(name) || text.endsWith('/>')
    if (selfClosing) {
      output += name === 'br' || name === 'hr' || name === 'img' || name === 'col' ? `<${tag}${attrs}>` : `<${tag}${attrs}/>`
      continue
    }
    output += `<${tag}${attrs}>`
    stack.push(tag)
  }
  return output + stack.reverse().map((open) => `</${open}>`).join('')
}
