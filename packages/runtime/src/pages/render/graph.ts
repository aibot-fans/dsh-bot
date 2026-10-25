import type { GraphBlock } from 'pod-domain'
import { GROUP_LABEL, GROUP_PAD, LINE, layoutGraph, type PlacedNode, type Point } from './graph-layout.ts'
import { esc, textWidth } from './html.ts'

const MARGIN = 16

const f = (value: number): string => value.toFixed(1)

function nodeShape(box: PlacedNode): string {
  const { w, h, x, y } = box
  const x0 = x - w / 2
  const y0 = y - h / 2
  switch (box.node.shape) {
    case 'decision':
      return `<polygon class="nd nd-accent" points="${f(x)},${f(y0)} ${f(x0 + w)},${f(y)} ${f(x)},${f(y0 + h)} ${f(x0)},${f(y)}"/>`
    case 'database': {
      const e = 7
      return `<path class="nd" d="M${f(x0)},${f(y0 + e)}A${f(w / 2)},${e} 0 0 1 ${f(x0 + w)},${f(y0 + e)}V${f(y0 + h - e)}A${f(w / 2)},${e} 0 0 1 ${f(x0)},${f(y0 + h - e)}Z"/><path class="nd-rim" d="M${f(x0)},${f(y0 + e)}A${f(w / 2)},${e} 0 0 0 ${f(x0 + w)},${f(y0 + e)}"/>`
    }
    case 'start':
    case 'end':
      return `<rect class="nd nd-accent" x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" rx="${f(h / 2)}"/>`
    case 'cloud':
      return `<rect class="nd nd-cloud" x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" rx="${f(h / 2)}"/>`
    case 'person':
      return `<rect class="nd" x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" rx="8"/><circle class="nd-glyph" cx="${f(x0 + 18)}" cy="${f(y - 5)}" r="4.5"/><path class="nd-glyph" d="M${f(x0 + 10)},${f(y + 10)}Q${f(x0 + 18)},${f(y - 1)} ${f(x0 + 26)},${f(y + 10)}Z"/>`
    case 'round':
      return `<rect class="nd" x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" rx="14"/>`
    default:
      return `<rect class="nd" x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" rx="6"/>`
  }
}

function nodeText(box: PlacedNode): string {
  const offset = box.node.shape === 'person' ? 12 : 0
  const total = box.lines.length * LINE + (box.note === '' ? 0 : LINE - 2)
  const first = box.y - total / 2 + LINE / 2 + (box.node.shape === 'database' ? 5 : 0)
  const lines = box.lines.map((line, index) => `<text class="nd-label" x="${f(box.x + offset)}" y="${f(first + index * LINE)}" dy="0.32em" text-anchor="middle">${esc(line)}</text>`)
  const note = box.note === '' ? '' : `<text class="nd-note" x="${f(box.x + offset)}" y="${f(first + box.lines.length * LINE - 1)}" dy="0.32em" text-anchor="middle">${esc(box.note)}</text>`
  return `${lines.join('')}${note}`
}

