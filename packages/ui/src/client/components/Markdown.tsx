import { Fragment, type ReactNode } from 'react'
import { parseBlocks, type Block } from '../markdown/blocks.ts'
import { parseInline, type Inline } from '../markdown/inline.ts'
import { withMentions, type Mentions } from './mentions.tsx'
import { withTaskLinks, type TaskLinks } from './taskLinks.tsx'

/**
 * 小型 Markdown 渲染：标题、段落、列表（可以嵌套）、引用、代码块、表格、分隔线，行内的代码、粗体、斜体、删除线和链接，
 * 以及 @bot 名字（带图标、可以点）和说到的任务标题（任务链接）。直接生成 React 元素，不用 innerHTML，bot 输出里的 HTML 一律按文字显示。
 * 解析规则在 markdown/ 下，和输入框共用。
 */

/** 行内文字里要换成可以点的东西：@bot 名字、说到的任务。 */
interface Extra {
  readonly mentions: Mentions | undefined
  readonly links: TaskLinks | undefined
}

function safeHref(url: string): string | undefined {
  return /^(https?:|mailto:)/i.test(url) ? url : undefined
}

function renderInline(tokens: readonly Inline[], key: string, extra: Extra): ReactNode {
  return tokens.map((token, index) => {
    const id = `${key}-${index}`
    switch (token.kind) {
      case 'text':
        return <Fragment key={id}>{withTaskLinks(token.text, id, extra.links, (text, at) => withMentions(text, at, extra.mentions))}</Fragment>
      case 'code':
        return (
          <code key={id} className="pod-md-code">
            {token.text}
          </code>
        )
      case 'strong':
        return <strong key={id}>{renderInline(token.children, id, extra)}</strong>
      case 'em':
        return <em key={id}>{renderInline(token.children, id, extra)}</em>
      case 'strike':
        return <s key={id}>{renderInline(token.children, id, extra)}</s>
      case 'link': {
        const href = safeHref(token.href)
        const label = renderInline(token.children, id, extra)
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

function inline(text: string, key: string, extra: Extra): ReactNode {
  return renderInline(parseInline(text), key, extra)
}

function lines(texts: readonly string[], key: string, extra: Extra): ReactNode {
  return texts.map((text, index) => (
    <Fragment key={`${key}-${index}`}>
      {index > 0 ? <br /> : null}
      {inline(text, `${key}-${index}`, extra)}
    </Fragment>
  ))
}

/** 列表的一项：开头那段直接排在圆点后面（不套段落），后面的嵌套列表、代码块照常排。 */
function renderItem(blocks: readonly Block[], key: string, extra: Extra): ReactNode {
  const [head, ...rest] = blocks
  const lead = head?.kind === 'paragraph' ? lines(head.lines, `${key}-p`, extra) : null
  const body = head?.kind === 'paragraph' ? rest : blocks
  return (
    <li key={key}>
      {lead}
      {body.map((block, index) => renderBlock(block, `${key}-${index}`, extra))}
    </li>
  )
}

function renderBlock(block: Block, key: string, extra: Extra): ReactNode {
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
          {inline(block.text, key, extra)}
        </Tag>
      )
    }
    case 'quote':
      return (
        <blockquote key={key} className="pod-md-quote">
          {block.blocks.map((child, index) => renderBlock(child, `${key}-${index}`, extra))}
        </blockquote>
      )
    case 'list': {
      const items = block.items.map((item, index) => renderItem(item, `${key}-${index}`, extra))
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
                  <th key={cellIndex}>{inline(cell, `${key}-h${cellIndex}`, extra)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{inline(cell, `${key}-${rowIndex}-${cellIndex}`, extra)}</td>
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
          {lines(block.lines, key, extra)}
        </p>
      )
  }
}

export function Markdown(props: { readonly text: string; readonly className?: string; readonly mentions?: Mentions; readonly links?: TaskLinks }) {
  const extra: Extra = { mentions: props.mentions, links: props.links }
  return <div className={`pod-md ${props.className ?? ''}`}>{parseBlocks(props.text).map((block, index) => renderBlock(block, `b${index}`, extra))}</div>
}
