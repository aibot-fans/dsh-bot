import type { AppBarBlock, ButtonBlock, CardBlock, InputBlock, RowsBlock, SegmentedBlock, TabBarBlock, ToggleBlock } from 'pod-domain'
import { esc } from './html.ts'
import { inline } from './markdown.ts'

/** 原型用的界面组件：写了 goto 的点了跳到那一屏（组件脚本处理）。 */

export function goto(target: string): string {
  return target === '' ? '' : ` data-goto="${esc(target)}" role="button" tabindex="0"`
}

export function renderAppBar(block: AppBarBlock): string {
  const back = block.back === '' ? '<span class="ui-side"></span>' : `<span class="ui-side ui-back"${goto(block.back)} aria-label="返回"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg></span>`
  const actions = block.actions.map((action) => `<span class="ui-action">${esc(action)}</span>`).join('')
  return `<div class="ui-appbar">${back}<div class="ui-title">${esc(block.title)}</div><span class="ui-side ui-actions">${actions}</span></div>`
}

export function renderTabBar(block: TabBarBlock): string {
  const items = block.items.map((item) => `<span class="ui-tab${item.active ? ' on' : ''}"${goto(item.goto)}><i aria-hidden="true"></i>${esc(item.label)}</span>`)
  return `<nav class="ui-tabbar">${items.join('')}</nav>`
}

export function renderButton(block: ButtonBlock): string {
  return `<span class="ui-btn ui-${block.variant}">${esc(block.label)}</span>`
}

export function renderInput(block: InputBlock): string {
  const label = block.label === '' ? '' : `<span class="ui-label">${esc(block.label)}</span>`
  const field = block.multiline
    ? `<textarea class="ui-field" rows="3" placeholder="${esc(block.placeholder)}">${esc(block.value)}</textarea>`
    : `<input class="ui-field" type="text" placeholder="${esc(block.placeholder)}" value="${esc(block.value)}">`
  return `<label class="ui-input">${label}${field}</label>`
}

export function renderToggle(block: ToggleBlock): string {
  return `<div class="ui-toggle"><div><div class="ui-toggle-label">${esc(block.label)}</div>${block.note === '' ? '' : `<div class="ui-sub">${esc(block.note)}</div>`}</div><span class="ui-switch${block.on ? ' on' : ''}" role="switch" aria-checked="${block.on}" tabindex="0"><i></i></span></div>`
}

export function renderCard(block: CardBlock): string {
  const tag = block.tag === '' ? '' : `<span class="tag">${esc(block.tag)}</span>`
  return `<div class="ui-card">${tag}${block.title === '' ? '' : `<div class="ui-card-title">${esc(block.title)}</div>`}${block.text === '' ? '' : `<div class="ui-card-text">${inline(block.text)}</div>`}${block.meta === '' ? '' : `<div class="ui-sub">${esc(block.meta)}</div>`}</div>`
}

export function renderRows(block: RowsBlock): string {
  const rows = block.items.map((item) => {
    const chevron = item.goto === '' ? '' : '<svg class="ui-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>'
    return `<div class="ui-row"${goto(item.goto)}><div class="ui-row-main"><div class="ui-row-title">${esc(item.title)}</div>${item.subtitle === '' ? '' : `<div class="ui-sub">${esc(item.subtitle)}</div>`}</div>${item.meta === '' ? '' : `<span class="ui-meta">${esc(item.meta)}</span>`}${chevron}</div>`
  })
  return `<div class="ui-rows">${rows.join('')}</div>`
}

export function renderSegmented(block: SegmentedBlock): string {
  const items = block.items.map((item, index) => `<span class="ui-seg-item${index === block.active ? ' on' : ''}" role="button" tabindex="0">${esc(item)}</span>`)
  return `<div class="ui-seg">${items.join('')}</div>`
}
