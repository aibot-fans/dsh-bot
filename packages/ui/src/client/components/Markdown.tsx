import { Fragment, type ReactNode } from 'react'
import { parseBlocks, type Block } from '../markdown/blocks.ts'
import { parseInline, type Inline } from '../markdown/inline.ts'
import { withMentions, type Mentions } from './mentions.tsx'

/**
 * 小型 Markdown 渲染：标题、段落、列表（可以嵌套）、引用、代码块、表格、分隔线，行内的代码、粗体、斜体、删除线和链接，
 * 以及 @bot 名字（带图标、可以点）。直接生成 React 元素，不用 innerHTML，bot 输出里的 HTML 一律按文字显示。
 * 解析规则在 markdown/ 下，和输入框共用。
 */

function safeHref(url: string): string | undefined {
  return /^(https?:|mailto:)/i.test(url) ? url : undefined
}

function renderInline(tokens: readonly Inline[], key: string, mentions: Mentions | undefined): ReactNode {
  return tokens.map((token, index) => {
    const id = `${key}-${index}`
    switch (token.kind) {
      case 'text':
        return <Fragment key={id}>{withMentions(token.text, id, mentions)}</Fragment>
      case 'code':
        return (
          <code key={id} className="pod-md-code">
            {token.text}
          </code>
        )
      case 'strong':
        return <strong key={id}>{renderInline(token.children, id, mentions)}</strong>
      case 'em':
        return <em key={id}>{renderInline(token.children, id, mentions)}</em>
      case 'strike':
        return <s key={id}>{renderInline(token.children, id, mentions)}</s>
      case 'link': {
        const href = safeHref(token.href)
        const label = renderInline(token.children, id, mentions)
        return href === undefined ? (
          <span key={id}>{label}</span>
        ) : (
          <a key={id} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        )
      }
      case 'url':
        return (
          <a key={id} href={token.href} target="_blank" rel="noopener noreferrer">
            {token.href}
          </a>
        )
    }
  })
}

function inline(text: string, key: string, mentions: Mentions | undefined): ReactNode {
  return renderInline(parseInline(text), key, mentions)
}

function lines(texts: readonly string[], key: string, mentions: Mentions | undefined): ReactNode {
  return texts.map((text, index) => (
    <Fragment key={`${key}-${index}`}>
      {index > 0 ? <br /> : null}
      {inline(text, `${key}-${index}`, mentions)}
    </Fragment>
  ))
}

/** 列表的一项：开头那段直接排在圆点后面（不套段落），后面的嵌套列表、代码块照常排。 */
function renderItem(blocks: readonly Block[], key: string, mentions: Mentions | undefined): ReactNode {
  const [head, ...rest] = blocks
  const lead = head?.kind === 'paragraph' ? lines(head.lines, `${key}-p`, mentions) : null
  const body = head?.kind === 'paragraph' ? rest : blocks
  return (
    <li key={key}>
      {lead}
      {body.map((block, index) => renderBlock(block, `${key}-${index}`, mentions))}
    </li>
  )
}

function renderBlock(block: Block, key: string, mentions: Mentions | undefined): ReactNode {
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
          {block.blocks.map((child, index) => renderBlock(child, `${key}-${index}`, mentions))}
        </blockquote>
      )
    case 'list': {
      const items = block.items.map((item, index) => renderItem(item, `${key}-${index}`, mentions))
      return block.ordered ? (
        <ol key={key} className="pod-md-list" start={block.start === 1 ? undefined : block.start}>
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
  return <div className={`pod-md ${props.className ?? ''}`}>{parseBlocks(props.text).map((block, index) => renderBlock(block, `b${index}`, props.mentions))}</div>
}
