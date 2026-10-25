import {
  BLOCK_TYPES,
  BLOCK_WIDTHS,
  CHART_TYPES,
  COLUMN_TYPES,
  NODE_SHAPES,
  STEP_STATUSES,
  TONES,
  type BlockType,
  type Cell,
  type GraphGroup,
  type GraphNode,
  type PageBlock,
  type TableColumn,
} from './page-blocks.ts'
import { capped, choice, field, flagOf, listOf, numberOf, numbers, record, report, strings, textOf, type Raw, type ReadContext } from './page-read.ts'

/** 组件里各类列表的上限：够用，又不至于把页面撑爆。 */
const LIMITS = { items: 300, rows: 1000, labels: 2000, series: 8, nodes: 120, edges: 300, heat: 100, columns: 40 } as const

const TITLE = 200
const LONG = 20_000

/** bot 常写的别名。 */
const TYPE_ALIASES: Readonly<Record<string, BlockType>> = {
  markdown: 'text',
  paragraph: 'text',
  kpi: 'metrics',
  kpis: 'metrics',
  metric: 'metrics',
  stats: 'metrics',
  flowchart: 'flow',
  graph: 'diagram',
  kanban: 'board',
  checklist: 'list',
  hr: 'divider',
  note: 'callout',
  alert: 'callout',
  img: 'image',
}

function typeOf(raw: Raw): BlockType | undefined {
  const value = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : ''
  if ((BLOCK_TYPES as readonly string[]).includes(value)) return value as BlockType
  return TYPE_ALIASES[value]
}

function need(ctx: ReadContext, path: string, ok: boolean, message: string): void {
  if (!ok) report(ctx, path, message)
}

function chart(raw: Raw, path: string, ctx: ReadContext) {
  const kind = choice(raw.chart ?? raw.kind ?? raw.style, CHART_TYPES, 'bar')
  const single = Array.isArray(raw.values) ? [{ name: field(raw, ['name', 'title'], TITLE), values: raw.values }] : []
  const rawSeries = capped(ctx, `${path}.series`, Array.isArray(raw.series) ? raw.series : single, LIMITS.series, '数据组')
  const labels = strings(capped(ctx, `${path}.labels`, raw.labels ?? raw.categories ?? raw.x, LIMITS.labels, '横轴标签'))
  const series = rawSeries
    .map((item, index) => {
      const entry = record(item)
      if (entry === undefined) {
        report(ctx, `${path}.series[${index}]`, '要写成 { name, values }')
        return undefined
      }
      const values = numbers(entry.values ?? entry.data)
      need(ctx, `${path}.series[${index}]`, values.length > 0, '没有 values（一组数字）')
      if (labels.length > 0 && values.length > labels.length) report(ctx, `${path}.series[${index}]`, `values 有 ${values.length} 个，比 labels（${labels.length} 个）多`)
      const padded = labels.length > values.length ? [...values, ...Array.from({ length: labels.length - values.length }, () => null)] : values
      return { name: field(entry, ['name', 'label', 'title'], TITLE), values: padded }
    })
    .filter((item) => item !== undefined)
  need(ctx, path, rawSeries.length > 0, '没有 series（数据组）；单组数据也可以直接写 values')
  need(ctx, path, labels.length > 0, '没有 labels（横轴标签，饼图是各部分的名字）')
  return {
    type: 'chart' as const,
    chart: kind,
    title: field(raw, ['title'], TITLE),
    labels,
    series,
    unit: field(raw, ['unit'], 20),
    stacked: flagOf(raw.stacked),
    horizontal: flagOf(raw.horizontal),
    note: field(raw, ['note', 'caption'], LONG),
  }
}

