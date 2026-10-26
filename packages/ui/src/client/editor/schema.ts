import { Schema } from 'prosemirror-model'

/** 代码块的语言：从 <pre data-lang> 或 <code class="language-x"> 上读。 */
function langOf(dom: HTMLElement): string {
  const named = dom.getAttribute('data-lang') ?? /(?:^|\s)language-([\w+#.-]+)/.exec(dom.querySelector('code')?.className ?? '')?.[1] ?? ''
  return /^[\w+#.-]{0,20}$/.test(named) ? named : ''
}

/**
 * 输入框能写的格式：段落、标题、引用、代码块、分隔线、有序和无序列表（可以嵌套），
 * 行内的粗体、斜体、删除线、行内代码和链接。存草稿和发出去都是 Markdown（见 convert.ts）。
 * 粘贴网页内容时按下面的 parseDOM 认格式，认不出的标签只留文字。
 */
export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
    heading: {
      attrs: { level: { default: 1 } },
      content: 'inline*',
      group: 'block',
      defining: true,
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
      toDOM: (node) => [`h${String(node.attrs.level)}`, 0],
    },
    blockquote: { content: 'block+', group: 'block', defining: true, parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
    code_block: {
      attrs: { lang: { default: '' } },
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      defining: true,
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full', getAttrs: (dom) => ({ lang: langOf(dom) }) }],
      toDOM: (node) => ['pre', node.attrs.lang === '' ? {} : { 'data-lang': String(node.attrs.lang) }, ['code', 0]],
    },
    horizontal_rule: { group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
    bullet_list: { content: 'list_item+', group: 'block', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
    ordered_list: {
      attrs: { order: { default: 1 } },
      content: 'list_item+',
      group: 'block',
      parseDOM: [{ tag: 'ol', getAttrs: (dom) => ({ order: Number.parseInt(dom.getAttribute('start') ?? '1', 10) || 1 }) }],
      toDOM: (node) => (node.attrs.order === 1 ? ['ol', 0] : ['ol', { start: String(node.attrs.order) }, 0]),
    },
    list_item: { content: 'paragraph block*', defining: true, parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline', selectable: false, linebreakReplacement: true, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
  },
  // 顺序就是嵌套顺序：链接在最外面，行内代码在最里面。
  marks: {
    link: {
      attrs: { href: {} },
      inclusive: false,
      parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => ({ href: dom.getAttribute('href') ?? '' }) }],
      toDOM: (mark) => ['a', { href: String(mark.attrs.href), rel: 'noopener noreferrer nofollow' }, 0],
    },
    strong: {
      parseDOM: [
        { tag: 'strong' },
        // Google 文档整段包在 <b style="font-weight:normal"> 里，不算粗体。
        { tag: 'b', getAttrs: (dom) => dom.style.fontWeight !== 'normal' && null },
        { style: 'font-weight=400', clearMark: (mark) => mark.type.name === 'strong' },
        { style: 'font-weight', getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null },
      ],
      toDOM: () => ['strong', 0],
    },
    em: {
      parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }, { style: 'font-style=normal', clearMark: (mark) => mark.type.name === 'em' }],
      toDOM: () => ['em', 0],
    },
    strike: {
      parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration', getAttrs: (value) => value.includes('line-through') && null }],
      toDOM: () => ['s', 0],
    },
    code: { code: true, excludes: '_', parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
  },
})
