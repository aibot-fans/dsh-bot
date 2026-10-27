import type { UpdateStatus } from 'pod-domain'
import { apiGet, apiPost } from './http.ts'

/** 新版本提醒和一键更新的接口。一键更新马上返回，进度看 status 里的 job。 */
export const updateApi = {
  status: () => apiGet<UpdateStatus>('/update'),
  check: () => apiPost<UpdateStatus>('/update/check'),
  apply: (version: string) => apiPost<UpdateStatus>('/update/apply', { version }),
  dismiss: () => apiPost<UpdateStatus>('/update/dismiss'),
}
