/**
 * 块级的 Markdown：段落、标题、列表（可以嵌套）、引用、代码块、表格、分隔线。
 * 时间线显示消息、输入框读回草稿和粘贴的文字都用这一套，两边认的格式一样。
 * 和聊天的习惯一致：段落里的单个换行就是换行；列表项后面紧跟一行不缩进的字，算列表结束。
 */

export type Block =
  | { readonly kind: 'code'; readonly lang: string; readonly text: string }
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'quote'; readonly blocks: readonly Block[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly start: number; readonly items: readonly (readonly Block[])[] }
  | { readonly kind: 'table'; readonly head: readonly string[]; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: 'rule' }
  | { readonly kind: 'paragraph'; readonly lines: readonly string[] }

const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/
const FENCE = /^\s*(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/
const FENCE_END = /^\s*(`{3,}|~{3,})\s*$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/
const RULE = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/
const QUOTE = /^\s{0,3}>/

function blank(line: string | undefined): boolean {
  return line === undefined || line.trim() === ''
}

/** 行首空白有多宽：制表符按到下一个 4 的倍数算。 */
function indentOf(line: string): number {
  let width = 0
  for (const char of line) {
    if (char === ' ') width += 1
    else if (char === '\t') width += 4 - (width % 4)
    else break
  }
  return width
}

/** 去掉行首最多 columns 宽的空白。 */
function dedent(line: string, columns: number): string {
  let width = 0
  let index = 0
  while (index < line.length && width < columns) {
    const char = line[index]
    if (char === ' ') width += 1
    else if (char === '\t') width += 4 - (width % 4)
    else break
    index += 1
  }
  return line.slice(index)
}

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || RULE.test(line)
}

function splitRow(line: string): readonly string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function isTableSeparator(line: string | undefined): boolean {
  return line !== undefined && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)
}

/** 代码块结束的那一行（结束的 ```）；没写结束就是 undefined，代码一直到最后。 */
function fenceClose(lines: readonly string[], start: number, marker: string): number | undefined {
  for (let index = start + 1; index < lines.length; index += 1) {
    const close = FENCE_END.exec(lines[index] ?? '')
    if (close !== null && close[1]?.[0] === marker[0] && (close[1]?.length ?? 0) >= marker.length) return index
  }
  return undefined
}

/** 这几行共同的缩进，最多 limit 宽：代码行缩进得比 ``` 还少时，按代码行的算，不吃掉代码自己的缩进。 */
function sharedIndent(lines: readonly string[], limit: number): number {
  return Math.min(limit, ...lines.filter((line) => !blank(line)).map(indentOf))
}

function readFence(lines: readonly string[], start: number, open: RegExpExecArray): { readonly block: Block; readonly next: number } {
  const close = fenceClose(lines, start, open[1] ?? '```')
  const body = lines.slice(start + 1, close ?? lines.length)
  const shift = sharedIndent(body, indentOf(lines[start] ?? ''))
  return { block: { kind: 'code', lang: open[2] ?? '', text: body.map((line) => dedent(line, shift)).join('\n') }, next: close === undefined ? lines.length : close + 1 }
}

function readTable(lines: readonly string[], start: number): { readonly block: Block; readonly next: number } {
  const rows: (readonly string[])[] = []
  let index = start + 2
  while (index < lines.length && (lines[index] ?? '').includes('|') && !blank(lines[index])) {
    rows.push(splitRow(lines[index] ?? ''))
    index += 1
  }
  return { block: { kind: 'table', head: splitRow(lines[start] ?? ''), rows }, next: index }
}

function nextFilled(lines: readonly string[], from: number): number {
  let index = from
  while (index < lines.length && blank(lines[index])) index += 1
  return index
}

const isOrdered = (marker: string | undefined): boolean => /\d/.test(marker ?? '')

/**
 * 一个列表：每一项收下比标记缩进得多的行（去掉缩进后再按块解析，里面的列表就成了嵌套列表），
 * 缩进不够标记的行（下一项，或者列表后面的字）结束这一项。项和项之间隔一个空行还是同一个列表。
 */
function readList(lines: readonly string[], start: number): { readonly block: Block; readonly next: number } {
  const first = ITEM.exec(lines[start] ?? '')
  const ordered = isOrdered(first?.[2])
  const items: (readonly Block[])[] = []
  let index = start
  while (index < lines.length) {
    const match = ITEM.exec(lines[index] ?? '')
    if (match === null || isOrdered(match[2]) !== ordered) break
    const indent = indentOf(match[1] ?? '')
    const gap = match[3] === undefined || match[4] === '' ? 1 : indentOf(match[3])
    const content = indent + (match[2]?.length ?? 1) + (gap > 4 ? 1 : gap)
    const body: string[] = [match[4] ?? '']
    index += 1
    while (index < lines.length) {
      const line = lines[index] ?? ''
      if (blank(line)) {
        const next = nextFilled(lines, index)
        if (next >= lines.length || indentOf(lines[next] ?? '') < content) break
        while (index < next) {
          body.push('')
          index += 1
        }
        continue
      }
      const width = indentOf(line)
      if (width <= indent) break
      if (FENCE.test(line)) {
        // 项里的代码块一直收到结束的 ```，代码行缩进不够也不算这一项结束。
        const close = fenceClose(lines, index, FENCE.exec(line)?.[1] ?? '```')
        const end = close === undefined ? lines.length : close + 1
        const chunk = lines.slice(index, end)
        const shift = sharedIndent(chunk, Math.min(width, content))
        body.push(...chunk.map((item) => dedent(item, shift)))
        index = end
        continue
      }
      body.push(dedent(line, Math.min(width, content)))
      index += 1
    }
    items.push(blocksOf(body))
    if (index < lines.length && blank(lines[index])) {
      const next = nextFilled(lines, index)
      const sibling = ITEM.exec(lines[next] ?? '')
      if (sibling === null || isOrdered(sibling[2]) !== ordered || indentOf(sibling[1] ?? '') > indent) break
      index = next
    }
  }
  const startNumber = ordered ? Number.parseInt(first?.[2] ?? '1', 10) : 1
  return { block: { kind: 'list', ordered, start: Number.isFinite(startNumber) ? startNumber : 1, items }, next: index }
}

function blocksOf(lines: readonly string[]): readonly Block[] {
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (blank(line)) {
      index += 1
      continue
    }
    const fence = FENCE.exec(line)
    const heading = fence === null ? HEADING.exec(line) : null
    let read: { readonly block: Block; readonly next: number } | undefined
    if (fence !== null) read = readFence(lines, index, fence)
    else if (heading !== null) read = { block: { kind: 'heading', level: heading[1]?.length ?? 1, text: heading[2] ?? '' }, next: index + 1 }
    else if (RULE.test(line)) read = { block: { kind: 'rule' }, next: index + 1 }
    else if (line.includes('|') && isTableSeparator(lines[index + 1])) read = readTable(lines, index)
    else if (QUOTE.test(line)) {
      const quoted: string[] = []
      let next = index
      while (next < lines.length && QUOTE.test(lines[next] ?? '')) {
        quoted.push((lines[next] ?? '').replace(/^\s{0,3}>\s?/, ''))
        next += 1
      }
      read = { block: { kind: 'quote', blocks: blocksOf(quoted) }, next }
    } else if (ITEM.test(line)) read = readList(lines, index)
    if (read !== undefined) {
      blocks.push(read.block)
      index = read.next
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index] ?? ''
      if (blank(current) || startsBlock(current) || (current.includes('|') && isTableSeparator(lines[index + 1]))) break
      if (paragraph.length > 0 && ITEM.test(current)) break
      paragraph.push(current)
      index += 1
    }
    blocks.push({ kind: 'paragraph', lines: paragraph })
  }
  return blocks
}

export function parseBlocks(source: string): readonly Block[] {
  return blocksOf(source.replace(/\r\n?/g, '\n').split('\n'))
}
