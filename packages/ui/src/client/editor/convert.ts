import type { Mark, Node as PMNode } from 'prosemirror-model'
import { parseBlocks, type Block } from '../markdown/blocks.ts'
import { parseInline, type Inline } from '../markdown/inline.ts'
import { schema } from './schema.ts'

/**
 * 输入框的内容和 Markdown 互转：读回草稿、粘贴文字时 Markdown 变成格式；存草稿、发出去时格式变回 Markdown。
 * 解析和时间线共用 markdown/ 下的规则，发出去的样子和输入框里看到的一样。
 * 不做转义：字面上打的 * 和 # 原样发出去，bot 读到的就是你打的字。
 */

const { nodes, marks } = schema

// ---------- Markdown 变成格式 ----------

function inlineNodes(tokens: readonly Inline[], active: readonly Mark[]): PMNode[] {
  return tokens.flatMap((token): PMNode[] => {
    switch (token.kind) {
      case 'text':
        return token.text === '' ? [] : [schema.text(token.text, active)]
      case 'code':
        return token.text === '' ? [] : [schema.text(token.text, marks.code.create().addToSet(active))]
      case 'strong':
        return inlineNodes(token.children, marks.strong.create().addToSet(active))
      case 'em':
        return inlineNodes(token.children, marks.em.create().addToSet(active))
      case 'strike':
        return inlineNodes(token.children, marks.strike.create().addToSet(active))
      case 'link':
        return inlineNodes(token.children, marks.link.create({ href: token.href }).addToSet(active))
      case 'url':
        return [schema.text(token.href, active)]
    }
  })
}

/** 段落的几行：行和行之间是换行（Shift+Enter 打出来的那种）。 */
function lineNodes(lines: readonly string[]): PMNode[] {
  return lines.flatMap((line, index) => [...(index > 0 ? [nodes.hard_break.create()] : []), ...inlineNodes(parseInline(line), [])])
}

