import { esc, link, safeHref } from './html.ts'

/**
 * 正文用的简单 Markdown：段落、换行、# 小标题、- 列表、1. 列表、> 引用，
 * 行内的 **粗体**、*斜体*、~~删除线~~、`代码`、[文字](链接)。先转义再加标记，不会混进别的 HTML。
 */

function emphasis(escaped: string): string {
  return escaped
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '<s>$1</s>')
    .replace(/(^|[^*\w])\*(?=\S)([^*]+?)(?<=\S)\*(?!\*)/g, '$1<em>$2</em>')
}

/** 链接先单独拿出来（地址要原样检查），其余文字转义后再加粗体斜体。 */
function linksAndText(raw: string): string {
  const pattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/g
  let output = ''
  let last = 0
  for (const match of raw.matchAll(pattern)) {
    const index = match.index ?? 0
    output += emphasis(esc(raw.slice(last, index)))
    const href = safeHref(match[2] ?? '')
    output += href === undefined ? emphasis(esc(match[1] ?? '')) : link(href, emphasis(esc(match[1] ?? '')))
    last = index + match[0].length
  }
  return output + emphasis(esc(raw.slice(last)))
}

export function inline(raw: string): string {
  return raw
    .split(/(`[^`\n]+`)/)
    .map((part) => (part.length > 2 && part.startsWith('`') && part.endsWith('`') ? `<code>${esc(part.slice(1, -1))}</code>` : linksAndText(part)))
    .join('')
}

type Chunk = { readonly kind: 'p' | 'quote'; readonly lines: string[] } | { readonly kind: 'ul' | 'ol'; readonly lines: string[] } | { readonly kind: 'h'; readonly level: number; readonly text: string }

export function markdown(source: string): string {
  const chunks: Chunk[] = []
  const push = (kind: 'p' | 'quote' | 'ul' | 'ol', line: string): void => {
    const last = chunks[chunks.length - 1]
    if (last !== undefined && last.kind === kind) last.lines.push(line)
    else chunks.push({ kind, lines: [line] })
  }
  let blank = true
  for (const rawLine of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trimEnd()
    const heading = /^(#{1,4})\s+(.+)$/.exec(line.trim())
    const bullet = /^\s*[-*•]\s+(.+)$/.exec(line)
    const numbered = /^\s*\d+[.)、]\s*(.+)$/.exec(line)
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (line.trim() === '') {
      blank = true
      continue
    }
    if (heading !== null) chunks.push({ kind: 'h', level: heading[1]?.length ?? 2, text: heading[2] ?? '' })
    else if (bullet !== null) push('ul', bullet[1] ?? '')
    else if (numbered !== null) push('ol', numbered[1] ?? '')
    else if (quote !== null) push('quote', quote[1] ?? '')
    else if (!blank && chunks[chunks.length - 1]?.kind === 'p') (chunks[chunks.length - 1] as { lines: string[] }).lines.push(line.trim())
    else chunks.push({ kind: 'p', lines: [line.trim()] })
    blank = false
  }
  return chunks
    .map((chunk) => {
      switch (chunk.kind) {
        case 'h': {
          const level = Math.min(5, chunk.level + 2)
          return `<h${level}>${inline(chunk.text)}</h${level}>`
        }
        case 'ul':
        case 'ol':
          return `<${chunk.kind}>${chunk.lines.map((line) => `<li>${inline(line)}</li>`).join('')}</${chunk.kind}>`
        case 'quote':
          return `<blockquote>${chunk.lines.map(inline).join('<br>')}</blockquote>`
        case 'p':
          return `<p>${chunk.lines.map(inline).join('<br>')}</p>`
      }
    })
    .join('')
}
