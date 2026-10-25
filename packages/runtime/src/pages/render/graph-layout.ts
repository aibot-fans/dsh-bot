import type { GraphBlock, GraphNode } from 'pod-domain'
import { textWidth, wrap } from './html.ts'

/**
 * 流程图和图示的自动排版。bot 只给节点和连线，不写坐标：
 * 1. 分层：有环的先把回头的线反过来算；同一组当成一个整体，前后相连的组各占一段层，组里再按组内连线分层。
 * 2. 跨好几层的线在中间每层放一个中转点，排序和摆放时当成很窄的节点，画线时从这些点穿过去，不会从别的节点底下穿。
 * 3. 层内排序：按相邻点的平均位置排，同组的挨在一起；再把点往上下游的位置靠，保持顺序和间距。
 * 4. 层有重叠的组沿层内方向错开，不在组里的点挪出组框，组框不会互相压住。
 * 5. 同一条边上进出的线按另一头的位置分开接，不挤在一个点上。
 */

export const FONT = 13
export const NOTE_FONT = 11
export const LINE = 18
export const GROUP_PAD = 14
export const GROUP_LABEL = 22
const LAYER_GAP = 64
const NODE_GAP = 28
const VIA = 8
const BAND_GAP = 18
const ARROW_GAP = 3

