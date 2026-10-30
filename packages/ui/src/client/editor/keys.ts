import { baseKeymap, chainCommands, exitCode, lift, newlineInCode, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands'
import { redo, undo } from 'prosemirror-history'
import { undoInputRule } from 'prosemirror-inputrules'
import { keymap } from 'prosemirror-keymap'
import type { NodeType } from 'prosemirror-model'
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list'
import { Selection, TextSelection, type Command, type EditorState, type Plugin } from 'prosemirror-state'
import { schema } from './schema.ts'

const { paragraph, heading, blockquote, code_block: codeBlock, bullet_list: bulletList, ordered_list: orderedList, list_item: listItem, hard_break: hardBreak } = schema.nodes
const { strong, em, strike, code } = schema.marks

function within(state: EditorState, type: NodeType): boolean {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) if ($from.node(depth).type === type) return true
  return false
}

const insertBreak: Command = (state, dispatch) => {
  dispatch?.(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView())
  return true
}

/** 代码块最后连按三次 Enter（末尾已经有两个空行）：去掉空行，跳到代码块下面。 */
const leaveCodeOnTripleEnter: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  const block = $from.parent
  if (!empty || !block.type.spec.code || $from.parentOffset !== block.content.size || !block.textContent.endsWith('\n\n')) return false
  if (dispatch) {
    const tr = state.tr.delete($from.pos - 2, $from.pos)
    const after = tr.mapping.map($from.after())
    tr.insert(after, paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, after + 1))
    dispatch(tr.scrollIntoView())
  }
  return true
}

/** 光标在整个输入框的最后、又在代码块里：按 ↓ 跳到代码块下面，不然出不来。 */
const leaveCodeAtEnd: Command = (state, dispatch, view) => {
  const { $from, empty } = state.selection
  if (!empty || !$from.parent.type.spec.code || Selection.atEnd(state.doc).from !== $from.pos) return false
  if (view !== undefined && !view.endOfTextblock('down')) return false
  return exitCode(state, dispatch)
}

/** 一行只写了 ```（可以带语言）就按 Enter：变成代码块，不发送。 */
const fenceToCode: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type !== paragraph || $from.parentOffset !== $from.parent.content.size) return false
  const match = /^```([\w+#.-]*)$/.exec($from.parent.textContent)
  if (match === null) return false
  const index = $from.index(-1)
  if (!$from.node(-1).canReplaceWith(index, index + 1, codeBlock)) return false
  if (dispatch) {
    const start = $from.start()
    dispatch(state.tr.delete(start, $from.pos).setBlockType(start, start, codeBlock, { lang: match[1] ?? '' }).scrollIntoView())
  }
  return true
}

function inListItem(state: EditorState): boolean {
  const { $from } = state.selection
  return $from.depth >= 2 && $from.node(-1).type === listItem
}

/** 拆出下一项，空的一项上再按就退出列表（嵌套的退一层）。 */
const nextItem = chainCommands(splitListItem(listItem), liftListItem(listItem))

/**
 * Enter：在列表里拆出下一项（空的一项上再按就退出列表），在代码块里换行，其他时候发送。
 * 输入法正在组字时编辑器不会走到这里。
 */
function enterKey(send: () => void): Command {
  return (state, dispatch, view) => {
    if (state.selection.$from.parent.type.spec.code) return chainCommands(leaveCodeOnTripleEnter, newlineInCode)(state, dispatch, view)
    if (fenceToCode(state, dispatch, view)) return true
    if (inListItem(state)) return nextItem(state, dispatch, view)
    if (dispatch !== undefined) send()
    return true
  }
}

/** Shift+Enter：代码块里换行，列表里和 Enter 一样接下一项，其他时候在这一段里换行。 */
const shiftEnterKey: Command = chainCommands(newlineInCode, (state, dispatch, view) => inListItem(state) && nextItem(state, dispatch, view), insertBreak)

/** 列表开关：不在列表里就变成列表，在同样的列表里就退出来，在另一种列表里就换成这种。 */
function toggleList(type: NodeType): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection
    const range = $from.blockRange($to, (node) => node.type === bulletList || node.type === orderedList)
    if (range === null) return wrapInList(type)(state, dispatch)
    if (range.parent.type === type) return liftListItem(listItem)(state, dispatch)
    dispatch?.(state.tr.setNodeMarkup(range.$from.before(range.depth), type))
    return true
  }
}

const toggleQuote: Command = (state, dispatch) => (within(state, blockquote) ? lift(state, dispatch) : wrapIn(blockquote)(state, dispatch))

const toggleCodeBlock: Command = (state, dispatch) => setBlockType(state.selection.$from.parent.type === codeBlock ? paragraph : codeBlock)(state, dispatch)

/** 行首按退格：标题、空代码块变回普通段落；列表项先退出列表（嵌套的退一层）。 */
const backspaceAtStart: Command = (state, dispatch) => {
  const $cursor = state.selection instanceof TextSelection ? state.selection.$cursor : null
  if ($cursor === null || $cursor.parentOffset > 0) return false
  const block = $cursor.parent
  if (block.type === heading || (block.type === codeBlock && block.content.size === 0)) return setBlockType(paragraph)(state, dispatch)
  if ($cursor.depth >= 2 && $cursor.node(-1).type === listItem && $cursor.index(-1) === 0) return liftListItem(listItem)(state, dispatch)
  return false
}

/** Tab：代码块里打两个空格；列表里缩进一层（缩不了也不让焦点跑出输入框）；其他地方照常切焦点。 */
const tabKey: Command = (state, dispatch) => {
  if (state.selection.$from.parent.type.spec.code) {
    dispatch?.(state.tr.insertText('  ').scrollIntoView())
    return true
  }
  if (!within(state, listItem)) return false
  sinkListItem(listItem)(state, dispatch)
  return true
}

const shiftTabKey: Command = (state, dispatch) => {
  if (!within(state, listItem)) return false
  liftListItem(listItem)(state, dispatch)
  return true
}

/**
 * 输入框的按键。快捷键和 Slack 一样：Cmd/Ctrl+B 粗体、+I 斜体、+Shift+X 删除线、+E 行内代码、
 * +Shift+7 有序列表、+Shift+8 无序列表、+Shift+9 引用、+Alt+C 代码块；Shift+Enter 换行（列表里接下一项），Cmd/Ctrl+Enter 总是发送。
 */
export function composerKeys(send: () => void): readonly Plugin[] {
  return [
    keymap({
      Enter: enterKey(send),
      'Mod-Enter': (_state, dispatch) => {
        if (dispatch !== undefined) send()
        return true
      },
      'Shift-Enter': shiftEnterKey,
      'Mod-b': toggleMark(strong),
      'Mod-i': toggleMark(em),
      'Mod-e': toggleMark(code),
      'Mod-Shift-x': toggleMark(strike),
      'Mod-Shift-7': toggleList(orderedList),
      'Mod-Shift-8': toggleList(bulletList),
      'Mod-Shift-9': toggleQuote,
      'Mod-Alt-c': toggleCodeBlock,
      Tab: tabKey,
      'Shift-Tab': shiftTabKey,
      Backspace: chainCommands(undoInputRule, backspaceAtStart),
      ArrowDown: leaveCodeAtEnd,
      'Mod-z': undo,
      'Shift-Mod-z': redo,
      'Mod-y': redo,
    }),
    keymap(baseKeymap),
  ]
}
