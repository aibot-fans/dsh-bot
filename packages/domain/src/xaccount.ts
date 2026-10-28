/** dsh-bot 浏览器里登录的 X 账号：x_ 工具（发推、删推、点赞、转推、关注）用它。 */

import { siteModeFor, type SiteMode, type SiteRule } from './policy.ts'

/**
 * 账号现在的情况：
 * - unchecked：还没检查过；
 * - signed-out：浏览器里没登录 X；
 * - ready：登录着，handle 是用户名；
 * - locked：X 锁了或停用了这个账号；
 * - error：检查时出了别的问题，message 是原因。
 */
export type XAccountState = 'unchecked' | 'signed-out' | 'ready' | 'locked' | 'error'

export interface XAccountStatus {
  readonly state: XAccountState
  /** X 的数字用户 id（公开信息）。 */
  readonly id: string
  readonly handle: string
  readonly name: string
  readonly checkedAt: number | null
  readonly message: string
}

export const UNCHECKED_X_ACCOUNT: XAccountStatus = { state: 'unchecked', id: '', handle: '', name: '', checkedAt: null, message: '' }

/** X 写操作按 x.com 的站点规则走：没有规则时写操作需审批。 */
export const X_SITE = 'x.com'

export function xWriteMode(rules: readonly SiteRule[]): SiteMode {
  return siteModeFor(X_SITE, rules).mode
}

/** 改 x.com 的写操作方式：改正在管 x.com 的那条规则，没有就加一条。 */
export function withXWriteMode(rules: readonly SiteRule[], mode: SiteMode): readonly SiteRule[] {
  const { rule } = siteModeFor(X_SITE, rules)
  if (rule === undefined) return [...rules, { pattern: X_SITE, mode, note: 'X' }]
  return rules.map((item) => (item === rule ? { ...item, mode } : item))
}
