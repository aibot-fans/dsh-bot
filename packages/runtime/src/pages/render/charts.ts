import type { ChartBlock } from 'pod-domain'
import { compact, esc, full, jsonAttr, niceTicks, textWidth } from './html.ts'

/**
 * 图表画成 SVG（服务端算好坐标，脚本不跑也能看）：线 2px、柱子最粗 24px、数据端 4px 圆角、
 * 相邻柱子和堆叠段之间留 2px 底色缝、网格线是细实线；两组以上有图例，悬停看数值，下面可以展开数据表。
 */

const HEIGHT = 260
const TOP = 14
const BOTTOM = 30
const BAR_MAX = 24
const GAP = 2

interface Frame {
  readonly width: number
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

function seriesColor(index: number): string {
  return `var(--c${(index % 8) + 1})`
}

function tickLabel(value: number): string {
  return compact(value)
}

function valueText(value: number | null, unit: string): string {
  return value === null ? '—' : `${full(value)}${unit}`
}

/** 横轴标签太多时隔几个显示一个。 */
function labelStep(labels: readonly string[], room: number): number {
  const widest = Math.max(24, ...labels.map((label) => textWidth(label, 11) + 12))
  return Math.max(1, Math.ceil((labels.length * widest) / Math.max(room, 1)))
}

function yAxis(ticks: readonly number[], scale: (value: number) => number, frame: Frame): string {
  return ticks
    .map((tick) => {
      const y = scale(tick).toFixed(1)
      const line = tick === 0 ? 'base' : 'grid'
      return `<line class="${line}" x1="${frame.left}" x2="${frame.width - frame.right}" y1="${y}" y2="${y}"/><text class="tick" x="${frame.left - 8}" y="${y}" dy="0.32em" text-anchor="end">${esc(tickLabel(tick))}</text>`
    })
    .join('')
}

function xLabels(labels: readonly string[], position: (index: number) => number, frame: Frame): string {
  const step = labelStep(labels, frame.width - frame.left - frame.right)
  const last = labels.length - 1
  // 最后一个总显示；离它不到一步的那个就不显示了，免得挤在一起。
  return labels
    .map((label, index) => (index === last || (index % step === 0 && last - index >= step) ? `<text class="tick" x="${position(index).toFixed(1)}" y="${HEIGHT - frame.bottom + 18}" text-anchor="middle">${esc(label)}</text>` : ''))
    .join('')
}

function legend(chart: ChartBlock, shape: 'line' | 'rect'): string {
  if (chart.series.length < 2 && chart.chart !== 'pie') return ''
  const items = chart.series.map((series, index) => `<span class="key"><i class="sw sw-${shape}" style="--k:${seriesColor(index)}"></i>${esc(series.name || `第 ${index + 1} 组`)}</span>`)
  return `<div class="legend">${items.join('')}</div>`
}

/** 数据表（无障碍和打印用）：图表下面可以展开。 */
function dataTable(chart: ChartBlock): string {
  const head = `<tr><th></th>${chart.series.map((series, index) => `<th>${esc(series.name || `第 ${index + 1} 组`)}</th>`).join('')}</tr>`
  const rows = chart.labels.map((label, row) => `<tr><th>${esc(label)}</th>${chart.series.map((series) => `<td>${esc(valueText(series.values[row] ?? null, chart.unit))}</td>`).join('')}</tr>`)
  return `<details class="data"><summary>数据</summary><div class="scroll"><table>${head}${rows.join('')}</table></div></details>`
}

function domain(chart: ChartBlock, zero: boolean): readonly [number, number] {
  const values: number[] = []
  if (chart.stacked) {
    chart.labels.forEach((_, index) => {
      let positive = 0
      let negative = 0
      for (const series of chart.series) {
        const value = series.values[index] ?? null
        if (value === null) continue
        if (value >= 0) positive += value
        else negative += value
      }
      values.push(positive, negative)
    })
  } else {
    for (const series of chart.series) for (const value of series.values) if (value !== null) values.push(value)
  }
  if (values.length === 0) return [0, 1]
  const min = Math.min(...values)
  const max = Math.max(...values)
  return zero ? [Math.min(0, min), Math.max(0, max)] : [min, max]
}

function frameFor(width: number, ticks: readonly number[], endLabels: boolean): Frame {
  const left = Math.max(28, ...ticks.map((tick) => textWidth(tickLabel(tick), 11) + 14))
  return { width, left, right: endLabels ? 72 : 16, top: TOP, bottom: BOTTOM }
}

function linear(domainMin: number, domainMax: number, rangeMin: number, rangeMax: number): (value: number) => number {
  const span = domainMax - domainMin || 1
  return (value) => rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin)
}

