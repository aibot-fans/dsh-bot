import { POSTER_DIMENSIONS, PAGE_KIND_LABELS, type PageBlock, type PageDoc, type PageKind, type Screen, type Slide } from 'pod-domain'
import { renderBlock, renderBlocks, type RenderContext } from './blocks.ts'
import { esc } from './html.ts'
import { accentPair } from './theme.ts'

export type RenderMode = 'view' | 'export' | 'file'

export interface LayoutInput {
  readonly title: string
  readonly kind: PageKind
  readonly doc: PageDoc
  readonly meta: string
  readonly mode: RenderMode
  readonly context: (width: number, cards: boolean) => RenderContext
}

/** 每种页面正文区域多宽（像素），图表按它画。 */
const CONTENT_WIDTH: Readonly<Record<'report' | 'dashboard' | 'tracker' | 'diagram', number>> = { report: 880, dashboard: 1280, tracker: 1280, diagram: 1200 }

function header(input: LayoutInput): string {
  const subtitle = input.doc.subtitle === '' ? '' : `<p class="subtitle">${esc(input.doc.subtitle)}</p>`
  return `<header class="page-head"><div class="eyebrow">${esc(PAGE_KIND_LABELS[input.kind])}</div><h1>${esc(input.title)}</h1>${subtitle}<div class="meta">${esc(input.meta)}</div></header>`
}

function documentPage(input: LayoutInput, kind: 'report' | 'dashboard' | 'tracker' | 'diagram'): string {
  const cards = kind === 'dashboard' || kind === 'tracker'
  return `<main class="page k-${kind}">${header(input)}${renderBlocks(input.doc.blocks, input.context(CONTENT_WIDTH[kind], cards))}</main>`
}

// ---------- 幻灯片 ----------

const SLIDE_INNER = 1280 - 144
/** 幻灯片里的图按窄一些的宽度画再放大，图上的字在投影时也看得清。 */
const SLIDE_ZOOM = 1.4

function slideBody(slide: Slide, index: number, input: LayoutInput): string {
  const blocks = (list: readonly PageBlock[], width: number): string => (list.length === 0 ? '' : renderBlocks(list, input.context(width / SLIDE_ZOOM, false)))
  const lead = slide.subtitle === '' ? '' : `<p class="s-lead">${esc(slide.subtitle)}</p>`
  switch (slide.layout) {
    case 'title':
      return `<div class="s-kicker">${esc(input.title === slide.title ? PAGE_KIND_LABELS.slides : input.title)}</div><h1>${esc(slide.title || input.title)}</h1>${lead}${blocks(slide.blocks, SLIDE_INNER)}`
    case 'section':
      return `<div class="s-num">${String(index + 1).padStart(2, '0')}</div><h2>${esc(slide.title)}</h2>${lead}`
    case 'quote':
      return `<blockquote class="s-quote">${esc(slide.title)}${slide.subtitle === '' ? '' : `<footer>${esc(slide.subtitle)}</footer>`}</blockquote>`
    case 'end':
      return `<h1>${esc(slide.title || '谢谢')}</h1>${lead}`
    case 'two-column':
      return `${slide.title === '' ? '' : `<h2 class="s-h">${esc(slide.title)}</h2>`}${slide.subtitle === '' ? '' : `<p class="s-sub">${esc(slide.subtitle)}</p>`}<div class="s-cols"><div>${blocks(slide.blocks, (SLIDE_INNER - 48) / 2)}</div><div>${blocks(slide.right, (SLIDE_INNER - 48) / 2)}</div></div>`
    case 'content':
      return `${slide.title === '' ? '' : `<h2 class="s-h">${esc(slide.title)}</h2>`}${slide.subtitle === '' ? '' : `<p class="s-sub">${esc(slide.subtitle)}</p>`}<div class="s-body">${blocks(slide.blocks, SLIDE_INNER)}</div>`
  }
}

