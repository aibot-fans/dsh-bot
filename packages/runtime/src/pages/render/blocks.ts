import type { BlockWidth, PageBlock } from 'pod-domain'
import { renderChart } from './charts.ts'
import { renderGraph } from './graph.ts'
import { esc } from './html.ts'
import { inline, markdown } from './markdown.ts'
import { sanitizeHtml } from './sanitize.ts'
import { goto, renderAppBar, renderButton, renderCard, renderInput, renderRows, renderSegmented, renderTabBar, renderToggle } from './ui.ts'
import { renderBoard, renderHeatmap, renderMetrics, renderProgress, renderTable, renderTimeline, statusBadge } from './widgets.ts'

export interface RenderContext {
  /** 图片：asset:哈希 对应的内嵌数据。 */
  readonly assets: ReadonlyMap<string, string>
  /** 这一块所在区域大约多宽（像素），图表按它定 viewBox。 */
  readonly width: number
  /** 看板、跟踪表里组件放进卡片。 */
  readonly cards: boolean
  /** 同一页里不重复的 id（箭头定义用）。 */
  readonly uid: () => string
}

const FRACTIONS: Readonly<Record<BlockWidth, number>> = { full: 1, half: 0.5, third: 1 / 3, 'two-thirds': 2 / 3, quarter: 0.25 }

/** 这些组件本身就是文字或分隔，不套卡片。 */
const PLAIN = new Set<PageBlock['type']>(['heading', 'text', 'divider', 'callout', 'quote', 'metrics', 'appbar', 'tabbar', 'button', 'input', 'toggle', 'card', 'rows', 'segmented'])

const CALLOUT_TITLES = { info: '提示', ok: '好消息', warn: '注意', danger: '警告' } as const
const CALLOUT_TONES = { info: 'info', ok: 'ok', warn: 'warn', danger: 'bad' } as const

function image(src: string, alt: string, caption: string, height: number, ctx: RenderContext): string {
  const data = src.startsWith('asset:') ? ctx.assets.get(src.slice(6)) : undefined
  const style = height > 0 ? ` style="height:${height}px"` : ''
  const body = data === undefined ? `<div class="img-ph"${height > 0 ? style : ''}><span>${esc(alt || '图片')}</span></div>` : `<img src="${esc(data)}" alt="${esc(alt)}"${style}>`
  return `<figure class="figure">${body}${caption === '' ? '' : `<figcaption>${esc(caption)}</figcaption>`}</figure>`
}

function body(block: PageBlock, ctx: RenderContext, width: number): string {
  switch (block.type) {
    case 'heading': {
      const tag = `h${block.level + 1}`
      return `<${tag} class="heading">${esc(block.text)}</${tag}>`
    }
    case 'text':
      return `<div class="prose">${markdown(block.text)}</div>`
    case 'metrics':
      return renderMetrics(block)
    case 'chart':
      return renderChart(block, Math.round(width))
    case 'table':
      return renderTable(block)
    case 'flow':
    case 'diagram':
      return `${block.title === '' ? '' : `<h3 class="block-title">${esc(block.title)}</h3>`}${renderGraph(block, ctx.uid())}`
    case 'timeline':
      return renderTimeline(block)
    case 'heatmap':
      return renderHeatmap(block)
    case 'board':
      return renderBoard(block)
    case 'progress':
      return renderProgress(block)
    case 'callout':
      return `<div class="callout co-${block.tone}">${statusBadge(block.title || CALLOUT_TITLES[block.tone], CALLOUT_TONES[block.tone])}<div class="prose">${markdown(block.text)}</div></div>`
    case 'list': {
      const tag = block.style === 'number' ? 'ol' : 'ul'
      const items = block.items.map((item) => (block.style === 'check' ? `<li class="${item.done ? 'done' : ''}"><span class="check" aria-label="${item.done ? '已完成' : '未完成'}"></span>${inline(item.text)}</li>` : `<li>${inline(item.text)}</li>`))
      return `<${tag} class="list${block.style === 'check' ? ' checklist' : ''}">${items.join('')}</${tag}>`
    }
    case 'quote':
      return `<blockquote class="quote"><p>${inline(block.text)}</p>${block.by === '' ? '' : `<footer>— ${esc(block.by)}</footer>`}</blockquote>`
    case 'code':
      return `<pre class="code"${block.language === '' ? '' : ` data-lang="${esc(block.language)}"`}><code>${esc(block.code)}</code></pre>`
    case 'image':
      return image(block.src, block.alt, block.caption, block.height, ctx)
    case 'divider':
      return '<hr class="divider">'
    case 'html':
      return `<div class="free">${sanitizeHtml(block.html)}</div>`
    case 'appbar':
      return renderAppBar(block)
    case 'tabbar':
      return renderTabBar(block)
    case 'button':
      return renderButton(block)
    case 'input':
      return renderInput(block)
    case 'toggle':
      return renderToggle(block)
    case 'card':
      return renderCard(block)
    case 'rows':
      return renderRows(block)
    case 'segmented':
      return renderSegmented(block)
  }
}

/** 一个组件：按宽度占网格，看板里套卡片，写了 goto 的能点。 */
export function renderBlock(block: PageBlock, ctx: RenderContext): string {
  const width = ctx.width * FRACTIONS[block.width]
  const inner = body(block, ctx, Math.max(240, width - (ctx.cards ? 34 : 0)))
  const card = ctx.cards && !PLAIN.has(block.type)
  const jump = block.type === 'appbar' || block.type === 'tabbar' || block.type === 'rows' ? '' : goto(block.goto)
  return `<section class="blk b-${block.type} w-${block.width}${card ? ' card' : ''}"${jump}>${inner}</section>`
}

export function renderBlocks(blocks: readonly PageBlock[], ctx: RenderContext): string {
  return `<div class="blocks">${blocks.map((block) => renderBlock(block, ctx)).join('')}</div>`
}