function lineChart(chart: ChartBlock, width: number): string {
  const area = chart.chart === 'area'
  const [min, max] = domain(chart, area)
  const ticks = niceTicks(min, max)
  const endLabels = chart.series.length >= 2 && chart.series.length <= 4
  const frame = frameFor(width, ticks, endLabels)
  const y = linear(ticks[0] ?? 0, ticks[ticks.length - 1] ?? 1, HEIGHT - frame.bottom, frame.top)
  const count = chart.labels.length
  const x = (index: number): number => (count <= 1 ? (frame.left + width - frame.right) / 2 : frame.left + (index * (width - frame.left - frame.right)) / (count - 1))
  const stackedBase = chart.labels.map(() => 0)
  const marks = chart.series.map((series, index) => {
    const color = seriesColor(index)
    const points = chart.labels.map((_, position) => {
      const value = series.values[position] ?? null
      if (value === null) return null
      const base = area && chart.stacked ? (stackedBase[position] ?? 0) : 0
      const top = base + value
      if (area && chart.stacked) stackedBase[position] = top
      return { x: x(position), y: y(top), base: y(base) }
    })
    const segments: (typeof points)[] = [[]]
    for (const point of points) {
      if (point === null) segments.push([])
      else segments[segments.length - 1]?.push(point)
    }
    const paths = segments.filter((segment) => segment.length > 0)
    const line = paths.map((segment) => `M${segment.map((point) => `${point?.x.toFixed(1)},${point?.y.toFixed(1)}`).join('L')}`).join('')
    const fill = area
      ? paths
          .map((segment) => {
            const top = segment.map((point) => `${point?.x.toFixed(1)},${point?.y.toFixed(1)}`).join('L')
            const bottom = [...segment].reverse().map((point) => `${point?.x.toFixed(1)},${point?.base.toFixed(1)}`).join('L')
            return `<path class="wash" d="M${top}L${bottom}Z" style="fill:${color}"/>`
          })
          .join('')
      : ''
    const last = [...points].reverse().find((point) => point !== null)
    const end = last === undefined || last === null ? '' : `<circle class="dot" cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4" style="fill:${color}"/>`
    const label = endLabels && last !== undefined && last !== null ? `<text class="end" x="${(last.x + 8).toFixed(1)}" y="${last.y.toFixed(1)}" dy="0.32em">${esc(series.name)}</text>` : ''
    return `${fill}<path class="ln" d="${line}" style="stroke:${color}"/>${end}${label}`
  })
  const data = { x: chart.labels.map((_, index) => Number(x(index).toFixed(1))), labels: chart.labels, series: chart.series.map((series) => ({ name: series.name, values: series.values })), unit: chart.unit, top: frame.top, bottom: HEIGHT - frame.bottom }
  return `<svg class="chart xy" viewBox="0 0 ${width} ${HEIGHT}" role="img" aria-label="${esc(chart.title || '折线图')}" tabindex="0" data-xy="${jsonAttr(data)}">${yAxis(ticks, y, frame)}${xLabels(chart.labels, x, frame)}${marks.join('')}<line class="xhair" x1="0" x2="0" y1="${frame.top}" y2="${HEIGHT - frame.bottom}"/></svg>`
}

type BarEnd = 'top' | 'bottom' | 'left' | 'right' | null