function table(raw: Raw, path: string, ctx: ReadContext) {
  const columns: readonly TableColumn[] = capped(ctx, `${path}.columns`, raw.columns ?? raw.headers, LIMITS.columns, '列').map((item) => {
    const entry = record(item)
    if (entry === undefined) return { label: textOf(item, TITLE), type: 'text' as const }
    return { label: field(entry, ['label', 'title', 'name', 'key'], TITLE), type: choice(entry.type, COLUMN_TYPES, 'text') }
  })
  need(ctx, path, columns.length > 0, '没有 columns（列名，或 { label, type }）')
  const rows = capped(ctx, `${path}.rows`, raw.rows ?? raw.data, LIMITS.rows, '行').map((item, index) => {
    const entry = record(item)
    const cells: readonly unknown[] = Array.isArray(item) ? item : entry === undefined ? [] : columns.map((column) => entry[column.label])
    if (!Array.isArray(item) && entry === undefined) report(ctx, `${path}.rows[${index}]`, '每行写成数组（按列的顺序），或者以列名为键的对象')
    return columns.map((_, column): Cell => cellOf(cells[column]))
  })
  return { type: 'table' as const, title: field(raw, ['title'], TITLE), columns, rows, note: field(raw, ['note', 'caption'], LONG) }
}

function cellOf(value: unknown): Cell {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  return textOf(value, 1000)
}

function graph(raw: Raw, path: string, ctx: ReadContext, type: 'flow' | 'diagram') {
  const nodes: GraphNode[] = []
  const seen = new Set<string>()
  capped(ctx, `${path}.nodes`, raw.nodes, LIMITS.nodes, '节点').forEach((item, index) => {
    const entry = record(item) ?? { label: item }
    const label = field(entry, ['label', 'title', 'name', 'text'], TITLE)
    const id = field(entry, ['id'], 80) || label
    if (id === '') return report(ctx, `${path}.nodes[${index}]`, '节点要有 id 或 label')
    if (seen.has(id)) return report(ctx, `${path}.nodes[${index}]`, `节点 id「${id}」重复了`)
    seen.add(id)
    nodes.push({ id, label: label || id, shape: choice(entry.shape ?? entry.kind, NODE_SHAPES, type === 'flow' ? 'round' : 'box'), group: field(entry, ['group'], 80), note: field(entry, ['note'], TITLE) })
  })
  need(ctx, path, nodes.length > 0, '没有 nodes（节点）')
  const edges = capped(ctx, `${path}.edges`, raw.edges ?? raw.links, LIMITS.edges, '连线')
    .map((item, index) => {
      const arrow = typeof item === 'string' ? item.split(/\s*-+>\s*/) : undefined
      const entry = record(item) ?? (arrow !== undefined && arrow.length === 2 ? { from: arrow[0], to: arrow[1] } : {})
      const from = field(entry, ['from', 'source'], 80)
      const to = field(entry, ['to', 'target'], 80)
      if (!seen.has(from) || !seen.has(to)) {
        report(ctx, `${path}.edges[${index}]`, `连线两头要是已有节点的 id（from「${from}」→ to「${to}」）`)
        return undefined
      }
      return { from, to, label: field(entry, ['label', 'text'], 80), dashed: flagOf(entry.dashed) }
    })
    .filter((edge) => edge !== undefined)
  const declared: readonly GraphGroup[] = listOf(raw.groups)
    .map((item) => record(item) ?? { label: item })
    .map((entry) => ({ id: field(entry, ['id'], 80) || field(entry, ['label', 'title'], TITLE), label: field(entry, ['label', 'title'], TITLE) || field(entry, ['id'], 80) }))
    .filter((group) => group.id !== '')
  const implied = [...new Set(nodes.map((node) => node.group).filter((group) => group !== '' && !declared.some((item) => item.id === group)))]
  const groups = [...declared, ...implied.map((id) => ({ id, label: id }))]
  return {
    type,
    title: field(raw, ['title'], TITLE),
    direction: choice(raw.direction, ['right', 'down'] as const, type === 'flow' ? 'down' : 'right'),
    nodes,
    edges,
    groups,
  }
}

function heatmap(raw: Raw, path: string, ctx: ReadContext) {
  const rows = strings(capped(ctx, `${path}.rows`, raw.rows, LIMITS.heat, '行'))
  const columns = strings(capped(ctx, `${path}.columns`, raw.columns, LIMITS.heat, '列'))
  const matrix = listOf(raw.values ?? raw.data).slice(0, rows.length)
  need(ctx, path, rows.length > 0 && columns.length > 0, '要有 rows（行名）和 columns（列名）')
  need(ctx, path, matrix.length === rows.length, `values 要有 ${rows.length} 行（和 rows 一样多），现在有 ${matrix.length} 行`)
  const values = rows.map((_, index) => {
    const line = numbers(matrix[index])
    return columns.map((__, column) => line[column] ?? null)
  })
  return { type: 'heatmap' as const, title: field(raw, ['title'], TITLE), rows, columns, values, unit: field(raw, ['unit'], 20), note: field(raw, ['note'], LONG) }
}

