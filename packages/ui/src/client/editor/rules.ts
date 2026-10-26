import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules'
import type { MarkType } from 'prosemirror-model'
import type { Plugin } from 'prosemirror-state'
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

/**
 * 输入框里打 Markdown 记号直接变格式（刚变完按退格可以变回原来的字）：
 * 行首 `- ` `* ` `1. ` 变列表，`> ` 变引用，```` ``` ```` 加空格变代码块，`# ` 到 `### ` 变标题；
 * `**粗体**`、`*斜体*`、`_斜体_`、`~~删除线~~`、`` `代码` ``。
 */
export function composerRules(): Plugin {
  const { nodes, marks } = schema
  return inputRules({
    rules: [
      wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list),
      wrappingInputRule(
        /^(\d{1,9})[.)]\s$/,
        nodes.ordered_list,
        (match) => ({ order: Number(match[1]) }),
        (match, node) => node.childCount + Number(node.attrs.order) === Number(match[1]),
      ),
      wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
      textblockTypeInputRule(/^```([\w+#.-]*)\s$/, nodes.code_block, (match) => ({ lang: match[1] ?? '' })),
      textblockTypeInputRule(/^(#{1,3})\s$/, nodes.heading, (match) => ({ level: match[1]?.length ?? 1 })),
      markRule(/(?:^|[^`])(`([^`\ufffc]+)`)$/, marks.code, 1),
      // 开头的星号两边都紧挨字母数字时不算：2*3*4、2**10 这种算式不变格式；“React**组件**”照样变粗体（和时间线上的规则一样）。
      markRule(/(?<!\*)(?:(?<!\w)|(?=\*\*[^\w\s*]))(\*\*([^*\s\ufffc](?:[^*\ufffc]*[^*\s\ufffc])?)\*\*)$/, marks.strong, 2),
      markRule(/(?<!\*)(?:(?<!\w)|(?=\*[^\w\s*]))(\*([^*\s\ufffc](?:[^*\ufffc]*[^*\s\ufffc])?)\*)$/, marks.em, 1),
      markRule(/(?:^|[^_\w])(_([^_\s\ufffc](?:[^_\ufffc]*[^_\s\ufffc])?)_)$/, marks.em, 1),
      markRule(/(?:^|[^~])(~~([^~\s\ufffc](?:[^~\ufffc]*[^~\s\ufffc])?)~~)$/, marks.strike, 2),
    ],
  })
}
