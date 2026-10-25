import type { PodResult } from 'pod-domain'

/**
 * 调 Pod 的 /api/pod 接口。用相对地址：dsh web 的页面就在站点根目录，
 * 请求自动带上 dsh 的登录 Cookie，接口先过 dsh 自己的来源和登录校验。
 */
const BASE = 'api/pod'

export class PodApiError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PodApiError'
    this.code = code
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 401) throw new PodApiError('unauthorized', '登录已过期，请刷新 dsh 页面')
  let result: PodResult<T>
  try {
    result = (await response.json()) as PodResult<T>
  } catch {
    // 宿主不认识的地址回的是纯文字 404：多半是 Pod 刚更新过，这个标签页还是旧页面。
    if (response.status === 404) throw new PodApiError('not_found', '这个功能的接口找不到了：多半是 Pod 刚更新过，刷新页面再试')
    throw new PodApiError('internal', `接口返回了无法识别的内容（${response.status}）`)
  }
  if (!result.ok) throw new PodApiError(result.error.code, result.error.message)
  return result.value
}

export async function apiGet<T>(path: string, query: Readonly<Record<string, string | number | undefined>> = {}): Promise<T> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
  const search = params.toString()
  const response = await fetch(`${BASE}${path}${search === '' ? '' : `?${search}`}`, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  })
  return parse<T>(response)
}

export async function apiPost<T>(path: string, body: unknown = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  return parse<T>(response)
}

export function eventsUrl(): string {
  return `${BASE}/events`
}

/** 不是 JSON 的接口地址：实时画面、缩略图、截图。 */
export function mediaUrl(path: string, query: Readonly<Record<string, string>>): string {
  return `${BASE}${path}?${new URLSearchParams(query).toString()}`
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
