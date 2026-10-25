/** id 工具。Node 24 和浏览器都有 crypto.randomUUID。 */

function randomHex(length: number): string {
  return globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, length)
}

/** 各类记录的 id 前缀；看到 id 就知道是什么。 */
export type IdPrefix =
  | 'bot'
  | 'ver'
  | 'room'
  | 'msg'
  | 'task'
  | 'wait'
  | 'team'
  | 'mem'
  | 'routine'
  | 'notif'
  | 'skill'
  | 'evo'
  | 'att'
  | 'tab'
  | 'dlv'
  | 'shot'
  | 'page'

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomHex(12)}`
}

/** Pod 的会话 id 以 pod- 开头，在 dsh 自己的会话列表里也认得出来。 */
export const POD_SESSION_PREFIX = 'pod-'

export function newSessionId(): string {
  return `${POD_SESSION_PREFIX}${globalThis.crypto.randomUUID()}`
}

export function isPodSessionId(id: string): boolean {
  return id.startsWith(POD_SESSION_PREFIX)
}

/** 主管用固定 id，重装后还能找回同一行。 */
export const LEAD_BOT_ID = 'bot_lead'
