import {
  DEVICES,
  PAGE_ACCENTS,
  POSTER_BACKGROUNDS,
  POSTER_SIZES,
  SLIDE_LAYOUTS,
  type PageBlock,
  type PageDoc,
  type Poster,
  type Screen,
  type Slide,
} from './page-blocks.ts'
import { t } from './i18n.ts'
import { parseBlock } from './page-parse-blocks.ts'
import { capped, choice, field, record, report, type Raw, type ReadContext } from './page-read.ts'
import type { PageKind } from './pages.ts'

export type DocResult = { readonly ok: true; readonly doc: PageDoc } | { readonly ok: false; readonly errors: readonly string[] }

const MAX_BLOCKS = 200
const MAX_SLIDES = 60
const MAX_SCREENS = 30

function blocks(value: unknown, path: string, ctx: ReadContext): readonly PageBlock[] {
  return capped(ctx, path, value, MAX_BLOCKS, '组件')
    .map((item, index) => parseBlock(item, `${path}[${index}]`, ctx))
    .filter((block): block is PageBlock => block !== undefined)
}

function slides(value: unknown, ctx: ReadContext): readonly Slide[] {
  const list = capped(ctx, 'slides', value, MAX_SLIDES, '页')
  return list.map((item, index) => {
    const raw: Raw = record(item) ?? {}
    const path = `slides[${index}]`
    const title = field(raw, ['title', 'heading'], 200)
    const body = blocks(raw.blocks ?? raw.left, `${path}.blocks`, ctx)
    const right = blocks(raw.right, `${path}.right`, ctx)
    if (title === '' && body.length === 0) report(ctx, path, '这一页没有 title 也没有 blocks')
    const fallback = index === 0 ? 'title' : right.length > 0 ? 'two-column' : 'content'
    return { layout: choice(raw.layout, SLIDE_LAYOUTS, fallback), title, subtitle: field(raw, ['subtitle', 'by'], 300), blocks: body, right, notes: field(raw, ['notes', 'note'], 5000) }
  })
}

function screens(value: unknown, ctx: ReadContext): readonly Screen[] {
  const seen = new Set<string>()
  return capped(ctx, 'screens', value, MAX_SCREENS, '屏').map((item, index) => {
    const raw: Raw = record(item) ?? {}
    const path = `screens[${index}]`
    const title = field(raw, ['title', 'name'], 80)
    const id = field(raw, ['id'], 80) || `s${index + 1}`
    if (seen.has(id)) report(ctx, path, `屏的 id「${id}」重复了`)
    seen.add(id)
    const body = blocks(raw.blocks ?? raw.elements, `${path}.blocks`, ctx)
    if (body.length === 0) report(ctx, path, '这一屏没有 blocks（界面组件）')
    return { id, title: title || id, blocks: body }
  })
}

function poster(value: unknown, ctx: ReadContext): Poster | null {
  const raw = record(value)
  if (raw === undefined) {
    report(ctx, 'poster', '海报要有 poster：{ size, eyebrow, headline, subheadline, footer, background }')
    return null
  }
  const headline = field(raw, ['headline', 'title'], 120)
  if (headline === '') report(ctx, 'poster', '没有 headline（大标题）')
  return {
    size: choice(raw.size, POSTER_SIZES, 'portrait'),
    eyebrow: field(raw, ['eyebrow', 'kicker', 'tag'], 60),
    headline,
    subheadline: field(raw, ['subheadline', 'subtitle'], 300),
    footer: field(raw, ['footer'], 200),
    background: choice(raw.background, POSTER_BACKGROUNDS, 'accent'),
  }
}

/** 原型里写的 goto、back 和底栏的跳转都要指向已有的屏。 */
function checkLinks(list: readonly Screen[], ctx: ReadContext): void {
  const ids = new Set(list.map((screen) => screen.id))
  const valid = [...ids].join('、')
  list.forEach((screen, index) => {
    screen.blocks.forEach((block, position) => {
      const targets = [block.goto, block.type === 'appbar' ? block.back : '', ...(block.type === 'tabbar' ? block.items.map((item) => item.goto) : []), ...(block.type === 'rows' ? block.items.map((item) => item.goto) : [])]
      for (const target of targets) {
        if (target !== '' && !ids.has(target)) report(ctx, `screens[${index}].blocks[${position}]（${block.type}）`, `跳转目标「${target}」不是已有的屏，可用的有：${valid}`)
      }
    })
  })
}

