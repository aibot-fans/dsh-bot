import { fail, type PodErrorCode, type PodResult } from 'pod-domain'

const STATUS: Readonly<Record<PodErrorCode, number>> = {
  'invalid-input': 400,
  'not-found': 404,
  'lead-protected': 409,
  conflict: 409,
  forbidden: 403,
  'read-only': 423,
  'session-unavailable': 502,
  internal: 500,
}

/** 把结果写成 JSON 响应；出错时也带同样的 { ok, error } 结构，页面只看一种格式。 */
export function respond(result: PodResult<unknown>): Response {
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : STATUS[result.error.code],
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export async function readBody(request: Request): Promise<PodResult<unknown>> {
  try {
    const text = await request.text()
    return { ok: true, value: text === '' ? {} : (JSON.parse(text) as unknown) }
  } catch {
    return fail('invalid-input', '请求体不是合法的 JSON')
  }
}

/** GET 请求的查询参数，转成普通对象交给服务层，和 POST 的请求体同一种读法。 */
export function readQuery(request: Request): Readonly<Record<string, string>> {
  const url = new URL(request.url)
  return Object.fromEntries(url.searchParams.entries())
}
