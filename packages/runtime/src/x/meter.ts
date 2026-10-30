import { XError } from 'aibot-x-post'

/** 一次访问 X 扣多少：哪个 x_ 工具、读还是写、带几个文件（读 1 次，写 4 次，每个文件另加 2 次）。 */
export interface XUsage {
  readonly tool: string
  readonly kind: 'read' | 'write'
  readonly files: number
}

/** 扣的结果：额度用完时 blocked 是给 bot 的话；扣上了有 receipt，退的时候用；没扣（aibot 没开、连不上）两样都没有。 */
export interface XCharge {
  readonly blocked?: string
  readonly receipt?: string
}

/**
 * 用登录的 X 账号读写 X 也从 aibot 每天的免费次数里扣：访问 X 前先扣，X 那边没做成再退。
 * aibot 没开、停用了或连不上时照常做、不扣。
 */
export interface XMeter {
  charge(usage: XUsage): Promise<XCharge>
  /** 不等结果，退不成就算了。 */
  refund(charge: XCharge, reason: string): void
  /** 今天的额度已经用完时给 bot 的话（只看记下的，不发请求）；没用完是 undefined。 */
  blocked(): string | undefined
}

/** 退回时记的原因：X 的错误种类，认不出来是 x_failed。 */
export function refundReason(error: unknown): string {
  return error instanceof XError ? `x_${error.code}` : 'x_failed'
}

/** 回了 errors 时看有没有别的：除了 errors 什么也没有（GraphQL 的 data 是空的），这次读什么也没拿到，算没做成。 */
export function nothingRead(response: unknown): boolean {
  if (response === null || typeof response !== 'object') return true
  return Object.entries(response).every(([key, value]) => key === 'errors' || value === null || value === undefined || (typeof value === 'object' && Object.keys(value).length === 0))
}
