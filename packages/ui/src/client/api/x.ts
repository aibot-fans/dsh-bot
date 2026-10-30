import type { XAccountStatus } from 'pod-domain'
import { apiGet, apiPost } from './http.ts'

/** X 账号：dsh-bot 浏览器里登录的是谁（x_ 工具用它读写 X），点“检查”重新看一遍。 */
export const xApi = {
  status: () => apiGet<XAccountStatus>('/x/status'),
  check: () => apiPost<XAccountStatus>('/x/check'),
}
