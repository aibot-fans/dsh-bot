import { t } from 'pod-domain'
import { count, isJson, text, unreachable, type Json } from './client.ts'
import { AibotError, AibotNetworkError } from './errors.ts'

const PROTOCOL_VERSION = '2025-06-18'
const INIT_TIMEOUT_MS = 20_000
const CALL_TIMEOUT_MS = 60_000

export interface McpTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Json
  /** annotations.readOnlyHint：只查不改，可以和别的工具同时调。 */
  readonly readOnly: boolean
  /** annotations.destructiveHint：会删除或修改设置（删监控、改监控）。MCP 规定不是只读的工具没写时按 true 算。 */
  readonly destructive: boolean
}

export interface McpCallResult {
  readonly content: readonly Json[]
  readonly structured: unknown
  readonly isError: boolean
}

/** JSON-RPC 的错误码对应的 HTTP 状态，好和 REST 的错误一起处理。 */
const RPC_STATUS: Readonly<Record<number, readonly [number, string]>> = {
  [-32602]: [400, 'validation_error'],
  [-32001]: [401, 'invalid_api_key'],
  [-32002]: [402, 'quota_exceeded'],
  [-32003]: [403, 'forbidden'],
  [-32029]: [429, 'rate_limit_exceeded'],
  [-32050]: [502, 'upstream_failed'],
}

function rpcError(error: Json): AibotError {
  const data = isJson(error.data) ? error.data : {}
  const [status, fallback] = RPC_STATUS[count(error.code)] ?? [500, 'mcp_error']
  return new AibotError({
    status,
    code: text(data.code) || fallback,
    message: text(error.message) || t('aibot 出错了'),
    details: isJson(data.details) ? data.details : data,
    retryAfterSeconds: typeof data.retryAfterSeconds === 'number' ? data.retryAfterSeconds : null,
  })
}

/** 会话过期（服务端重启过）：重新 initialize 一次再发。 */
class SessionExpired extends Error {}

/** 响应可能是 JSON，也可能是只带这一条回复的 SSE；找出 id 对得上的那条。 */
function pickReply(body: string, contentType: string, id: number): Json | undefined {
  if (!contentType.includes('text/event-stream')) {
    try {
      const value: unknown = JSON.parse(body)
      return isJson(value) ? value : undefined
    } catch {
      return undefined
    }
  }
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (data === '') continue
    try {
      const value: unknown = JSON.parse(data)
      if (isJson(value) && value.id === id) return value
    } catch {
      // 不是 JSON 的事件跳过。
    }
  }
  return undefined
}

/**
 * aibot 的 MCP 端点（Streamable HTTP，只用 POST）：initialize → tools/list → tools/call。
 * 每个请求带 Key 和 mcp-client-name: deepseek-pod；服务端给了 Mcp-Session-Id 就带上，过期了自动重连一次。
 */
export class McpClient {
  private readonly endpoint: URL
  private readonly key: () => string
  private readonly version: string
  private sessionId: string | undefined
  private protocol = PROTOCOL_VERSION
  private ready: Promise<void> | undefined
  private nextId = 0

  constructor(spec: { readonly endpoint: URL; readonly key: () => string; readonly version: string }) {
    this.endpoint = spec.endpoint
    this.key = spec.key
    this.version = spec.version
  }

  /** Key 换了、绑定了账号：下次重新 initialize。 */
  reset(): void {
    this.sessionId = undefined
    this.ready = undefined
  }

