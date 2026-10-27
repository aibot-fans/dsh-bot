import { intlLocale, t, type BoardBlock, type Cell, type HeatmapBlock, type MetricsBlock, type ProgressBlock, type StepStatus, type TableBlock, type TableColumn, type TimelineBlock } from 'pod-domain'
import { sparkline } from './charts.ts'
import { compact, esc, full } from './html.ts'
import { inline } from './markdown.ts'
import { HEAT_BINS } from './theme.ts'

/** 表格、指标卡、时间线、热力图、分栏看板、进度条。状态一律“图标 + 文字”，不只靠颜色。 */

type Tone = 'ok' | 'info' | 'warn' | 'bad' | 'neutral'

const TONE_WORDS: readonly [Tone, RegExp][] = [
  ['bad', /失败|错误|严重|阻塞|取消|逾期|超期|下线|故障|fail|error|blocked|critical|cancel/i],
  ['warn', /风险|延期|延迟|警告|注意|待定|暂停|偏高|偏低|risk|warn|delay|hold|pending/i],
  ['ok', /完成|已完成|正常|通过|上线|成功|达成|已解决|done|ok|pass|success|complete|resolved|live/i],
  ['info', /进行中|处理中|开发中|测试中|评审中|计划中|in progress|doing|active|review|wip/i],
]

export function toneOf(text: string): Tone {
  for (const [tone, pattern] of TONE_WORDS) if (pattern.test(text)) return tone
  return 'neutral'
}

const ICONS: Readonly<Record<Tone, string>> = {
  ok: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  info: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5"/><path d="M8 5v3.2l2 1.3"/></svg>',
  warn: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l6 11H2z"/><path d="M8 6.5v3M8 11.6v.1"/></svg>',
  bad: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/></svg>',
  neutral: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.5"/></svg>',
}

export function statusBadge(text: string, tone: Tone = toneOf(text)): string {
  return `<span class="status st-${tone}">${ICONS[tone]}${esc(text)}</span>`
}

const STEP_LABELS: Readonly<Record<StepStatus, string>> = { done: '完成', active: '进行中', todo: '未开始', risk: '有风险' }
const STEP_TONES: Readonly<Record<StepStatus, Tone>> = { done: 'ok', active: 'info', todo: 'neutral', risk: 'warn' }

function titled(title: string): string {
  return title === '' ? '' : `<h3 class="block-title">${esc(title)}</h3>`
}

function numeric(column: TableColumn): boolean {
  return column.type === 'number' || column.type === 'money' || column.type === 'percent' || column.type === 'progress'
}

function cellHtml(cell: Cell, column: TableColumn): { readonly html: string; readonly sort: string } {
  if (cell === null || cell === '') return { html: '<span class="dim">—</span>', sort: '' }
  const number = typeof cell === 'number' ? cell : null
  switch (column.type) {
    case 'number':
      return { html: esc(number === null ? cell : full(number)), sort: String(number ?? cell) }
    case 'money':
      return { html: esc(number === null ? cell : number.toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })), sort: String(number ?? cell) }
    case 'percent':
      return { html: esc(number === null ? cell : `${full(number)}%`), sort: String(number ?? cell) }
    case 'progress': {
      const value = Math.max(0, Math.min(100, number ?? Number.parseFloat(String(cell)) ?? 0))
      return { html: `<span class="cell-meter"><i style="width:${Number.isFinite(value) ? value : 0}%"></i></span><span class="cell-num">${esc(Number.isFinite(value) ? `${full(value)}%` : String(cell))}</span>`, sort: String(value) }
    }
    case 'status':
      return { html: statusBadge(String(cell)), sort: String(cell) }
    case 'tag':
      return { html: String(cell).split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean).map((tag) => `<span class="tag">${esc(tag)}</span>`).join(''), sort: String(cell) }
    default:
      return { html: inline(String(cell)), sort: String(cell) }
  }
}

export function renderTable(block: TableBlock): string {
  const head = block.columns.map((column, index) => `<th class="${numeric(column) ? 'num' : ''}" data-col="${index}" aria-sort="none"><button type="button">${esc(column.label)}<i class="sort" aria-hidden="true"></i></button></th>`).join('')
  const rows = block.rows.map((row) => `<tr>${block.columns.map((column, index) => {
    const cell = cellHtml(row[index] ?? null, column)
    return `<td class="${numeric(column) ? 'num' : ''}" data-v="${esc(cell.sort)}">${cell.html}</td>`
  }).join('')}</tr>`)
  const note = block.note === '' ? '' : `<p class="note">${esc(block.note)}</p>`
  return `${titled(block.title)}<div class="scroll"><table class="grid sortable"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>${note}`
}

