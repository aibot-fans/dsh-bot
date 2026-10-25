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

export function parseInfo(data: Json): DeviceInfo {
  const daily = isJson(data.dailyFree) ? data.dailyFree : undefined
  const monitor = isJson(data.monitor) ? data.monitor : undefined
  const account = isJson(data.account) ? data.account : {}
  const bind = isJson(data.bind) ? data.bind : {}
  const kind = text(account.kind)
  return {
    dailyFree:
      daily === undefined
        ? null
        : { limit: count(daily.limit), used: count(daily.used), remaining: count(daily.remaining), resetAt: toTime(daily.resetAt), pausedReason: text(daily.pausedReason) || null },
    monitor: monitor === undefined ? null : { accountLimit: count(monitor.accountLimit), activeSubscriptionCount: count(monitor.activeSubscriptionCount), pausedBySystem: monitor.pausedBySystem === true },
    accountKind: kind === 'device' || kind === 'account' ? kind : null,
    accountDisplay: text(account.display) || null,
    bindAvailable: bind.available === true,
  }
}
