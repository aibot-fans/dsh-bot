import type { RoomMessage } from 'pod-domain'
import type { Mentions } from '../../components/mentions.tsx'

function callsOf(message: RoomMessage): readonly string[] | undefined {
  const raw = message.data.calls
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : undefined
}

/**
 * 画正文里的 @ 时要知道哪些真的通知了：bot 的话只有 mention_member 点到的才算；
 * 你的话按发出时记下的 calls 算，没有记录的旧消息照旧画。
 */
export function calledMentions(message: RoomMessage, mentions: Mentions, owner: boolean): Mentions {
  const calls = callsOf(message)
  if (owner && calls === undefined) return mentions
  return { ...mentions, called: new Set(calls ?? []) }
}