function tableLines(head: readonly string[], rows: readonly (readonly string[])[]): readonly string[] {
  const row = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`
  return [row(head), row(head.map(() => '---')), ...rows.map(row)]
}

function blockNodes(block: Block): PMNode[] {
  switch (block.kind) {
    case 'paragraph':
      return [nodes.paragraph.create(null, lineNodes(block.lines))]
    case 'heading':
      return [nodes.heading.create({ level: block.level }, inlineNodes(parseInline(block.text), []))]
    case 'code':
      return [nodes.code_block.create({ lang: block.lang }, block.text === '' ? null : schema.text(block.text))]
    case 'rule':
      return [nodes.horizontal_rule.create()]
    case 'quote': {
      const inner = block.blocks.flatMap(blockNodes)
      return [nodes.blockquote.create(null, inner.length > 0 ? inner : [nodes.paragraph.create()])]
    }
    case 'list': {
      const items = block.items.map((item) => {
        const inner = item.flatMap(blockNodes)
        return nodes.list_item.create(null, inner[0]?.type === nodes.paragraph ? inner : [nodes.paragraph.create(), ...inner])
      })
      return [block.ordered ? nodes.ordered_list.create({ order: block.start }, items) : nodes.bullet_list.create(null, items)]
    }
    // 输入框里没有表格：按原来的几行字放着，发出去还是表格。
    case 'table':
      return [nodes.paragraph.create(null, lineNodes(tableLines(block.head, block.rows)))]
  }
}

function docOf(content: readonly PMNode[]): PMNode {
  return nodes.doc.create(null, content.length > 0 ? content : [nodes.paragraph.create()])
}

/** 不认格式，原样的字：空行分段，单个换行是换行。 */
export function plainDoc(text: string): PMNode {
  const paragraphs = text.split(/\n[ \t]*\n/).map((chunk) =>
    nodes.paragraph.create(
      null,
      chunk.split('\n').flatMap((line, index) => [...(index > 0 ? [nodes.hard_break.create()] : []), ...(line === '' ? [] : [schema.text(line)])]),
    ),
  )
  return docOf(paragraphs)
}

/** 一行字：只认行内格式（粗体、代码、链接），开头的 # 和 - 照字面放着。 */
export function inlineDoc(text: string): PMNode {
  return docOf([nodes.paragraph.create(null, inlineNodes(parseInline(text), []))])
}

export function fromMarkdown(text: string): PMNode {
  try {
    const doc = docOf(parseBlocks(text).flatMap(blockNodes))
    doc.check()
    return doc
  } catch {
    return plainDoc(text)
  }
}

// ---------- 格式变回 Markdown ----------

function opening(mark: Mark): string {
  if (mark.type === marks.link) return '['
  if (mark.type === marks.strong) return '**'
  if (mark.type === marks.strike) return '~~'
  return '*'
}

function closing(mark: Mark): string {
  if (mark.type === marks.link) return `](${String(mark.attrs.href)})`
  return opening(mark)
}

function codeSpan(text: string): string {
  return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``
}

/** 一段里的字和行内格式。格式两头的空格挪到记号外面，不然 **粗体 ** 认不出来；换行处格式先收起，下一行再开。 */
export function inlineMarkdown(block: PMNode): string {
  let out = ''
  const open: Mark[] = []
  const closeTo = (keep: number): void => {
    if (open.length <= keep) return
    const trail = /[ \t]*$/.exec(out)?.[0] ?? ''
    out = out.slice(0, out.length - trail.length)
    while (open.length > keep) {
      const mark = open.pop()
      if (mark !== undefined) out += closing(mark)
    }
    out += trail
  }
  block.forEach((child) => {
    if (child.type === nodes.hard_break) {
      closeTo(0)
      out += '\n'
      return
    }
    if (!child.isText) return
    const text = child.text ?? ''
    if (marks.code.isInSet(child.marks) !== undefined) {
      closeTo(0)
      out += codeSpan(text)
      return
    }
    let keep = 0
    while (keep < open.length && open[keep]?.isInSet(child.marks) === true) keep += 1
    closeTo(keep)
    const fresh = child.marks.filter((mark) => !mark.isInSet(open))
    const lead = fresh.length === 0 ? '' : (/^[ \t]*/.exec(text)?.[0] ?? '')
    out += lead
    const rest = text.slice(lead.length)
    if (rest === '') return
    for (const mark of fresh) {
      out += opening(mark)
      open.push(mark)
    }
    out += rest
  })
  closeTo(0)
  return out
}

const isList = (node: PMNode): boolean => node.type === nodes.bullet_list || node.type === nodes.ordered_list

/** 一项的几块：第一块跟在标记后面；嵌套列表紧接着写，其他块前面空一行。 */
function itemLines(item: PMNode): string[] {
  const out: string[] = []
  item.forEach((child, _offset, index) => {
    if (index > 0 && !isList(child)) out.push('')
    out.push(...blockLines(child))
  })
  return out
}

function listLines(list: PMNode, marker: (index: number) => string): string[] {
  const out: string[] = []
  list.forEach((item, _offset, index) => {
    const prefix = marker(index)
    const pad = ' '.repeat(prefix.length)
    itemLines(item).forEach((line, lineIndex) => {
      if (lineIndex === 0) out.push(line === '' ? prefix.trimEnd() : prefix + line)
      else out.push(line === '' ? '' : pad + line)
    })
  })
  return out
}

function blockLines(node: PMNode): string[] {
  switch (node.type) {
    case nodes.paragraph:
      return inlineMarkdown(node).split('\n')
    case nodes.heading:
      return [`${'#'.repeat(Number(node.attrs.level) || 1)} ${inlineMarkdown(node).replace(/\n/g, ' ')}`]
    case nodes.code_block: {
      const text = node.textContent
      const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length))
      const fence = '`'.repeat(longest + 1)
      return [`${fence}${String(node.attrs.lang)}`, ...text.split('\n'), fence]
    }
    case nodes.horizontal_rule:
      return ['---']
    case nodes.blockquote:
      return joinBlocks(node).map((line) => (line === '' ? '>' : `> ${line}`))
    case nodes.bullet_list:
      return listLines(node, () => '- ')
    case nodes.ordered_list:
      return listLines(node, (index) => `${(Number(node.attrs.order) || 1) + index}. `)
    default:
      return [node.textContent]
  }
}

/** 一串块，块和块之间空一行；空段落不占行。 */
function joinBlocks(parent: PMNode): string[] {
  const out: string[] = []
  parent.forEach((child) => {
    if (child.type === nodes.paragraph && child.content.size === 0) return
    if (out.length > 0) out.push('')
    out.push(...blockLines(child))
  })
  return out
}

/** 什么都没写（只有空段落、空列表项）。 */
export function isBlank(doc: PMNode): boolean {
  let filled = false
  doc.descendants((node) => {
    if (filled) return false
    if (node.type === nodes.horizontal_rule || (node.isText && (node.text ?? '').trim() !== '')) filled = true
    return !filled
  })
  return !filled
}

export function toMarkdown(doc: PMNode): string {
  if (isBlank(doc)) return ''
  return joinBlocks(doc).join('\n').replace(/^\n+/, '').trimEnd()
}