export function renderMetrics(block: MetricsBlock): string {
  const tiles = block.items.map((item) => {
    const direction = /^[-−–]/.test(item.delta) ? 'down' : item.delta === '' || /^0(\.0+)?%?$/.test(item.delta.replace(/^\+/, '')) ? 'flat' : 'up'
    const tone = item.good === 'none' || direction === 'flat' ? 'flat' : direction === item.good ? 'good' : 'bad'
    const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : ''
    const delta = item.delta === '' ? '' : `<span class="delta d-${tone}">${arrow === '' ? '' : `<i aria-hidden="true">${arrow}</i>`}${esc(item.delta)}</span>`
    return `<div class="metric"><div class="metric-label">${esc(item.label)}</div><div class="metric-value">${esc(item.value)}${item.unit === '' ? '' : `<span class="metric-unit">${esc(item.unit)}</span>`}</div>${delta}${item.trend.length > 1 ? sparkline(item.trend) : ''}${item.note === '' ? '' : `<div class="metric-note">${esc(item.note)}</div>`}</div>`
  })
  return `<div class="metrics">${tiles.join('')}</div>`
}

export function renderTimeline(block: TimelineBlock): string {
  const items = block.items.map((item) => `<li class="tl-item tl-${item.status}"><span class="tl-dot" aria-hidden="true"></span><div class="tl-date">${esc(item.date)}</div><div class="tl-body"><div class="tl-title">${esc(item.title)} ${statusBadge(t(STEP_LABELS[item.status]), STEP_TONES[item.status])}</div>${item.note === '' ? '' : `<div class="tl-note">${inline(item.note)}</div>`}</div></li>`)
  return `${titled(block.title)}<ol class="timeline">${items.join('')}</ol>`
}

export function renderHeatmap(block: HeatmapBlock): string {
  const flat = block.values.flat().filter((value): value is number => value !== null)
  const min = flat.length === 0 ? 0 : Math.min(...flat)
  const max = flat.length === 0 ? 1 : Math.max(...flat)
  const diverging = min < 0 && max > 0
  const bound = Math.max(Math.abs(min), Math.abs(max)) || 1
  const binOf = (value: number): string => {
    if (diverging) return `d${Math.max(0, Math.min(8, Math.round((value / bound) * 4) + 4))}`
    const span = max - min || 1
    return `h${Math.max(0, Math.min(HEAT_BINS - 1, Math.floor(((value - min) / span) * (HEAT_BINS - 0.001))))}`
  }
  const dense = block.columns.length > 14
  const head = `<tr><th></th>${block.columns.map((column) => `<th>${esc(column)}</th>`).join('')}</tr>`
  const rows = block.rows.map((row, index) => `<tr><th>${esc(row)}</th>${block.columns.map((column, position) => {
    const value = block.values[index]?.[position] ?? null
    if (value === null) return '<td class="hm-empty"></td>'
    const bin = binOf(value)
    const tip = `${row} · ${column}\n${full(value)}${block.unit}`
    return `<td class="hm ${bin}" style="background:var(--${bin})" data-tip="${esc(tip)}">${dense ? '' : esc(compact(value))}</td>`
  }).join('')}</tr>`)
  const scale = diverging ? [0, 2, 4, 6, 8].map((bin) => `<i style="background:var(--d${bin})"></i>`).join('') : [0, 2, 4, 6, 8].map((bin) => `<i style="background:var(--h${bin})"></i>`).join('')
  const legend = `<div class="hm-legend"><span>${esc(compact(diverging ? -bound : min))}${esc(block.unit)}</span><span class="hm-scale">${scale}</span><span>${esc(compact(diverging ? bound : max))}${esc(block.unit)}</span></div>`
  const note = block.note === '' ? '' : `<p class="note">${esc(block.note)}</p>`
  return `${titled(block.title)}<div class="scroll"><table class="heatmap${dense ? ' dense' : ''}">${head}${rows.join('')}</table></div>${legend}${note}`
}

export function renderBoard(block: BoardBlock): string {
  const columns = block.columns.map((column) => {
    const cards = column.cards.map((card) => `<div class="kcard"><div class="kcard-title">${esc(card.title)}</div>${card.note === '' ? '' : `<div class="kcard-note">${inline(card.note)}</div>`}<div class="kcard-meta">${card.tag === '' ? '' : `<span class="tag">${esc(card.tag)}</span>`}${card.status === '' ? '' : statusBadge(card.status)}${card.owner === '' ? '' : `<span class="owner">${esc(card.owner)}</span>`}</div></div>`)
    return `<div class="kcol"><div class="kcol-head"><span>${esc(column.title)}</span><span class="count">${column.cards.length}</span></div>${cards.join('')}</div>`
  })
  return `${titled(block.title)}<div class="board">${columns.join('')}</div>`
}

export function renderProgress(block: ProgressBlock): string {
  const items = block.items.map((item) => {
    const ratio = item.max <= 0 ? 0 : Math.max(0, Math.min(1, item.value / item.max))
    const label = item.max === 100 ? `${full(item.value)}%` : `${full(item.value)} / ${full(item.max)}`
    return `<div class="meter-row"><div class="meter-head"><span>${esc(item.label)}</span><span class="meter-value">${esc(label)}</span></div><div class="meter"><i style="width:${(ratio * 100).toFixed(1)}%"></i></div>${item.note === '' ? '' : `<div class="meter-note">${esc(item.note)}</div>`}</div>`
  })
  return `${titled(block.title)}<div class="meters">${items.join('')}</div>`
}
