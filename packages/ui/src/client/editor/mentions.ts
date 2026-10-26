import { Plugin, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

/** 光标前正在打的 @词：在文档里的起止位置和已经打的字。 */
export interface MentionQuery {
  readonly from: number
  readonly to: number
  readonly query: string
}

/**
 * 光标前正在打的 @词。@ 前面是开头、空白或标点、中文都算（“请@码农”），紧挨字母数字的不算（邮箱）。
 * 代码块和行内代码里不认。
 */
export function mentionQuery(state: EditorState): MentionQuery | undefined {
  const { selection } = state
  if (!selection.empty) return undefined
  const { $from } = selection
  if ($from.parent.type.spec.code || $from.marks().some((mark) => mark.type.spec.code)) return undefined
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 40), $from.parentOffset, undefined, '\ufffc')
  const match = /(?:^|[^\w@])@([^\s@\ufffc]{0,24})$/.exec(before)
  if (match === null) return undefined
  const query = match[1] ?? ''
  return { from: $from.pos - query.length - 1, to: $from.pos, query }
}

/** 群聊里 @ 到的成员标成彩色。规则从 pattern() 现取：成员变了，外面派一个空事务让它重画。 */
export function mentionHighlight(pattern: () => RegExp | null): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const current = pattern()
        if (current === null) return null
        const found: Decoration[] = []
        state.doc.descendants((node, pos) => {
          if (node.type.spec.code) return false
          if (!node.isText) return true
          const text = node.text ?? ''
          if (!text.includes('@') || node.marks.some((mark) => mark.type.spec.code)) return false
          for (const match of text.matchAll(current)) {
            const start = pos + (match.index ?? 0)
            found.push(Decoration.inline(start, start + match[0].length, { class: 'pod-composer-mention' }))
          }
          return false
        })
        return DecorationSet.create(state.doc, found)
      },
    },
  })
}
