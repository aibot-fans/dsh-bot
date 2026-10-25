import { Fragment, type ReactNode } from 'react'
import { withMentions, type Mentions } from './mentions.tsx'

/**
 * 小型 Markdown 渲染：标题、段落、列表、引用、代码块、表格、分隔线，行内的代码、粗体、斜体和链接，
 * 以及 @bot 名字（带图标、可以点）。直接生成 React 元素，不用 innerHTML，bot 输出里的 HTML 一律按文字显示。
 */

type Block =
  | { readonly kind: 'code'; readonly lang: string; readonly text: string }
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'quote'; readonly lines: readonly string[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: 'table'; readonly head: readonly string[]; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: 'rule' }
  | { readonly kind: 'paragraph'; readonly lines: readonly string[] }

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/

function splitRow(line: string): readonly string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function isTableSeparator(line: string | undefined): boolean {
  return line !== undefined && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)
}

function parseBlocks(source: string): readonly Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const fence = /^\s*```(\S*)\s*$/.exec(line)
    if (fence !== null) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      blocks.push({ kind: 'code', lang: fence[1] ?? '', text: body.join('\n') })
      continue
    }
    if (line.trim() === '') {
      index += 1
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, text: heading[2] ?? '' })
      index += 1
      continue
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: 'rule' })
      index += 1
      continue
    }
    if (line.includes('|') && isTableSeparator(lines[index + 1])) {
      const head = splitRow(line)
      const rows: (readonly string[])[] = []
      index += 2
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim() !== '') {
        rows.push(splitRow(lines[index] ?? ''))
        index += 1
      }
      blocks.push({ kind: 'table', head, rows })
      continue
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = []
      while (index < lines.length && /^\s*>/.test(lines[index] ?? '')) {
        quoted.push((lines[index] ?? '').replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push({ kind: 'quote', lines: quoted })
      continue
    }
    const item = LIST_ITEM.exec(line)
    if (item !== null) {
      const ordered = /\d/.test(item[1] ?? '')
      const items: string[] = []
      while (index < lines.length) {
        const current = LIST_ITEM.exec(lines[index] ?? '')
        if (current !== null) {
          items.push(current[2] ?? '')
        } else if ((lines[index] ?? '').trim() !== '' && /^\s{2,}/.test(lines[index] ?? '') && items.length > 0) {
          items[items.length - 1] = `${items[items.length - 1] ?? ''}\n${(lines[index] ?? '').trim()}`
        } else break
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length && (lines[index] ?? '').trim() !== '' && !/^\s*```/.test(lines[index] ?? '') && !/^#{1,6}\s/.test(lines[index] ?? '')) {
      if (paragraph.length > 0 && (LIST_ITEM.test(lines[index] ?? '') || /^\s*>/.test(lines[index] ?? ''))) break
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push({ kind: 'paragraph', lines: paragraph })
  }
  return blocks
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()（）]+)|(\*[^*\s][^*]*\*)/g

function safeHref(url: string): string | undefined {
  return /^(https?:|mailto:)/i.test(url) ? url : undefined
}

function inline(text: string, key: string, mentions: Mentions | undefined): ReactNode {
  const parts: ReactNode[] = []
  let last = 0
  let count = 0
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0
    if (start > last) parts.push(withMentions(text.slice(last, start), `${key}-t${count}`, mentions))
    const token = match[0]
    const id = `${key}-${count}`
    count += 1
    if (match[1] !== undefined) parts.push(<code key={id} className="pod-md-code">{token.slice(1, -1)}</code>)
    else if (match[2] !== undefined) parts.push(<strong key={id}>{inline(token.slice(2, -2), id, mentions)}</strong>)
    else if (match[3] !== undefined) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
      const href = safeHref(link?.[2] ?? '')
      parts.push(
        href === undefined ? (
          <span key={id}>{link?.[1] ?? token}</span>
        ) : (
          <a key={id} href={href} target="_blank" rel="noopener noreferrer">
            {link?.[1] ?? href}
          </a>
        ),
      )
    } else if (match[4] !== undefined) {
      parts.push(
        <a key={id} href={token} target="_blank" rel="noopener noreferrer">
          {token}
        </a>,
      )
    } else if (match[5] !== undefined) parts.push(<em key={id}>{token.slice(1, -1)}</em>)
    last = start + token.length
  }
  if (last < text.length) parts.push(withMentions(text.slice(last), `${key}-t${count}`, mentions))
  return parts
}

function lines(texts: readonly string[], key: string, mentions: Mentions | undefined): ReactNode {
  return texts.map((text, index) => (
    <Fragment key={`${key}-${index}`}>
      {index > 0 ? <br /> : null}
      {inline(text, `${key}-${index}`, mentions)}
    </Fragment>
  ))
}

function renderBlock(block: Block, index: number, mentions: Mentions | undefined): ReactNode {
  const key = `b${index}`
  switch (block.kind) {
    case 'code':
      return (
        <pre key={key} className="pod-md-pre" data-lang={block.lang || undefined}>
          <code>{block.text}</code>
        </pre>
      )
    case 'heading': {
      const level = Math.min(block.level + 2, 6)
      const Tag = `h${level}` as 'h3'
      return (
        <Tag key={key} className="pod-md-heading">
          {inline(block.text, key, mentions)}
        </Tag>
      )
    }
    case 'quote':
      return (
        <blockquote key={key} className="pod-md-quote">
          {lines(block.lines, key, mentions)}
        </blockquote>
      )
    case 'list': {
      const items = block.items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{lines(item.split('\n'), `${key}-${itemIndex}`, mentions)}</li>)
      return block.ordered ? (
        <ol key={key} className="pod-md-list">
          {items}
        </ol>
      ) : (
        <ul key={key} className="pod-md-list">
          {items}
        </ul>
      )
    }
    case 'table':
      return (
        <div key={key} className="pod-md-table-wrap">
          <table className="pod-md-table">
            <thead>
              <tr>
                {block.head.map((cell, cellIndex) => (
                  <th key={cellIndex}>{inline(cell, `${key}-h${cellIndex}`, mentions)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{inline(cell, `${key}-${rowIndex}-${cellIndex}`, mentions)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'rule':
      return <hr key={key} className="pod-md-rule" />
    case 'paragraph':
      return (
        <p key={key} className="pod-md-p">
          {lines(block.lines, key, mentions)}
        </p>
      )
  }
}

export function Markdown(props: { readonly text: string; readonly className?: string; readonly mentions?: Mentions }) {
  return <div className={`pod-md ${props.className ?? ''}`}>{parseBlocks(props.text).map((block, index) => renderBlock(block, index, props.mentions))}</div>
}