  private async post(message: Json, timeoutMs: number): Promise<Json | undefined> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.key()}`,
      'mcp-client-name': 'deepseek-pod',
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    }
    if (message.method !== 'initialize') headers['mcp-protocol-version'] = this.protocol
    if (this.sessionId !== undefined) headers['mcp-session-id'] = this.sessionId
    let response: Response
    try {
      response = await fetch(this.endpoint, { method: 'POST', headers, body: JSON.stringify(message), signal: AbortSignal.timeout(timeoutMs) })
    } catch (error) {
      throw unreachable(error, timeoutMs)
    }
    const session = response.headers.get('mcp-session-id')
    if (session !== null && session !== '') this.sessionId = session
    const body = await response.text().catch(() => '')
    if (response.status === 202 || message.id === undefined) return undefined
    const id = typeof message.id === 'number' ? message.id : -1
    const reply = pickReply(body, response.headers.get('content-type') ?? '', id)
    if (reply !== undefined && isJson(reply.error)) throw rpcError(reply.error)
    if (!response.ok) {
      if (response.status === 404 && this.sessionId !== undefined) throw new SessionExpired()
      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch {
        parsed = undefined
      }
      const error = isJson(parsed) && isJson(parsed.error) ? parsed.error : {}
      throw new AibotError({ status: response.status, code: text(error.code) || `http_${response.status}`, message: text(error.message) || t('aibot 返回 HTTP {status}', { status: response.status }) })
    }
    if (reply === undefined) throw new AibotNetworkError('aibot 的回复看不懂')
    return reply
  }

  private async initialize(): Promise<void> {
    this.sessionId = undefined
    this.nextId += 1
    const reply = await this.post({ jsonrpc: '2.0', id: this.nextId, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'deepseek-pod', version: this.version } } }, INIT_TIMEOUT_MS)
    const result = isJson(reply?.result) ? reply.result : {}
    this.protocol = text(result.protocolVersion) || PROTOCOL_VERSION
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, INIT_TIMEOUT_MS).catch(() => undefined)
  }

  private ensureReady(): Promise<void> {
    if (this.ready === undefined) {
      this.ready = this.initialize().catch((error: unknown) => {
        this.ready = undefined
        throw error
      })
    }
    return this.ready
  }

  private async send(method: string, params: Json, timeoutMs: number): Promise<Json> {
    this.nextId += 1
    const reply = await this.post({ jsonrpc: '2.0', id: this.nextId, method, params }, timeoutMs)
    return isJson(reply?.result) ? reply.result : {}
  }

  private async rpc(method: string, params: Json, timeoutMs = CALL_TIMEOUT_MS): Promise<Json> {
    await this.ensureReady()
    try {
      return await this.send(method, params, timeoutMs)
    } catch (error) {
      if (!(error instanceof SessionExpired)) throw error
      this.reset()
      await this.ensureReady()
      return this.send(method, params, timeoutMs)
    }
  }

  /** 这把 Key 能用的全部工具（分页拉完）。 */
  async listTools(): Promise<readonly McpTool[]> {
    const pages = async (cursor: string | undefined, found: readonly McpTool[]): Promise<readonly McpTool[]> => {
      const result = await this.rpc('tools/list', cursor === undefined ? {} : { cursor })
      const tools = (Array.isArray(result.tools) ? result.tools : []).filter(isJson).flatMap((tool): McpTool[] => {
        const name = text(tool.name)
        if (name === '') return []
        const annotations = isJson(tool.annotations) ? tool.annotations : {}
        const readOnly = annotations.readOnlyHint === true
        return [{ name, description: text(tool.description), inputSchema: isJson(tool.inputSchema) ? tool.inputSchema : { type: 'object', properties: {} }, readOnly, destructive: !readOnly && annotations.destructiveHint !== false }]
      })
      const next = text(result.nextCursor)
      const all = [...found, ...tools]
      return next === '' || all.length > 500 ? all : pages(next, all)
    }
    return pages(undefined, [])
  }

  async callTool(name: string, args: unknown): Promise<McpCallResult> {
    const result = await this.rpc('tools/call', { name, arguments: isJson(args) ? args : {} })
    return {
      content: (Array.isArray(result.content) ? result.content : []).filter(isJson),
      structured: result.structuredContent,
      isError: result.isError === true,
    }
  }
}
