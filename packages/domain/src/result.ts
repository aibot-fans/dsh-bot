/** 宿主服务、HTTP 路由和页面共用的结果值。 */

export type PodErrorCode =
  | 'invalid-input'
  | 'not-found'
  | 'lead-protected'
  | 'conflict'
  | 'forbidden'
  | 'read-only'
  | 'session-unavailable'
  | 'internal'

export interface PodError {
  readonly code: PodErrorCode
  readonly message: string
}

export type PodResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PodError }

export function ok<T>(value: T): PodResult<T> {
  return { ok: true, value }
}

export function fail(code: PodErrorCode, message: string): PodResult<never> {
  return { ok: false, error: { code, message } }
}

/** 结果失败时取出说明文字，给工具结果和日志用。 */
export function errorMessage(result: PodResult<unknown>): string | undefined {
  return result.ok ? undefined : result.error.message
}
