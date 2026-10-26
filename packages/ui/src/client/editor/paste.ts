import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { fromMarkdown, inlineDoc, inlineMarkdown, plainDoc, toMarkdown } from './convert.ts'
import { schema } from './schema.ts'

/**
 * 粘贴：带格式的网页内容按格式贴（schema 里的 parseDOM）；纯文字按 Markdown 排好格式，
 * 只有一行时只认行内格式；Cmd/Ctrl+Shift+V 和贴进代码块时按原样的字。
 */
export function textToSlice(text: string, $context: ResolvedPos, plain: boolean): Slice {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (normalized === '') return Slice.empty
  if ($context.parent.type.spec.code) return new Slice(Fragment.from(schema.text(normalized)), 0, 0)
  const doc = plain ? plainDoc(normalized) : normalized.includes('\n') ? fromMarkdown(normalized) : inlineDoc(normalized)
  // 头尾是段落就和光标所在的段落接上，列表、代码块这些整块放进去。
  const open = (node: PMNode | null): number => (node?.type === schema.nodes.paragraph ? 1 : 0)
  return new Slice(doc.content, open(doc.firstChild), open(doc.lastChild))
}

/** 复制出去的纯文字是 Markdown；只选了一段里的字时只给这几个字（带行内格式）。 */
export function sliceToText(slice: Slice): string {
  let node = slice.content.childCount === 1 ? slice.content.firstChild : null
  for (let depth = 0; node !== null && !node.isTextblock && node.childCount === 1 && depth < Math.min(slice.openStart, slice.openEnd); depth += 1) node = node.firstChild
  if (node !== null && node.isTextblock) return node.type.spec.code ? node.textContent : inlineMarkdown(node)
  try {
    return toMarkdown(schema.nodes.doc.createChecked(null, slice.content))
  } catch {
    return slice.content.textBetween(0, slice.content.size, '\n\n')
  }
}

/** VS Code 复制时带着语言：从它的剪贴板数据里读。 */
function editorLanguage(raw: string): string {
  try {
    const mode = (JSON.parse(raw) as { readonly mode?: unknown }).mode
    return typeof mode === 'string' && mode !== 'plaintext' && /^[\w+#.-]{1,20}$/.test(mode) ? mode : ''
  } catch {
    return ''
  }
}

/** 粘贴文件交给外面当附件；从 VS Code 复制的多行代码贴成代码块。其他的交给编辑器自己贴。 */
export function pasteHandler(onFiles: (files: readonly File[]) => void): (view: EditorView, event: ClipboardEvent) => boolean {
  return (view, event) => {
    const data = event.clipboardData
    if (data === null) return false
    const files = [...data.files]
    if (files.length > 0) {
      onFiles(files)
      return true
    }
    const fromEditor = data.getData('vscode-editor-data')
    const code = data.getData('text/plain').replace(/\r\n?/g, '\n').replace(/\n$/, '')
    if (fromEditor === '' || !code.includes('\n') || view.state.selection.$from.parent.type.spec.code) return false
    const block = schema.nodes.code_block.create({ lang: editorLanguage(fromEditor) }, schema.text(code))
    view.dispatch(view.state.tr.replaceSelectionWith(block).scrollIntoView())
    return true
  }
}

/** 拖进来的文件交给外面当附件。 */
export function dropHandler(onFiles: (files: readonly File[]) => void): (view: EditorView, event: DragEvent) => boolean {
  return (_view, event) => {
    const files = [...(event.dataTransfer?.files ?? [])]
    if (files.length === 0) return false
    onFiles(files)
    return true
  }
}
