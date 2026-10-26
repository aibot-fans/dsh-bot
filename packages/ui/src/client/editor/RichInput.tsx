import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { history } from 'prosemirror-history'
import { EditorState, Selection, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { fromMarkdown, isBlank, toMarkdown } from './convert.ts'
import { composerKeys } from './keys.ts'
import { mentionHighlight, mentionQuery, type MentionQuery } from './mentions.ts'
import { dropHandler, pasteHandler, sliceToText, textToSlice } from './paste.ts'
import { composerRules } from './rules.ts'
import { schema } from './schema.ts'

export type { MentionQuery } from './mentions.ts'

export interface RichInputHandle {
  readonly focus: () => void
  /** 现在写的内容（Markdown）。 */
  readonly value: () => string
  /** 换成这段内容（清空、选快捷指令），光标放到最后，撤销记录从头算。 */
  readonly reset: (markdown: string) => void
  /** 接在最后写（成员卡片上的“@ 它”）。 */
  readonly append: (text: string) => void
  /** 把一段换成这些字，光标放到后面（选中 @ 的成员）。 */
  readonly replace: (from: number, to: number, text: string) => void
}

export interface RichInputProps {
  /** 开始时的内容（草稿），只在第一次用。 */
  readonly initial: string
  readonly placeholder: string
  readonly label: string
  readonly disabled: boolean
  /** 标成彩色的 @成员。 */
  readonly mentions: RegExp | null
  /** 群聊里才认正在打的 @词、弹候选。 */
  readonly mentionable: boolean
  readonly onChange: (markdown: string) => void
  readonly onMention: (query: MentionQuery | undefined) => void
  /** 编辑器处理按键之前先问一声（候选列表的上下键、Enter、Esc）：处理了返回 true。 */
  readonly onKeyDown: (event: KeyboardEvent) => boolean
  readonly onSend: () => void
  readonly onFiles: (files: readonly File[]) => void
  readonly onBlur: () => void
}

/**
 * 带格式的输入框（ProseMirror）：列表、引用、代码块、粗体这些边打边变，存草稿和发出去都是 Markdown。
 * 按键见 keys.ts，打字变格式见 rules.ts，粘贴见 paste.ts。
 */
export const RichInput = forwardRef<RichInputHandle, RichInputProps>(function RichInput(props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef(props)
  const [blank, setBlank] = useState(() => props.initial.trim() === '')

  useLayoutEffect(() => {
    latest.current = props
  })

  const create = (markdown: string): EditorState => {
    const doc = fromMarkdown(markdown)
    const plugins = [composerRules(), ...composerKeys(() => latest.current.onSend()), history(), mentionHighlight(() => latest.current.mentions)]
    return EditorState.create({ doc, selection: Selection.atEnd(doc), plugins })
  }

  const report = (editor: EditorView, changed: boolean): void => {
    if (changed) {
      setBlank(isBlank(editor.state.doc))
      latest.current.onChange(toMarkdown(editor.state.doc))
    }
    latest.current.onMention(latest.current.mentionable ? mentionQuery(editor.state) : undefined)
  }

  useLayoutEffect(() => {
    const element = host.current
    if (element === null) return
    const editor: EditorView = new EditorView(element, {
      state: create(latest.current.initial),
      attributes: () => ({ class: 'pod-editor', role: 'textbox', 'aria-multiline': 'true', 'aria-label': latest.current.label, enterkeyhint: 'send' }),
      editable: () => !latest.current.disabled,
      dispatchTransaction(tr) {
        editor.updateState(editor.state.apply(tr))
        report(editor, tr.docChanged)
      },
      handleKeyDown: (_view, event) => latest.current.onKeyDown(event),
      handlePaste: pasteHandler((files) => latest.current.onFiles(files)),
      handleDrop: dropHandler((files) => latest.current.onFiles(files)),
      clipboardTextParser: (text, $context, plain) => textToSlice(text, $context, plain),
      clipboardTextSerializer: (slice) => sliceToText(slice),
      handleDOMEvents: {
        blur: () => {
          latest.current.onBlur()
          return false
        },
      },
    })
    view.current = editor
    setBlank(isBlank(editor.state.doc))
    return () => {
      view.current = null
      editor.destroy()
    }
  }, [])

  // 对话删了变只读、提示换了：让编辑器重新读一遍 editable 和 attributes。
  useEffect(() => {
    view.current?.setProps({})
  }, [props.disabled, props.label])
  // 成员变了：派一个空事务，@ 的高亮按新名单重画。
  useEffect(() => {
    const editor = view.current
    if (editor !== null) editor.dispatch(editor.state.tr)
  }, [props.mentions])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => view.current?.focus(),
      value: () => (view.current === null ? '' : toMarkdown(view.current.state.doc)),
      reset: (markdown) => {
        const editor = view.current
        if (editor === null) return
        editor.updateState(create(markdown))
        report(editor, true)
      },
      append: (text) => {
        const editor = view.current
        if (editor === null) return
        let tr = editor.state.tr
        let end = Selection.atEnd(tr.doc)
        // 最后是代码块或分隔线：另起一段再写。
        if (!(end instanceof TextSelection) || end.$from.parent.type.spec.code) {
          tr = tr.insert(tr.doc.content.size, schema.nodes.paragraph.create())
          end = Selection.atEnd(tr.doc)
        }
        const before = end.$from.parent.textBetween(Math.max(0, end.$from.parentOffset - 1), end.$from.parentOffset, undefined, '\n')
        const glue = before === '' || /\s$/.test(before) ? '' : ' '
        editor.dispatch(tr.setSelection(end).insertText(glue + text).scrollIntoView())
        editor.focus()
      },
      replace: (from, to, text) => {
        const editor = view.current
        if (editor === null) return
        editor.dispatch(editor.state.tr.insertText(text, from, to).scrollIntoView())
        editor.focus()
      },
    }),
    [],
  )

  return (
    <>
      <div ref={host} className="pod-editor-host" />
      {blank ? (
        <div className="pod-editor-placeholder" aria-hidden>
          {props.placeholder}
        </div>
      ) : null}
    </>
  )
})
