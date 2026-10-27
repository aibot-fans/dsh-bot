import type { ReactNode } from 'react'
import { t } from 'pod-domain'
import type { IconBot } from './BotIcon.tsx'
import { Avatar } from './common.tsx'

/** 消息里能 @ 到的 bot：名字、画图标用的字段，点一下打开它的详情。 */
export interface MentionTarget {
  readonly name: string
  readonly bot: IconBot
  readonly onOpen: () => void
}

export interface Mentions {
  readonly pattern: RegExp | null
  readonly byName: ReadonlyMap<string, MentionTarget>
  /** 这条消息真的通知了谁（bot id）。给了的话，没通知到的 @名字 画成“只是提到”。 */
  readonly called?: ReadonlySet<string>
}

export const NO_MENTIONS: Mentions = { pattern: null, byName: new Map() }

/** 按名字认 @：长名字优先，免得“@数据工程师”被认成“@数据”。 */
export function buildMentions(targets: readonly MentionTarget[]): Mentions {
  const names = [...new Set(targets.map((target) => target.name))].filter((name) => name !== '').sort((left, right) => right.length - left.length)
  if (names.length === 0) return NO_MENTIONS
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return { pattern: new RegExp(`@(${escaped.join('|')})`, 'g'), byName: new Map(targets.map((target) => [target.name, target])) }
}

/** 一段纯文字里的 @名字 换成带图标、可以点的名字；没有 @ 时原样返回。 */
export function withMentions(text: string, key: string, mentions: Mentions | undefined): ReactNode {
  if (mentions === undefined || mentions.pattern === null || !text.includes('@')) return text
  const parts: ReactNode[] = []
  let last = 0
  let count = 0
  for (const match of text.matchAll(mentions.pattern)) {
    const start = match.index ?? 0
    const target = mentions.byName.get(match[1] ?? '')
    if (target === undefined) continue
    if (start > last) parts.push(text.slice(last, start))
    const plain = mentions.called !== undefined && !mentions.called.has(target.bot.id)
    parts.push(
      <button
        key={`${key}-m${count}`}
        type="button"
        className={plain ? 'pod-mention pod-mention-plain' : 'pod-mention'}
        onClick={target.onOpen}
        title={plain ? t('只是提到{name}，没有通知它', { name: target.name }) : t('打开{name}的详情', { name: target.name })}
      >
        <Avatar bot={target.bot} size={16} />@{target.name}
      </button>,
    )
    count += 1
    last = start + match[0].length
  }
  if (count === 0) return text
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