/** 按种类校验 bot 写的页面内容；不认识的字段忽略，错了按位置说清楚。 */
export function parsePageDoc(kind: PageKind, input: Raw): DocResult {
  const ctx: ReadContext = { errors: [] }
  const body = blocks(input.blocks, 'blocks', ctx)
  const slideList = kind === 'slides' ? slides(input.slides, ctx) : []
  const screenList = kind === 'prototype' ? screens(input.screens, ctx) : []
  const posterSpec = kind === 'poster' ? poster(input.poster, ctx) : null
  if ((kind === 'report' || kind === 'dashboard' || kind === 'tracker' || kind === 'diagram') && body.length === 0 && ctx.errors.length === 0) {
    report(ctx, 'blocks', `${kind === 'diagram' ? '图示要有 diagram 或 flow 组件' : '没有组件'}；先用 page_guide 看写法`)
  }
  if (kind === 'slides' && slideList.length === 0 && ctx.errors.length === 0) report(ctx, 'slides', '幻灯片要有 slides（每页一项）')
  if (kind === 'prototype' && screenList.length === 0 && ctx.errors.length === 0) report(ctx, 'screens', '原型要有 screens（每屏一项）')
  if (kind === 'prototype') checkLinks(screenList, ctx)
  if (ctx.errors.length > 0) return { ok: false, errors: ctx.errors }
  return {
    ok: true,
    doc: {
      subtitle: field(input, ['subtitle', 'summary'], 300),
      accent: choice(input.accent ?? input.color, PAGE_ACCENTS, 'blue'),
      blocks: body,
      slides: slideList,
      screens: screenList,
      device: choice(input.device, DEVICES, 'phone'),
      poster: posterSpec,
    },
  }
}

/** 页面里所有的组件（正文、每页幻灯片、每一屏）。 */
export function allBlocks(doc: PageDoc): readonly PageBlock[] {
  return [...doc.blocks, ...doc.slides.flatMap((slide) => [...slide.blocks, ...slide.right]), ...doc.screens.flatMap((screen) => screen.blocks)]
}

/** 把每个组件换成新的（不改原对象）。 */
export function mapBlocks(doc: PageDoc, change: (block: PageBlock) => PageBlock): PageDoc {
  return {
    ...doc,
    blocks: doc.blocks.map(change),
    slides: doc.slides.map((slide) => ({ ...slide, blocks: slide.blocks.map(change), right: slide.right.map(change) })),
    screens: doc.screens.map((screen) => ({ ...screen, blocks: screen.blocks.map(change) })),
  }
}

/** 一句话说页面有多少内容。 */
export function describeDoc(kind: PageKind, doc: PageDoc): string {
  if (kind === 'slides') return t('{count} 页', { count: doc.slides.length })
  if (kind === 'prototype') return t('{count} 屏', { count: doc.screens.length })
  return t('{count} 个组件', { count: doc.blocks.length })
}

function isDefault(key: string, value: unknown): boolean {
  if (value === '' || value === false || value === null) return true
  if (Array.isArray(value) && value.length === 0) return true
  return (key === 'width' && value === 'full') || (key === 'height' && value === 0)
}

function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value as Raw)
      .filter(([key, item]) => !isDefault(key, item))
      .map(([key, item]) => [key, compact(item)]),
  )
}

/** 给 bot 看的页面内容：去掉默认值，改完可以整份交回 save_page。 */
export function compactDoc(kind: PageKind, doc: PageDoc): Raw {
  const shown: Raw = {
    subtitle: doc.subtitle,
    accent: doc.accent === 'blue' ? '' : doc.accent,
    blocks: doc.blocks,
    ...(kind === 'slides' ? { slides: doc.slides } : {}),
    ...(kind === 'prototype' ? { screens: doc.screens, device: doc.device } : {}),
    ...(kind === 'poster' ? { poster: doc.poster } : {}),
  }
  return compact(shown) as Raw
}