interface Box {
  readonly id: string
  /** 中转点没有节点。 */
  readonly node: GraphNode | undefined
  readonly group: string
  readonly lines: readonly string[]
  readonly note: string
  readonly w: number
  readonly h: number
  layer: number
  order: number
  /** 层内方向（竖排时是 x，横排时是 y）的中心。 */
  cross: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

export interface PlacedNode {
  readonly node: GraphNode
  readonly lines: readonly string[]
  readonly note: string
  readonly w: number
  readonly h: number
  /** 中心坐标。 */
  readonly x: number
  readonly y: number
}

export interface PlacedEdge {
  /** 在 block.edges 里的下标。 */
  readonly index: number
  /** 从起点到终点经过的点：两头在节点边上（终点留出箭头），中间是穿过每层的进出点。 */
  readonly points: readonly Point[]
  /** 线上文字放在哪。 */
  readonly mid: Point
}

export interface GraphLayout {
  readonly nodes: readonly PlacedNode[]
  readonly edges: readonly PlacedEdge[]
}

interface Link {
  readonly from: string
  readonly to: string
}

interface Route {
  readonly index: number
  readonly upper: Box
  readonly lower: Box
  readonly via: readonly Box[]
  /** 原来的线是从下层指回上层的。 */
  readonly reversed: boolean
}

function measure(node: GraphNode): Pick<Box, 'lines' | 'note' | 'w' | 'h'> {
  const lines = wrap(node.label, 168, FONT, 3)
  const note = node.note === '' ? '' : (wrap(node.note, 168, NOTE_FONT, 1)[0] ?? '')
  const textW = Math.max(...lines.map((line) => textWidth(line, FONT)), note === '' ? 0 : textWidth(note, NOTE_FONT))
  const textH = lines.length * LINE + (note === '' ? 0 : LINE - 2)
  const extra = node.shape === 'person' ? 26 : 0
  if (node.shape === 'decision') return { lines, note, w: Math.max(110, textW * 1.5 + 36), h: Math.max(64, textH * 1.6 + 28) }
  const h = textH + 18 + (node.shape === 'database' ? 14 : 0)
  return { lines, note, w: Math.min(232, Math.max(92, textW + 30 + extra)), h }
}

/** 深度优先找回头的线（指向还在栈里的点），把它们反过来，剩下的就没有环了。 */
function orient(ids: readonly string[], links: readonly Link[]): readonly Link[] {
  const out = new Map<string, { readonly to: string; readonly index: number }[]>()
  links.forEach((link, index) => out.set(link.from, [...(out.get(link.from) ?? []), { to: link.to, index }]))
  const state = new Map<string, 'open' | 'done'>()
  const back = new Set<number>()
  const visit = (id: string): void => {
    state.set(id, 'open')
    for (const next of out.get(id) ?? []) {
      const seen = state.get(next.to)
      if (seen === 'open') back.add(next.index)
      else if (seen === undefined) visit(next.to)
    }
    state.set(id, 'done')
  }
  for (const id of ids) if (!state.has(id)) visit(id)
  return links.map((link, index) => (back.has(index) ? { from: link.to, to: link.from } : link))
}

/** 拓扑排序（连线已经没有环），能并列的按原来的顺序。 */
function topological(ids: readonly string[], links: readonly Link[]): readonly string[] {
  const incoming = new Map(ids.map((id) => [id, 0]))
  for (const link of links) incoming.set(link.to, (incoming.get(link.to) ?? 0) + 1)
  const ready = ids.filter((id) => incoming.get(id) === 0)
  const result: string[] = []
  while (ready.length > 0) {
    const id = ready.shift() as string
    result.push(id)
    for (const link of links) {
      if (link.from !== id) continue
      const left = (incoming.get(link.to) ?? 1) - 1
      incoming.set(link.to, left)
      if (left === 0) ready.push(link.to)
    }
  }
  return result
}

function assignLayers(boxes: ReadonlyMap<string, Box>, links: readonly Link[]): void {
  const ids = [...boxes.keys()]
  const unitOf = (id: string): string => {
    const group = boxes.get(id)?.group ?? ''
    return group === '' ? `node:${id}` : `group:${group}`
  }
  const inside = orient(ids, links.filter((link) => unitOf(link.from) === unitOf(link.to)))
  for (const id of topological(ids, inside)) {
    const box = boxes.get(id)
    if (box === undefined) continue
    for (const link of inside) {
      const target = link.from === id ? boxes.get(link.to) : undefined
      if (target !== undefined) target.layer = Math.max(target.layer, box.layer + 1)
    }
  }
  const units = [...new Set(ids.map(unitOf))]
  const between = orient(units, links.filter((link) => unitOf(link.from) !== unitOf(link.to)).map((link) => ({ from: unitOf(link.from), to: unitOf(link.to) })))
  const members = new Map<string, readonly Box[]>(units.map((unit) => [unit, [...boxes.values()].filter((box) => unitOf(box.id) === unit)]))
  const end = new Map<string, number>()
  for (const unit of topological(units, between)) {
    const start = Math.max(0, ...between.filter((link) => link.to === unit).map((link) => (end.get(link.from) ?? -1) + 1))
    const list = members.get(unit) ?? []
    for (const box of list) box.layer += start
    end.set(unit, Math.max(start, ...list.map((box) => box.layer)))
  }
}

/** 把每条线拆到相邻层之间：跨层的线在中间每层加一个中转点。 */
function route(boxes: ReadonlyMap<string, Box>, links: readonly (Link & { readonly index: number })[]): readonly Route[] {
  return links.flatMap((link) => {
    const a = boxes.get(link.from)
    const b = boxes.get(link.to)
    if (a === undefined || b === undefined) return []
    const [upper, lower] = a.layer < b.layer ? [a, b] : [b, a]
    const group = upper.group === lower.group ? upper.group : ''
    const via: Box[] = []
    for (let layer = upper.layer + 1; layer < lower.layer; layer += 1) {
      via.push({ id: '', node: undefined, group, lines: [], note: '', w: VIA, h: VIA, layer, order: upper.order, cross: 0 })
    }
    return [{ index: link.index, upper, lower, via, reversed: upper !== a }]
  })
}

function gap(left: Box, right: Box): number {
  const vias = (left.node === undefined ? 1 : 0) + (right.node === undefined ? 1 : 0)
  return vias === 2 ? 12 : vias === 1 ? 20 : NODE_GAP
}

function orderLayers(layers: readonly Box[][], neighbors: (box: Box, upward: boolean) => readonly Box[], groupRank: (box: Box) => number): void {
  for (let sweep = 0; sweep < 6; sweep += 1) {
    const upward = sweep % 2 === 1
    for (const layer of upward ? [...layers].reverse() : layers) {
      const scored = layer.map((box) => {
        const near = neighbors(box, upward)
        return { box, center: near.length === 0 ? box.order : near.reduce((sum, item) => sum + item.order, 0) / near.length }
      })
      scored.sort((left, right) => groupRank(left.box) - groupRank(right.box) || left.center - right.center)
      scored.forEach((item, index) => {
        item.box.order = index
      })
      layer.sort((left, right) => left.order - right.order)
    }
  }
}

/** 层内摆放：先挨个排开，再往相邻层的平均位置靠，保持顺序和最小间距。 */
function placeCross(layers: readonly Box[][], size: (box: Box) => number, neighbors: (box: Box, upward: boolean) => readonly Box[]): void {
  for (const layer of layers) {
    let cursor = 0
    let previous: Box | undefined
    for (const box of layer) {
      cursor += previous === undefined ? 0 : gap(previous, box)
      box.cross = cursor + size(box) / 2
      cursor += size(box)
      previous = box
    }
    for (const box of layer) box.cross -= cursor / 2
  }
  for (let pass = 0; pass < 4; pass += 1) {
    const upward = pass % 2 === 1
    for (const layer of upward ? [...layers].reverse() : layers) {
      const desired = layer.map((box) => {
        const near = neighbors(box, upward)
        return near.length === 0 ? box.cross : near.reduce((sum, item) => sum + item.cross, 0) / near.length
      })
      let previous: Box | undefined
      layer.forEach((box, index) => {
        const want = desired[index] ?? box.cross
        box.cross = previous === undefined ? want : Math.max(want, previous.cross + (size(previous) + size(box)) / 2 + gap(previous, box))
        previous = box
      })
      const drift = layer.reduce((sum, box, index) => sum + ((desired[index] ?? box.cross) - box.cross), 0) / Math.max(layer.length, 1)
      for (const box of layer) box.cross += drift
    }
  }
}

interface Band {
  readonly lo: number
  readonly hi: number
  readonly from: number
  readonly to: number
}

/** 层有重叠的组按声明顺序沿层内方向错开；不在组里的点落进了组框就挪到框外。label 是组名占在层内方向起点那边的空间。 */
function separate(layers: readonly (readonly Box[])[], groups: readonly string[], size: (box: Box) => number, label: number): void {
  const all = layers.flat()
  const bands: Band[] = []
  for (const group of groups) {
    const members = all.filter((box) => box.group === group)
    if (members.length === 0) continue
    const from = Math.min(...members.map((box) => box.layer))
    const to = Math.max(...members.map((box) => box.layer))
    const lo = Math.min(...members.map((box) => box.cross - size(box) / 2)) - GROUP_PAD - label
    const hi = Math.max(...members.map((box) => box.cross + size(box) / 2)) + GROUP_PAD
    const need = Math.max(lo, ...bands.filter((band) => band.from <= to && from <= band.to).map((band) => band.hi + BAND_GAP))
    for (const box of members) box.cross += need - lo
    bands.push({ lo: need, hi: hi + need - lo, from, to })
  }
  const sorted = [...bands].sort((left, right) => left.lo - right.lo)
  for (const layer of layers) {
    let previous: Box | undefined
    for (const box of layer) {
      const half = size(box) / 2
      if (box.group === '') {
        let cross = previous === undefined ? box.cross : Math.max(box.cross, previous.cross + size(previous) / 2 + gap(previous, box) + half)
        for (const band of sorted) {
          const covers = band.from <= box.layer && box.layer <= band.to
          if (covers && cross + half > band.lo - BAND_GAP && cross - half < band.hi + BAND_GAP) cross = band.hi + BAND_GAP + half
        }
        box.cross = cross
      }
      previous = box
    }
  }
}

/** 同一条边上的几根线按另一头的位置排开，返回每根线两头相对节点中心的偏移。 */
function ports(routes: readonly Route[], size: (box: Box) => number): ReadonlyMap<string, number> {
  const sides = new Map<Box, Map<string, { readonly key: string; readonly toward: number }[]>>()
  const add = (box: Box, side: string, key: string, toward: number): void => {
    const map = sides.get(box) ?? new Map<string, { readonly key: string; readonly toward: number }[]>()
    map.set(side, [...(map.get(side) ?? []), { key, toward }])
    sides.set(box, map)
  }
  for (const item of routes) {
    add(item.upper, 'out', `${item.index}:upper`, (item.via[0] ?? item.lower).cross)
    add(item.lower, 'in', `${item.index}:lower`, (item.via[item.via.length - 1] ?? item.upper).cross)
  }
  const offsets = new Map<string, number>()
  for (const [box, map] of sides) {
    for (const list of map.values()) {
      const sorted = [...list].sort((left, right) => left.toward - right.toward)
      const room = size(box) * (box.node?.shape === 'decision' ? 0.3 : 0.6)
      const step = sorted.length < 2 ? 0 : Math.min(16, room / (sorted.length - 1))
      sorted.forEach((item, index) => offsets.set(item.key, (index - (sorted.length - 1) / 2) * step))
    }
  }
  return offsets
}

/** 算出节点位置和每根线经过的点（坐标原点随意，画的时候按实际范围定视口）。 */
export function layoutGraph(block: GraphBlock): GraphLayout {
  const down = block.direction === 'down'
  const boxes = new Map<string, Box>(block.nodes.map((node, index) => [node.id, { id: node.id, node, group: node.group, ...measure(node), layer: 0, order: index, cross: 0 }]))
  const links = block.edges.flatMap((edge, index) => (edge.from !== edge.to && boxes.has(edge.from) && boxes.has(edge.to) ? [{ from: edge.from, to: edge.to, index }] : []))
  assignLayers(boxes, links)
  const routes = route(boxes, links)
  const real = [...boxes.values()]
  const all = [...real, ...routes.flatMap((item) => item.via)]
  const layers: Box[][] = Array.from({ length: Math.max(0, ...real.map((box) => box.layer)) + 1 }, () => [])
  for (const box of all) layers[box.layer]?.push(box)
  const above = new Map<Box, Box[]>()
  const below = new Map<Box, Box[]>()
  for (const item of routes) {
    const chain = [item.upper, ...item.via, item.lower]
    chain.slice(1).forEach((box, index) => {
      const prev = chain[index] as Box
      above.set(box, [...(above.get(box) ?? []), prev])
      below.set(prev, [...(below.get(prev) ?? []), box])
    })
  }
  const neighbors = (box: Box, upward: boolean): readonly Box[] => (upward ? below.get(box) : above.get(box)) ?? []
  const groupIds = block.groups.map((group) => group.id)
  const groupRank = (box: Box): number => (box.group === '' ? groupIds.length : groupIds.indexOf(box.group))
  orderLayers(layers, neighbors, groupRank)
  const size = (box: Box): number => (down ? box.w : box.h)
  placeCross(layers, (box) => size(box) + (box.group === '' || box.node === undefined ? 0 : GROUP_PAD), neighbors)
  separate(layers, groupIds, size, down ? 0 : GROUP_LABEL)
  const centers: number[] = []
  const thickness: number[] = []
  let along = 0
  for (const layer of layers) {
    const value = Math.max(0, ...layer.map((box) => (down ? box.h : box.w)))
    centers.push(along + value / 2)
    thickness.push(value)
    along += value + LAYER_GAP
  }
  const centerOf = (layer: number): number => centers[layer] ?? 0
  const point = (cross: number, main: number): Point => (down ? { x: cross, y: main } : { x: main, y: cross })
  /** 节点中心到它朝上下游那条边的距离；菱形离开中心越远边越近。 */
  const reach = (box: Box, offset: number): number => {
    const main = (down ? box.h : box.w) / 2
    return box.node?.shape === 'decision' ? main * (1 - Math.min(1, Math.abs(offset) / (size(box) / 2))) : main
  }
  const offsets = ports(routes, size)
  const edges = routes.map((item): PlacedEdge => {
    const top = offsets.get(`${item.index}:upper`) ?? 0
    const bottom = offsets.get(`${item.index}:lower`) ?? 0
    const start = point(item.upper.cross + top, centerOf(item.upper.layer) + reach(item.upper, top) + (item.reversed ? ARROW_GAP : 0))
    const middle = item.via.flatMap((box) => [point(box.cross, centerOf(box.layer) - (thickness[box.layer] ?? 0) / 2), point(box.cross, centerOf(box.layer) + (thickness[box.layer] ?? 0) / 2)])
    const end = point(item.lower.cross + bottom, centerOf(item.lower.layer) - reach(item.lower, bottom) - (item.reversed ? 0 : ARROW_GAP))
    const points = [start, ...middle, end]
    const center = item.via[Math.floor(item.via.length / 2)]
    const mid = center === undefined ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } : point(center.cross, centerOf(center.layer))
    return { index: item.index, points: item.reversed ? [...points].reverse() : points, mid }
  })
  const nodes = real.flatMap((box): PlacedNode[] => {
    if (box.node === undefined) return []
    const at = point(box.cross, centerOf(box.layer))
    return [{ node: box.node, lines: box.lines, note: box.note, w: box.w, h: box.h, x: at.x, y: at.y }]
  })
  return { nodes, edges }
}