/** 一根柱子（或堆叠的一段）：数据端那一边画 4px 圆角，基线那头是方的；end 为 null 时四角都是方的。 */
function barPath(x0: number, y0: number, x1: number, y1: number, end: BarEnd): string {
  const across = end === 'top' || end === 'bottom' ? x1 - x0 : y1 - y0
  const along = end === 'top' || end === 'bottom' ? y1 - y0 : x1 - x0
  const r = end === null ? 0 : Math.max(0, Math.min(4, across / 2, along))
  const f = (value: number): string => value.toFixed(1)
  switch (end) {
    case 'top':
      return `M${f(x0)},${f(y1)}V${f(y0 + r)}Q${f(x0)},${f(y0)} ${f(x0 + r)},${f(y0)}H${f(x1 - r)}Q${f(x1)},${f(y0)} ${f(x1)},${f(y0 + r)}V${f(y1)}Z`
    case 'bottom':
      return `M${f(x0)},${f(y0)}V${f(y1 - r)}Q${f(x0)},${f(y1)} ${f(x0 + r)},${f(y1)}H${f(x1 - r)}Q${f(x1)},${f(y1)} ${f(x1)},${f(y1 - r)}V${f(y0)}Z`
    case 'right':
      return `M${f(x0)},${f(y0)}H${f(x1 - r)}Q${f(x1)},${f(y0)} ${f(x1)},${f(y0 + r)}V${f(y1 - r)}Q${f(x1)},${f(y1)} ${f(x1 - r)},${f(y1)}H${f(x0)}Z`
    case 'left':
      return `M${f(x1)},${f(y0)}H${f(x0 + r)}Q${f(x0)},${f(y0)} ${f(x0)},${f(y0 + r)}V${f(y1 - r)}Q${f(x0)},${f(y1)} ${f(x0 + r)},${f(y1)}H${f(x1)}Z`
    default:
      return `M${f(x0)},${f(y0)}H${f(x1)}V${f(y1)}H${f(x0)}Z`
  }
}

