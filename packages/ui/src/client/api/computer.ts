import type { ComputerStatus } from 'pod-domain'
import { apiGet, apiPost, mediaUrl } from './http.ts'

/** 用电脑：小助手和系统权限；电脑面板的接管、交还和画面。 */
export const computerApi = {
  status: () => apiGet<ComputerStatus>('/computer/status'),
  check: () => apiPost<ComputerStatus>('/computer/check'),
  permissions: () => apiPost<ComputerStatus>('/computer/permissions'),
  takeover: () => apiPost<ComputerStatus>('/computer/takeover'),
  handback: (note: string) => apiPost<ComputerStatus>('/computer/handback', { note }),
  /** 画面：二进制流，key 只是让每次连接的地址不一样。 */
  streamUrl: (key: string) => mediaUrl('/computer/stream', { key }),
}
