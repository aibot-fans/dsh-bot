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

/**
 * 退格时光标紧挨着一个 @名字（或选名字时补在后面的那个空格）：整个名字连同空格一起删掉，不用一个字一个字删。
 * 代码块里不管；带修饰键的退格（按词删、删到行首）照常。
 */
export function mentionDelete(pattern: () => RegExp | null): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.key !== 'Backspace' || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.isComposing) return false
        const current = pattern()
        const { selection } = view.state
        if (current === null || !selection.empty) return false
        const { $from } = selection
        if ($from.parent.type.spec.code) return false
        const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
        const end = before.endsWith(' ') ? before.length - 1 : before.length
        const found = [...before.slice(0, end).matchAll(current)].find((match) => (match.index ?? 0) + match[0].length === end)
        if (found === undefined) return false
        view.dispatch(view.state.tr.delete($from.start() + (found.index ?? 0), $from.pos).scrollIntoView())
        return true
      },
    },
  })
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