interface Rect {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

function groupRect(members: readonly PlacedNode[], inner: readonly Point[]): Rect {
  return {
    x0: Math.min(...members.map((box) => box.x - box.w / 2), ...inner.map((point) => point.x)) - GROUP_PAD,
    y0: Math.min(...members.map((box) => box.y - box.h / 2), ...inner.map((point) => point.y)) - GROUP_PAD - GROUP_LABEL,
    x1: Math.max(...members.map((box) => box.x + box.w / 2), ...inner.map((point) => point.x)) + GROUP_PAD,
    y1: Math.max(...members.map((box) => box.y + box.h / 2), ...inner.map((point) => point.y)) + GROUP_PAD,
  }
}

/** 依次穿过各点的线：相邻两点之间走顺着层方向的 S 形，同一层里的进出点之间是直线。 */
function pathOf(points: readonly Point[], down: boolean): string {
  const [first, ...rest] = points
  if (first === undefined) return ''
  let previous = first
  let d = `M${f(first.x)},${f(first.y)}`
  for (const point of rest) {
    const half = down ? (point.y - previous.y) / 2 : (point.x - previous.x) / 2
    const c1 = down ? `${f(previous.x)},${f(previous.y + half)}` : `${f(previous.x + half)},${f(previous.y)}`
    const c2 = down ? `${f(point.x)},${f(point.y - half)}` : `${f(point.x - half)},${f(point.y)}`
    d += `C${c1} ${c2} ${f(point.x)},${f(point.y)}`
    previous = point
  }
  return d
}

/** 画一张流程图或图示。uid 用来区分同一页里多张图的箭头定义。 */
export function renderGraph(block: GraphBlock, uid: string): string {
  const down = block.direction === 'down'
  const layout = layoutGraph(block)
  const rects: Rect[] = layout.nodes.map((box) => ({ x0: box.x - box.w / 2, y0: box.y - box.h / 2, x1: box.x + box.w / 2, y1: box.y + box.h / 2 }))
  const groupOf = new Map(block.nodes.map((node) => [node.id, node.group]))
  const groups = block.groups.flatMap((group) => {
    const members = layout.nodes.filter((box) => box.node.group === group.id)
    if (members.length === 0) return []
    // 组里的线绕的路也算进框里
    const inner = layout.edges.flatMap((edge) => {
      const source = block.edges[edge.index]
      return source !== undefined && groupOf.get(source.from) === group.id && groupOf.get(source.to) === group.id ? edge.points : []
    })
    const rect = groupRect(members, inner)
    rects.push(rect)
    return [`<rect class="grp" x="${f(rect.x0)}" y="${f(rect.y0)}" width="${f(rect.x1 - rect.x0)}" height="${f(rect.y1 - rect.y0)}" rx="12"/><text class="grp-label" x="${f(rect.x0 + 12)}" y="${f(rect.y0 + 15)}">${esc(group.label)}</text>`]
  })
  const paths: string[] = []
  const labels: string[] = []
  for (const placed of layout.edges) {
    const edge = block.edges[placed.index]
    if (edge === undefined) continue
    for (const point of placed.points) rects.push({ x0: point.x, y0: point.y, x1: point.x, y1: point.y })
    paths.push(`<path class="edge${edge.dashed ? ' edge-dashed' : ''}" d="${pathOf(placed.points, down)}" marker-end="url(#${uid})"/>`)
    if (edge.label === '') continue
    const half = textWidth(edge.label, 11) / 2 + 4
    const { x, y } = placed.mid
    rects.push({ x0: x - half, y0: y - 9, x1: x + half, y1: y + 9 })
    labels.push(`<rect class="edge-bg" x="${f(x - half)}" y="${f(y - 9)}" width="${f(half * 2)}" height="18" rx="4"/><text class="edge-label" x="${f(x)}" y="${f(y)}" dy="0.32em" text-anchor="middle">${esc(edge.label)}</text>`)
  }
  const nodes = layout.nodes.map((box) => `<g class="node">${nodeShape(box)}${nodeText(box)}</g>`)
  const extent = (pick: (rect: Rect) => number, min: boolean): number => {
    const values = rects.map(pick)
    return values.length === 0 ? 0 : min ? Math.min(...values) : Math.max(...values)
  }
  const left = extent((rect) => rect.x0, true) - MARGIN
  const top = extent((rect) => rect.y0, true) - MARGIN
  const width = Math.ceil(extent((rect) => rect.x1, false) + MARGIN - left)
  const height = Math.ceil(extent((rect) => rect.y1, false) + MARGIN - top)
  const marker = `<defs><marker id="${uid}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrow" d="M0,1L9,5L0,9Z"/></marker></defs>`
  // 线在框和节点之间，线上的文字最后画，不会被别的线压住。
  // 窄处最多缩到四分之三，再窄就横向滚动，免得节点上的字小到看不清；导出和打印时照常缩到放得下。
  return `<div class="graph-wrap"><svg class="graph" viewBox="${f(left)} ${f(top)} ${width} ${height}" width="${width}" height="${height}" style="min-width:${Math.round(width * 0.75)}px" role="img" aria-label="${esc(block.title || (block.type === 'flow' ? '流程图' : '图示'))}">${marker}${groups.join('')}${paths.join('')}${nodes.join('')}${labels.join('')}</svg></div>`
}
