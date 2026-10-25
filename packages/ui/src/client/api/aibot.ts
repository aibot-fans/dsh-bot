import type { AibotBind, AibotBindResult, AibotStatus } from 'pod-domain'
import { apiGet, apiPost } from './http.ts'

/** aibot 接入的接口：状态（refresh 时读一次最新额度）、重试、绑定账号。 */
export const aibotApi = {
  status: (refresh = false) => apiGet<AibotStatus>('/aibot/status', refresh ? { refresh: 1 } : {}),
  retry: () => apiPost<AibotStatus>('/aibot/retry'),
  bindStart: () => apiPost<AibotBind>('/aibot/bind/start'),
  bindPoll: (id: string) => apiGet<AibotBindResult>('/aibot/bind/poll', { id }),
}
