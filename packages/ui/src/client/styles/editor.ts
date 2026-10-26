/**
 * 带格式的输入框：列表、引用、代码块这些的样子和时间线上的 Markdown 一致，排得更紧凑。
 * 前几条是 ProseMirror 自己要的基础样式（照 prosemirror-view 的 style/prosemirror.css，MIT 授权），只作用在 Pod 的输入框上。
 */
export const EDITOR_CSS = `
.pod-editor { position: relative; word-wrap: break-word; white-space: pre-wrap; white-space: break-spaces; -webkit-font-variant-ligatures: none; font-variant-ligatures: none; font-feature-settings: "liga" 0; }
.pod-editor pre { white-space: pre-wrap; }
.pod-editor li { position: relative; }
.pod-editor.ProseMirror-hideselection *::selection { background: transparent; }
.pod-editor.ProseMirror-hideselection { caret-color: transparent; }
.pod-editor [draggable][contenteditable=false] { user-select: text; }
.pod-editor .ProseMirror-selectednode { outline: 2px solid color-mix(in srgb, var(--pod-info) 55%, transparent); }
.pod-editor li.ProseMirror-selectednode { outline: none; }
.pod-editor img.ProseMirror-separator { display: inline !important; border: none !important; margin: 0 !important; }

.pod-editor-host { min-width: 0; }
.pod-editor { box-sizing: border-box; min-height: 34px; max-height: 220px; padding: 6px 4px; overflow-y: auto; outline: none; font-size: 14.5px; line-height: 1.55; color: var(--dsw-alias-label-primary); caret-color: var(--dsw-alias-label-primary); overflow-wrap: break-word; word-break: normal; tab-size: 4; scrollbar-width: none; }
.pod-editor::-webkit-scrollbar { display: none; }
.pod-editor[contenteditable="false"] { cursor: not-allowed; }
.pod-editor p { margin: 0; }
.pod-editor p + p { margin-top: 4px; }
.pod-editor h1, .pod-editor h2, .pod-editor h3, .pod-editor h4, .pod-editor h5, .pod-editor h6 { margin: 2px 0; font-size: 1.05em; font-weight: 600; line-height: 1.45; }
.pod-editor h1 { font-size: 1.2em; }
.pod-editor h2 { font-size: 1.12em; }
.pod-editor ul, .pod-editor ol { margin: 2px 0; padding-left: 1.5em; }
.pod-editor li > p { margin: 0; }
.pod-editor li::marker { color: var(--dsw-alias-label-secondary); }
.pod-editor blockquote { margin: 2px 0; padding: 0 0 0 10px; border-left: 3px solid var(--pod-line); color: var(--dsw-alias-label-secondary); }
.pod-editor pre { margin: 4px 0; padding: 8px 10px; border-radius: 8px; background: var(--dsw-alias-markdown-code-block, var(--pod-soft)); font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 13px; line-height: 1.5; }
.pod-editor pre code { padding: 0; border-radius: 0; background: none; font-size: inherit; }
.pod-editor code { padding: 1px 4px; border-radius: 4px; background: var(--dsw-alias-markdown-code-block, var(--pod-soft)); font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: .88em; }
.pod-editor hr { margin: 8px 0; border: 0; border-top: 1px solid var(--pod-line); }
.pod-editor a { color: var(--pod-info); }
.pod-editor s { color: var(--dsw-alias-label-secondary); }
.pod-editor-placeholder { min-width: 0; padding: 6px 4px; overflow: hidden; color: var(--dsw-alias-label-tertiary); font-size: 14.5px; line-height: 1.55; white-space: nowrap; text-overflow: ellipsis; pointer-events: none; user-select: none; }
`