function slides(input: LayoutInput): string {
  const total = input.doc.slides.length
  const items = input.doc.slides.map((slide, index) => {
    const foot = slide.layout === 'title' ? '' : `<div class="s-foot"><span>${esc(input.title)}</span><span>${index + 1} / ${total}</span></div>`
    const notes = slide.notes === '' ? '' : `<aside class="notes">${esc(slide.notes)}</aside>`
    return `<section class="slide l-${slide.layout}${index === 0 ? ' on' : ''}" data-index="${index}" aria-label="第 ${index + 1} 页">${slideBody(slide, index, input)}${foot}${notes}</section>`
  })
  const nav = input.mode === 'export' ? '' : `<nav class="deck-nav"><button type="button" data-deck="prev" aria-label="上一页">上一页</button><span class="deck-count">1 / ${total}</span><button type="button" data-deck="next" aria-label="下一页">下一页</button><button type="button" data-deck="notes">备注</button></nav><div class="notes-panel" aria-live="polite"></div>`
  return `<main class="deck" data-total="${total}"><div class="deck-stage"><div class="slides">${items.join('')}</div></div>${nav}</main>`
}

// ---------- 海报 ----------

function poster(input: LayoutInput): string {
  const spec = input.doc.poster ?? { size: 'portrait', eyebrow: '', headline: input.title, subheadline: '', footer: '', background: 'accent' }
  const { width, height } = POSTER_DIMENSIONS[spec.size]
  const [light, dark] = accentPair(input.doc.accent)
  const unit = Math.min(width, height)
  const body = input.doc.blocks.length === 0 ? '' : `<div class="p-body">${renderBlocks(input.doc.blocks, input.context(width - unit * 0.16, false))}</div>`
  const style = `width:${width}px;height:${height}px;--pu:${unit}px;--poster-accent:${light};--poster-accent-dark:${dark}`
  const inner = `<div class="poster-inner">${spec.eyebrow === '' ? '' : `<div class="p-eyebrow">${esc(spec.eyebrow)}</div>`}<h1 class="p-headline">${esc(spec.headline || input.title)}</h1>${spec.subheadline === '' ? '' : `<p class="p-sub">${esc(spec.subheadline)}</p>`}${body || '<div class="p-body"></div>'}${spec.footer === '' ? '' : `<footer class="p-footer">${esc(spec.footer)}</footer>`}</div>`
  return `<main class="poster-stage"><div class="poster-scale" data-w="${width}" data-h="${height}"><div class="poster bg-${spec.background}" style="${style}">${inner}</div></div></main>`
}

// ---------- 原型 ----------

const DEVICE_WIDTH = { phone: 390, tablet: 820, desktop: 1280 } as const

function screen(item: Screen, on: boolean, input: LayoutInput): string {
  const top = item.blocks.filter((block) => block.type === 'appbar')
  const bottom = item.blocks.filter((block) => block.type === 'tabbar')
  const middle = item.blocks.filter((block) => block.type !== 'appbar' && block.type !== 'tabbar')
  const ctx = input.context(DEVICE_WIDTH[input.doc.device] - 32, false)
  const bar = '<div class="sbar" aria-hidden="true"><span>9:41</span><i></i></div>'
  const edge = (list: readonly PageBlock[]): string => list.map((block) => renderBlock(block, ctx)).join('')
  return `<div class="screen${on ? ' on' : ''}" data-screen="${esc(item.id)}" aria-label="${esc(item.title)}">${bar}${edge(top)}<div class="screen-body">${renderBlocks(middle, ctx)}</div>${edge(bottom)}</div>`
}

function prototype(input: LayoutInput): string {
  const device = `device-${input.doc.device}`
  if (input.mode === 'export') {
    const sheet = input.doc.screens.map((item) => `<div class="sheet-item"><div class="frame">${screen(item, true, input)}</div><div class="sheet-title">${esc(item.title)}</div></div>`)
    return `<main class="page ${device}">${header(input)}<div class="proto-sheet">${sheet.join('')}</div></main>`
  }
  const list = input.doc.screens.map((item, index) => `<button type="button" data-screen-link="${esc(item.id)}"${index === 0 ? ' class="on"' : ''}>${esc(item.title)}</button>`)
  const screens = input.doc.screens.map((item, index) => screen(item, index === 0, input))
  return `<main class="proto ${device}"><aside class="proto-list"><h1>${esc(input.title)}</h1><div class="meta">${esc(input.meta)}</div>${list.join('')}</aside><div class="proto-stage"><div class="frame" data-device="${input.doc.device}">${screens.join('')}</div></div></main>`
}

export function layout(input: LayoutInput): string {
  switch (input.kind) {
    case 'slides':
      return slides(input)
    case 'poster':
      return poster(input)
    case 'prototype':
      return prototype(input)
    default:
      return documentPage(input, input.kind)
  }
}
