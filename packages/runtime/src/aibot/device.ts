import type { AibotDailyFree, AibotMonitor } from 'pod-domain'
import { count, isJson, text, toTime, type Json } from './client.ts'

/** GET /pod/device 里 Pod 用得到的部分：额度、监控、账号、能不能绑定。 */
export interface DeviceInfo {
  readonly dailyFree: AibotDailyFree | null
  readonly monitor: AibotMonitor | null
  readonly accountKind: 'device' | 'account' | null
  readonly accountDisplay: string | null
  readonly bindAvailable: boolean
}

/** 每天的免费额度；没给就是 null。 */
export function parseDaily(value: unknown): AibotDailyFree | null {
  if (!isJson(value)) return null
  return { limit: count(value.limit), used: count(value.used), remaining: count(value.remaining), resetAt: toTime(value.resetAt), pausedReason: text(value.pausedReason) || null }
}

export function parseInfo(data: Json): DeviceInfo {
  const monitor = isJson(data.monitor) ? data.monitor : undefined
  const account = isJson(data.account) ? data.account : {}
  const bind = isJson(data.bind) ? data.bind : {}
  const kind = text(account.kind)
  return {
    dailyFree: parseDaily(data.dailyFree),
    monitor: monitor === undefined ? null : { accountLimit: count(monitor.accountLimit), activeSubscriptionCount: count(monitor.activeSubscriptionCount), pausedBySystem: monitor.pausedBySystem === true },
    accountKind: kind === 'device' || kind === 'account' ? kind : null,
    accountDisplay: text(account.display) || null,
    bindAvailable: bind.available === true,
  }
}
