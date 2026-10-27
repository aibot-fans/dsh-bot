import { fail, t, type PodResult } from 'pod-domain'
import type { FetchRoute, Logger } from '../dsh.ts'
import { readBody, readQuery, respond } from './http.ts'

/** 页面用的接口都在 /api/pod 下；挂在 dsh 的 /api 通道上，自带 dsh 的登录和来源校验。 */
export const POD_API_PREFIX = '/api/pod'

export type Handler = (input: unknown, request: Request) => PodResult<unknown> | Promise<PodResult<unknown>>

/** 只读模式下拒绝写操作；读操作照常。 */
export interface WriteGate {
  readonly readOnly: () => string | undefined
}

export interface RouteSpec {
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly handler: Handler
  /** 写操作在只读模式下被拒绝；默认 POST 都算写。 */
  readonly writes?: boolean
}

export function get(path: string, handler: Handler): RouteSpec {
  return { method: 'GET', path, handler, writes: false }
}

export function post(path: string, handler: Handler, options: { readonly writes?: boolean } = {}): RouteSpec {
  return { method: 'POST', path, handler, writes: options.writes ?? true }
}

async function settle(logger: Logger, path: string, work: () => ReturnType<Handler>): Promise<Response> {
  try {
    return respond(await work())
  } catch (error) {
    logger.warn(`dsh-bot 接口 ${path} 出错`, error)
    const reason = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim()
    return respond(fail('internal', reason === '' ? t('出错了，详情见 dsh 日志') : t('出错了：{reason}', { reason: reason.slice(0, 160) })))
  }
}

async function dispatch(spec: RouteSpec, request: Request, logger: Logger, gate: WriteGate): Promise<Response> {
  const path = `${POD_API_PREFIX}${spec.path}`
  if (spec.writes === true) {
    const reason = gate.readOnly()
    if (reason !== undefined) return respond(fail('read-only', reason))
  }
  if (spec.method === 'GET') return settle(logger, path, () => spec.handler(readQuery(request), request))
  const body = await readBody(request)
  return body.ok ? settle(logger, path, () => spec.handler(body.value, request)) : respond(body)
}

/**
 * 把路由声明变成 dsh connection 认识的精确路由。dsh 按路径登记精确路由，
 * 同一路径的 GET 和 POST 必须合成一条，在里面按方法分派。
 */
export function toFetchRoutes(specs: readonly RouteSpec[], logger: Logger, gate: WriteGate): readonly FetchRoute[] {
  const byPath = new Map<string, RouteSpec[]>()
  for (const spec of specs) byPath.set(spec.path, [...(byPath.get(spec.path) ?? []), spec])
  return [...byPath.entries()].map(([path, group]) => ({
    path: `${POD_API_PREFIX}${path}`,
    methods: [...new Set(group.map((spec) => spec.method))],
    requestBody: 'buffered' as const,
    fetch: async (request: Request) => {
      const spec = group.find((item) => item.method === request.method) ?? group[0]
      if (spec === undefined) return respond(fail('not-found', t('没有这个接口')))
      return dispatch(spec, request, logger, gate)
    },
  }))
}