function items(raw: Raw, path: string, ctx: ReadContext, key = 'items'): readonly Raw[] {
  return capped(ctx, `${path}.${key}`, raw[key], LIMITS.items, '项').map((item) => record(item) ?? { title: item, label: item, text: item })
}

/** 读一个组件；读不了返回 undefined，原因记进 ctx。 */
export function parseBlock(value: unknown, path: string, ctx: ReadContext): PageBlock | undefined {
  const raw = record(value)
  if (raw === undefined) {
    report(ctx, path, '组件要写成带 type 的对象')
    return undefined
  }
  const type = typeOf(raw)
  if (type === undefined) {
    report(ctx, path, `不认识的组件 type「${textOf(raw.type, 40)}」，可用的有：${BLOCK_TYPES.join('、')}`)
    return undefined
  }
  const at = `${path}（${type}）`
  const base = { width: choice(raw.width, BLOCK_WIDTHS, 'full'), goto: field(raw, ['goto', 'link'], 80) }
  const body = blockBody(type, raw, at, ctx)
  return body === undefined ? undefined : ({ ...base, ...body } as PageBlock)
}

function blockBody(type: BlockType, raw: Raw, at: string, ctx: ReadContext): Readonly<Record<string, unknown>> | undefined {
  const required = (keys: readonly string[], what: string, max = LONG): string => {
    const value = field(raw, keys, max)
    need(ctx, at, value !== '', `没有 ${keys[0]}（${what}）`)
    return value
  }
  switch (type) {
    case 'heading':
      return { type, text: required(['text', 'title'], '标题文字', TITLE), level: Math.min(3, Math.max(1, numberOf(raw.level) ?? 2)) as 1 | 2 | 3 }
    case 'text':
      return { type, text: required(['text', 'content', 'markdown', 'body'], '正文') }
    case 'metrics': {
      const list = items(raw, at, ctx).map((entry, index) => {
        const label = field(entry, ['label', 'title', 'name'], TITLE)
        const value = field(entry, ['value'], 60)
        need(ctx, `${at}.items[${index}]`, label !== '' && value !== '', '指标要有 label 和 value')
        const good = choice(entry.good, ['up', 'down', 'none'] as const, 'up')
        return { label, value, unit: field(entry, ['unit'], 20), delta: field(entry, ['delta', 'change'], 30), good, trend: numbers(entry.trend).filter((n) => n !== null), note: field(entry, ['note'], TITLE) }
      })
      need(ctx, at, list.length > 0, '没有 items（指标）')
      return { type, items: list }
    }
    case 'chart':
      return chart(raw, at, ctx)
    case 'table':
      return table(raw, at, ctx)
    case 'flow':
    case 'diagram':
      return graph(raw, at, ctx, type)
    case 'timeline': {
      const list = items(raw, at, ctx).map((entry, index) => {
        const title = field(entry, ['title', 'label', 'text'], TITLE)
        need(ctx, `${at}.items[${index}]`, title !== '', '没有 title')
        return { date: field(entry, ['date', 'time', 'when'], 40), title, note: field(entry, ['note', 'text'], LONG), status: choice(entry.status, STEP_STATUSES, 'todo') }
      })
      need(ctx, at, list.length > 0, '没有 items（时间点）')
      return { type, title: field(raw, ['title'], TITLE), items: list }
    }
    case 'heatmap':
      return heatmap(raw, at, ctx)
    case 'board': {
      const columns = items(raw, at, ctx, 'columns').map((column, index) => ({
        title: field(column, ['title', 'label', 'name'], TITLE) || `第 ${index + 1} 栏`,
        cards: items(column, `${at}.columns[${index}]`, ctx, 'cards').map((card) => ({
          title: field(card, ['title', 'text', 'label'], TITLE),
          note: field(card, ['note', 'text'], LONG),
          tag: field(card, ['tag', 'label'], 30),
          owner: field(card, ['owner', 'assignee'], 40),
          status: field(card, ['status'], 30),
        })),
      }))
      need(ctx, at, columns.length > 0, '没有 columns（栏）')
      return { type, title: field(raw, ['title'], TITLE), columns }
    }
    case 'progress': {
      const list = items(raw, at, ctx).map((entry, index) => {
        const value = numberOf(entry.value)
        need(ctx, `${at}.items[${index}]`, value !== null, 'value 要是数字')
        return { label: field(entry, ['label', 'title'], TITLE), value: value ?? 0, max: numberOf(entry.max) ?? 100, note: field(entry, ['note'], TITLE) }
      })
      need(ctx, at, list.length > 0, '没有 items')
      return { type, title: field(raw, ['title'], TITLE), items: list }
    }
    case 'callout':
      return { type, tone: choice(raw.tone ?? raw.level, TONES, 'info'), title: field(raw, ['title'], TITLE), text: required(['text', 'content', 'body'], '提示文字') }
    case 'list': {
      const style = choice(raw.style, ['bullet', 'number', 'check'] as const, raw.type === 'checklist' ? 'check' : 'bullet')
      const list = listOf(raw.items).map((item) => {
        const entry = record(item)
        return entry === undefined ? { text: textOf(item, LONG), done: false } : { text: field(entry, ['text', 'title', 'label'], LONG), done: flagOf(entry.done ?? entry.checked) }
      })
      need(ctx, at, list.length > 0, '没有 items')
      return { type, style, items: list.slice(0, LIMITS.items) }
    }
    case 'quote':
      return { type, text: required(['text', 'quote'], '引言'), by: field(raw, ['by', 'author', 'source'], TITLE) }
    case 'code':
      return { type, code: required(['code', 'text'], '代码', 50_000), language: field(raw, ['language', 'lang'], 30) }
    case 'image':
      return { type, src: field(raw, ['src', 'path', 'file', 'asset'], 500), alt: field(raw, ['alt', 'label', 'title'], TITLE), caption: field(raw, ['caption'], TITLE), height: Math.max(0, Math.min(2000, numberOf(raw.height) ?? 0)) }
    case 'divider':
      return { type }
    case 'html':
      return { type, html: required(['html', 'content'], 'HTML 片段', 50_000) }
    case 'appbar':
      return { type, title: field(raw, ['title', 'text'], TITLE), back: field(raw, ['back'], 80), actions: strings(raw.actions, 20).slice(0, 4) }
    case 'tabbar': {
      const list = items(raw, at, ctx).map((entry) => ({ label: field(entry, ['label', 'title', 'text'], 20), goto: field(entry, ['goto', 'link'], 80), active: flagOf(entry.active) }))
      need(ctx, at, list.length > 0, '没有 items（底栏按钮）')
      return { type, items: list.slice(0, 6) }
    }
    case 'button':
      return { type, label: required(['label', 'text', 'title'], '按钮文字', 60), variant: choice(raw.variant ?? raw.style, ['primary', 'secondary', 'ghost', 'danger'] as const, 'primary') }
    case 'input':
      return { type, label: field(raw, ['label', 'title'], 60), placeholder: field(raw, ['placeholder', 'hint'], 120), value: field(raw, ['value', 'text'], LONG), multiline: flagOf(raw.multiline) }
    case 'toggle':
      return { type, label: required(['label', 'title', 'text'], '开关名字', 60), on: flagOf(raw.on ?? raw.checked ?? raw.value), note: field(raw, ['note'], TITLE) }
    case 'card':
      return { type, title: field(raw, ['title'], TITLE), text: field(raw, ['text', 'body', 'note'], LONG), meta: field(raw, ['meta', 'subtitle'], TITLE), tag: field(raw, ['tag'], 30) }
    case 'rows': {
      const list = items(raw, at, ctx).map((entry) => ({ title: field(entry, ['title', 'label', 'text'], TITLE), subtitle: field(entry, ['subtitle', 'note'], TITLE), meta: field(entry, ['meta', 'value'], 60), goto: field(entry, ['goto', 'link'], 80) }))
      need(ctx, at, list.length > 0, '没有 items（列表行）')
      return { type, items: list }
    }
    case 'segmented': {
      const list = strings(raw.items, 30).slice(0, 6)
      need(ctx, at, list.length > 0, '没有 items（选项）')
      return { type, items: list, active: Math.max(0, Math.min(list.length - 1, numberOf(raw.active) ?? 0)) }
    }
  }
}
