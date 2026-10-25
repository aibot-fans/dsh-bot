import type { StoredMessage } from 'pod-store'
import type { MessageSource, UserMessage } from '../dsh.ts'

/**
 * Pod 投进会话的几种消息，来源决定 dsh 会话视图怎么显示它们：
 * - owner：你本人说的话，显示成普通的用户消息；
 * - relay：另一个 bot 发来的（开工说明、交付、咨询），显示成“来自某会话的消息”；
 * - notice：Pod 自己的一行说明（提醒、事件、回执），折叠显示摘要。
 */

export function ownerSource(): MessageSource {
  return { kind: 'user' }
}

export function relaySource(senderSessionId: string): MessageSource {
  return { kind: 'agent-message', form: 'relay', senderSessionId }
}

export function noticeSource(summary: string): MessageSource {
  const line = summary.replace(/\s+/g, ' ').trim()
  return { kind: 'pod', form: 'notice', summary: line.length > 110 ? `${line.slice(0, 109)}…` : line }
}

export function storedMessage(text: string, source: MessageSource): StoredMessage {
  return { id: globalThis.crypto.randomUUID(), text, source: source as StoredMessage['source'] }
}

/** 落库的消息还原成 dsh 要的冻结 UserMessage；id 不变，这样观察会话事件时能认出是 Pod 投的。 */
export function toUserMessage(message: StoredMessage): UserMessage {
  return Object.freeze({
    id: message.id,
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text: message.text })]),
    source: Object.freeze({ ...message.source }),
  }) as UserMessage
}

/** 从 dsh 的消息内容里取出纯文字。 */
export function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { readonly type: 'text'; readonly text: string } => {
      return typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text' && typeof (block as { text?: unknown }).text === 'string'
    })
    .map((block) => block.text)
    .join('')
}