function barChart(chart: ChartBlock, width: number): string {
  const horizontal = chart.horizontal
  const [min, max] = domain(chart, true)
  const ticks = niceTicks(min, max)
  const count = Math.max(chart.labels.length, 1)
  const groups = chart.stacked ? 1 : chart.series.length
  const labelRoom = Math.min(160, Math.max(48, ...chart.labels.map((label) => textWidth(label, 11) + 14)))
  const height = horizontal ? Math.max(120, count * Math.min(48, groups * (BAR_MAX + GAP) + 16) + TOP + BOTTOM) : HEIGHT
  const frame: Frame = horizontal ? { width, left: labelRoom, right: 48, top: TOP, bottom: BOTTOM } : frameFor(width, ticks, false)
  const bandStart = horizontal ? frame.top : frame.left
  const band = (horizontal ? height - frame.top - frame.bottom : width - frame.left - frame.right) / count
  const thickness = Math.max(3, Math.min(BAR_MAX, (band * 0.72 - GAP * (groups - 1)) / groups))
  const low = ticks[0] ?? 0
  const high = ticks[ticks.length - 1] ?? 1
  const value = horizontal ? linear(low, high, frame.left, width - frame.right) : linear(low, high, height - frame.bottom, frame.top)
  const single = chart.series.length === 1 && chart.labels.length <= 16
  const marks: string[] = []
  chart.labels.forEach((label, position) => {
    const center = bandStart + band * (position + 0.5)
    const groupSize = groups * thickness + GAP * (groups - 1)
    let positive = 0
    let negative = 0
    chart.series.forEach((series, index) => {
      const raw = series.values[position] ?? null
      if (raw === null || raw === 0) return
      const start = center - groupSize / 2 + (chart.stacked ? 0 : index * (thickness + GAP))
      const base = chart.stacked ? (raw > 0 ? positive : negative) : 0
      const top = base + raw
      if (chart.stacked && raw > 0) positive = top
      if (chart.stacked && raw < 0) negative = top
      const later = chart.series.slice(index + 1).some((other) => Math.sign(other.values[position] ?? 0) === Math.sign(raw))
      const isEnd = !chart.stacked || !later
      const from = value(base)
      const length = Math.abs(value(top) - from) - (isEnd ? 0 : GAP)
      if (length <= 0) return
      const up = raw > 0
      const path = horizontal
        ? up
          ? barPath(from, start, from + length, start + thickness, isEnd ? 'right' : null)
          : barPath(from - length, start, from, start + thickness, isEnd ? 'left' : null)
        : up
          ? barPath(start, from - length, start + thickness, from, isEnd ? 'top' : null)
          : barPath(start, from, start + thickness, from + length, isEnd ? 'bottom' : null)
      marks.push(`<path class="bar" d="${path}" style="fill:${seriesColor(index)}"/>`)
      if (!single) return
      const text = esc(compact(raw))
      marks.push(
        horizontal
          ? `<text class="val" x="${(up ? from + length + 6 : from - length - 6).toFixed(1)}" y="${(start + thickness / 2).toFixed(1)}" dy="0.32em" text-anchor="${up ? 'start' : 'end'}">${text}</text>`
          : `<text class="val" x="${(start + thickness / 2).toFixed(1)}" y="${(up ? from - length - 6 : from + length + 14).toFixed(1)}" text-anchor="middle">${text}</text>`,
      )
    })
    const tip = [label, ...chart.series.map((series, index) => `${series.name || `第 ${index + 1} 组`}：${valueText(series.values[position] ?? null, chart.unit)}`)].join('\n')
    const hit = horizontal
      ? `x="${frame.left}" y="${(center - band / 2).toFixed(1)}" width="${width - frame.left - frame.right}" height="${band.toFixed(1)}"`
      : `x="${(center - band / 2).toFixed(1)}" y="${frame.top}" width="${band.toFixed(1)}" height="${height - frame.top - frame.bottom}"`
    marks.push(`<rect class="hit" ${hit} data-tip="${esc(tip)}"/>`)
    if (horizontal) marks.push(`<text class="tick" x="${frame.left - 8}" y="${center.toFixed(1)}" dy="0.32em" text-anchor="end">${esc(label)}</text>`)
  })
  const axis = horizontal
    ? ticks
        .map((tick) => {
          const x = value(tick).toFixed(1)
          return `<line class="${tick === 0 ? 'base' : 'grid'}" x1="${x}" x2="${x}" y1="${frame.top}" y2="${height - frame.bottom}"/><text class="tick" x="${x}" y="${height - frame.bottom + 18}" text-anchor="middle">${esc(tickLabel(tick))}</text>`
        })
        .join('')
    : `${yAxis(ticks, value, frame)}${xLabels(chart.labels, (index) => bandStart + band * (index + 0.5), frame)}`
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(chart.title || '柱状图')}">${axis}${marks.join('')}</svg>`
}

