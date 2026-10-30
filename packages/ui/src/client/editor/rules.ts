import { InputRule, inputRules } from 'prosemirror-inputrules'
import type { Attrs, MarkType, Node as PMNode, NodeType } from 'prosemirror-model'
import type { Plugin, Transaction } from 'prosemirror-state'
import { canJoin, findWrapping } from 'prosemirror-transform'
import { schema } from './schema.ts'

/**
 * 行内格式：打完结尾的记号，中间的字变成这个格式，两头的记号去掉；之后接着打的字不带格式。
 * 正则的第 1 组是带记号的整段，第 2 组是中间的字；\ufffc 是换行占的位置，格式不跨行。
 */
function markRule(pattern: RegExp, type: MarkType, delimiter: number): InputRule {
  return new InputRule(
    pattern,
    (state, match, start, end) => {
      const span = match[1] ?? ''
      const inner = match[2] ?? ''
      if (inner === '') return null
      const from = start + match[0].length - span.length
      const innerFrom = from + delimiter
      const innerTo = innerFrom + inner.length
      const tr = state.tr
      tr.delete(innerTo, end)
      tr.delete(from, innerFrom)
      tr.addMark(from, from + inner.length, type.create())
      tr.removeStoredMark(type)
      return tr
    },
    { inCodeMark: false },
  )
}

/** 记号已经删掉以后，把 start 所在的这一行变成别的块；变不了返回 false。 */
type LineChange = (tr: Transaction, start: number, match: RegExpMatchArray) => boolean

/**
 * 块级记号打在一行的开头才算：输入框开头、段落开头，或者 Shift+Enter 换出来的一行（\ufffc 是换行占的位置）。
 * 在换出来的行上时，先在那个换行处把段落拆成两段，只把后一段变格式。
 */
function lineRule(marker: RegExp, change: LineChange): InputRule {
  return new InputRule(new RegExp(`(?:^|\\ufffc)${marker.source}$`), (state, match, start, end) => {
    const afterBreak = match[0].startsWith('\ufffc')
    const tr = state.tr.delete(afterBreak ? start + 1 : start, end)
    let line = start
    if (afterBreak) {
      tr.delete(start, start + 1)
      if (tr.doc.resolve(start).parentOffset > 0) {
        tr.split(start)
        line = start + 2
      }
    }
    return change(tr, line, match) ? tr : null
  })
}

/**
 * 把这一行包进列表或引用；紧挨在前面的是同一种列表（有序列表还要序号接得上）就并进去。
 * 已经在同一种列表一项的开头时只去掉记号，不再套一层：Shift+Enter 接出了下一项，又顺手打了 `2. `。
 */
function wrapLine(type: NodeType, attrs?: (match: RegExpMatchArray) => Attrs, join?: (match: RegExpMatchArray, node: PMNode) => boolean): LineChange {
  return (tr, start, match) => {
    const $start = tr.doc.resolve(start)
    if ($start.node(-1).type === schema.nodes.list_item && $start.index(-1) === 0 && $start.node(-2).type === type) return true
    const range = $start.blockRange()
    const wrapping = range === null ? null : findWrapping(range, type, attrs?.(match) ?? null)
    if (range === null || wrapping === null) return false
    tr.wrap(range, wrapping)
    const before = tr.doc.resolve(start - 1).nodeBefore
    if (before?.type === type && canJoin(tr.doc, start - 1) && (join === undefined || join(match, before))) tr.join(start - 1)
    return true
  }
}

/** 把这一行换成标题或代码块。 */
function setLine(type: NodeType, attrs: (match: RegExpMatchArray) => Attrs): LineChange {
  return (tr, start, match) => {
    const $start = tr.doc.resolve(start)
    if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), type)) return false
    tr.setBlockType(start, start, type, attrs(match))
    return true
  }
}

/** 有序列表记号里的序号：`1. ` 在第 1 组，`1、` 这种在第 2 组。 */
const orderOf = (match: RegExpMatchArray): number => Number(match[1] ?? match[2])

/** 空的列表项、引用里打的空格不要：中文写法的记号不用空格就变，变完顺手打的空格会成了这一项开头的空格。 */
function skipLeadingSpace(containers: readonly NodeType[]): InputRule {
  return new InputRule(
    /^\s$/,
    (state) => {
      const { $from } = state.selection
      return $from.parent.content.size === 0 && $from.depth >= 2 && containers.includes($from.node(-1).type) ? state.tr : null
    },
    { undoable: false },
  )
}

/**
 * 输入框里打 Markdown 记号直接变格式（刚变完按退格可以变回原来的字）：
 * 行首（包括 Shift+Enter 换出来的行）`- ` `* ` `1. ` 变列表，`> ` 变引用，```` ``` ```` 加空格变代码块，`# ` 到 `### ` 变标题；
 * 中文输入法打出来的 `1、` `1。` `•` `·` `》` 这些不用空格，打完就变。
 * `**粗体**`、`*斜体*`、`_斜体_`、`~~删除线~~`、`` `代码` ``。
 */
export function composerRules(): Plugin {
  const { nodes, marks } = schema
  return inputRules({
    rules: [
      lineRule(/\s*(?:[-+*]\s|[•·－＊])/, wrapLine(nodes.bullet_list)),
      // 中文写法的序号最多三位，免得一行以“2024。”开头也变成列表。
      lineRule(
        /(?:(\d{1,9})[.)]\s|(\d{1,3})[。．、）])/,
        wrapLine(
          nodes.ordered_list,
          (match) => ({ order: orderOf(match) }),
          (match, node) => node.childCount + Number(node.attrs.order) === orderOf(match),
        ),
      ),
      lineRule(/\s*(?:>\s|[》＞])/, wrapLine(nodes.blockquote)),
      lineRule(/```([\w+#.-]*)\s/, setLine(nodes.code_block, (match) => ({ lang: match[1] ?? '' }))),
      lineRule(/([#＃]{1,3})\s/, setLine(nodes.heading, (match) => ({ level: match[1]?.length ?? 1 }))),
      skipLeadingSpace([nodes.list_item, nodes.blockquote]),
      markRule(/(?:^|[^`])(`([^`\ufffc]+)`)$/, marks.code, 1),
      // 开头的星号两边都紧挨字母数字时不算：2*3*4、2**10 这种算式不变格式；“React**组件**”照样变粗体（和时间线上的规则一样）。
      markRule(/(?<!\*)(?:(?<!\w)|(?=\*\*[^\w\s*]))(\*\*([^*\s\ufffc](?:[^*\ufffc]*[^*\s\ufffc])?)\*\*)$/, marks.strong, 2),
      markRule(/(?<!\*)(?:(?<!\w)|(?=\*[^\w\s*]))(\*([^*\s\ufffc](?:[^*\ufffc]*[^*\s\ufffc])?)\*)$/, marks.em, 1),
      markRule(/(?:^|[^_\w])(_([^_\s\ufffc](?:[^_\ufffc]*[^_\s\ufffc])?)_)$/, marks.em, 1),
      markRule(/(?:^|[^~])(~~([^~\s\ufffc](?:[^~\ufffc]*[^~\s\ufffc])?)~~)$/, marks.strike, 2),
    ],
  })
}
