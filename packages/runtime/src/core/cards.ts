/**
 * 送进会话的卡片（消息批、开工说明、直通的消息、汇报）的字数上限。
 * 只管送进会话的东西：截掉的地方留 id，用 read 读回全文；bot 发给你的话不截断。
 */
export const CARD_LIMITS = {
  /** 消息批、直通的消息、跟进话题里的新消息，每条。 */
  message: 600,
  /** 开工说明整张。 */
  kickoff: 1500,
  /** 送给组长或前台的一条汇报。 */
  report: 600,
} as const

/** 截断处留的指针。 */
export function readPointer(id: string): string {
  return `（全文：read ${id}）`
}

/** 超长截断，截断处留 id；没有 id 的只标出后面截掉了。 */
export function clipCard(text: string, limit: number, id: string | null): string {
  const flat = text.trim()
  if (flat.length <= limit) return flat
  return `${flat.slice(0, Math.max(0, limit))}……${id === null ? '（后面截掉了）' : readPointer(id)}`
}