function pieChart(chart: ChartBlock, width: number): string {
  const values = chart.series[0]?.values ?? []
  const raw = chart.labels.map((label, index) => ({ label, value: Math.max(0, values[index] ?? 0) })).filter((slice) => slice.value > 0)
  const sorted = [...raw].sort((left, right) => right.value - left.value)
  const slices = sorted.length > 8 ? [...sorted.slice(0, 7), { label: '其他', value: sorted.slice(7).reduce((sum, slice) => sum + slice.value, 0) }] : sorted
  const total = slices.reduce((sum, slice) => sum + slice.value, 0) || 1
  const size = Math.min(220, width * 0.45)
  const radius = size / 2
  const inner = radius * 0.6
  let angle = -Math.PI / 2
  const arcs = slices.map((slice, index) => {
    const sweep = (slice.value / total) * Math.PI * 2
    const end = angle + sweep
    const large = sweep > Math.PI ? 1 : 0
    const point = (r: number, a: number): string => `${(radius + r * Math.cos(a)).toFixed(2)},${(radius + r * Math.sin(a)).toFixed(2)}`
    const d = slices.length === 1
      ? `M${point(radius, 0)}A${radius},${radius} 0 1 1 ${point(radius, Math.PI)}A${radius},${radius} 0 1 1 ${point(radius, 0)}M${point(inner, 0)}A${inner},${inner} 0 1 0 ${point(inner, Math.PI)}A${inner},${inner} 0 1 0 ${point(inner, 0)}Z`
      : `M${point(radius, angle)}A${radius},${radius} 0 ${large} 1 ${point(radius, end)}L${point(inner, end)}A${inner},${inner} 0 ${large} 0 ${point(inner, angle)}Z`
    angle = end
    const share = `${((slice.value / total) * 100).toFixed(1)}%`
    return { d, color: seriesColor(index), tip: `${slice.label}\n${full(slice.value)}${chart.unit}（${share}）`, label: slice.label, share, value: slice.value }
  })
  // 百分比数据的合计总是 100%，圆心就不写了。
  const center = chart.unit === '%' ? '' : `<text class="pie-total" x="${radius}" y="${radius}" text-anchor="middle">${esc(compact(total))}${esc(chart.unit)}</text><text class="pie-caption" x="${radius}" y="${radius}" dy="1.5em" text-anchor="middle">合计</text>`
  const svg = `<svg class="chart pie" viewBox="0 0 ${size} ${size}" style="width:${size.toFixed(0)}px" role="img" aria-label="${esc(chart.title || '饼图')}">${arcs.map((arc) => `<path class="slice" d="${arc.d}" style="fill:${arc.color}" data-tip="${esc(arc.tip)}"/>`).join('')}${center}</svg>`
  const keys = arcs.map((arc) => `<li><i class="sw sw-rect" style="--k:${arc.color}"></i><span class="pie-name">${esc(arc.label)}</span><span class="pie-share">${esc(arc.share)}</span></li>`).join('')
  return `<div class="pie-wrap">${svg}<ul class="pie-keys">${keys}</ul></div>`
}

/** 窄版的名字、宽度，和原图宽过多少才需要它。 */
const FIT_SIZES = [
  ['s', 480, 552],
  ['m', 720, 828],
  ['l', 1000, 1150],
] as const

/**
 * 宽图放进窄处（查看器两边有侧栏、手机）会整体缩小，字也跟着变得很小。所以宽图另外按 480、720、1000 宽各画一份，
 * 样式里用容器查询按实际显示宽度挑最接近的那份；导出和宽屏还是原图。
 */
function fitted(width: number, draw: (width: number) => string): string {
  const sizes = FIT_SIZES.filter(([, , from]) => width > from)
  if (sizes.length === 0) return draw(width)
  const variants = [...sizes.map(([name, size]) => `<div class="fit fit-${name}">${draw(size)}</div>`), `<div class="fit fit-w">${draw(width)}</div>`]
  return `<div class="chart-fit">${variants.join('')}</div>`
}

/** 图表组件：标题、图例、图、说明和可展开的数据表。width 是这块大约画多宽（viewBox 宽度）。 */
export function renderChart(chart: ChartBlock, width: number): string {
  const body = chart.chart === 'pie' ? pieChart(chart, width) : fitted(width, (size) => (chart.chart === 'bar' ? barChart(chart, size) : lineChart(chart, size)))
  const head = chart.title === '' && chart.unit === '' ? '' : `<div class="chart-head">${chart.title === '' ? '' : `<h3 class="block-title">${esc(chart.title)}</h3>`}${chart.unit === '' || chart.chart === 'pie' ? '' : `<span class="unit">单位：${esc(chart.unit)}</span>`}</div>`
  const note = chart.note === '' ? '' : `<p class="note">${esc(chart.note)}</p>`
  return `${head}${chart.chart === 'pie' ? '' : legend(chart, chart.chart === 'bar' ? 'rect' : 'line')}${body}${note}${dataTable(chart)}`
}

/** 指标卡里的小趋势线：淡色线，最后一点用主色。 */
export function sparkline(values: readonly number[]): string {
  if (values.length < 2) return ''
  const width = 120
  const height = 32
  const min = Math.min(...values)
  const max = Math.max(...values)
  const x = (index: number): number => (index * width) / (values.length - 1)
  const y = linear(min, max === min ? min + 1 : max, height - 4, 4)
  const d = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join('')
  const last = values[values.length - 1] ?? 0
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/><circle cx="${x(values.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3"/></svg>`
}
