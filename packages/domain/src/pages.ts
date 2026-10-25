/** 页面：bot 用组件做出来的成品（报告、看板、跟踪表和四种设计）。存组件数据，不存 HTML；每次保存追加一版。 */

import type { PageDoc } from './page-blocks.ts'

export type PageKind = 'report' | 'dashboard' | 'tracker' | 'prototype' | 'slides' | 'poster' | 'diagram'

export const PAGE_KINDS: readonly PageKind[] = ['report', 'dashboard', 'tracker', 'prototype', 'slides', 'poster', 'diagram']

export const PAGE_KIND_LABELS: Readonly<Record<PageKind, string>> = {
  report: '报告',
  dashboard: '看板',
  tracker: '跟踪表',
  prototype: '原型',
  slides: '幻灯片',
  poster: '海报',
  diagram: '图示',
}

/** 设计类：版式由模板决定（幻灯片、海报、原型、图示）。 */
export const DESIGN_KINDS: readonly PageKind[] = ['prototype', 'slides', 'poster', 'diagram']

/** 这一版是怎么来的：bot 在对话或任务里存的、例程存的、你改名、回滚。 */
export type PageSource = 'bot' | 'routine' | 'user' | 'rollback'

export const PAGE_SOURCE_LABELS: Readonly<Record<PageSource, string>> = {
  bot: 'bot 保存',
  routine: '例程更新',
  user: '你修改',
  rollback: '回滚',
}

export interface Page {
  readonly id: string
  readonly title: string
  readonly kind: PageKind
  /** 做这个页面的 bot（新建它的那个）。 */
  readonly botId: string
  /** 所属对话；任务里做的、找不到对话的为 null。 */
  readonly roomId: string | null
  /** 新建它的会话。 */
  readonly sessionId: string | null
  readonly pinned: boolean
  /** 当前版本号，也是版本数（版本只追加）。 */
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly deletedAt: number | null
}

export interface PageVersion {
  readonly pageId: string
  readonly version: number
  readonly title: string
  readonly kind: PageKind
  readonly doc: PageDoc
  /** 这一版改了什么。 */
  readonly note: string
  /** 谁改的：bot id，或者 owner。 */
  readonly author: string
  readonly source: PageSource
  readonly createdAt: number
}

/** 版本列表用：不带页面内容。 */
export type PageVersionInfo = Omit<PageVersion, 'doc'>

export const PAGE_TITLE_MAX = 80
export const PAGE_NOTE_MAX = 200
/** 页面内容（组件数据的 JSON，不含图片）最大字节数。 */
export const PAGE_DOC_MAX_BYTES = 1_500_000
/** 单张图片最大字节数。 */
export const PAGE_IMAGE_MAX_BYTES = 2 * 1024 * 1024

export function isPageKind(value: unknown): value is PageKind {
  return typeof value === 'string' && (PAGE_KINDS as readonly string[]).includes(value)
}

/** 种类也认中文名，bot 写“看板”也行。 */
export function readPageKind(value: unknown): PageKind | undefined {
  if (isPageKind(value)) return value
  if (typeof value !== 'string') return undefined
  const found = PAGE_KINDS.find((kind) => PAGE_KIND_LABELS[kind] === value.trim())
  return found
}
