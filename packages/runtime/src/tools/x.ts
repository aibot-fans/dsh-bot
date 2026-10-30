import { buildRequest, credentialProblem, endpointLines, examples, isWrite, loadCatalog, pathProblem, readChatMessages, readChats, readErrors, type XRequest } from 'aibot-x-post'
import { SITE_MODE_LABELS, xWriteMode, type PodSession } from 'pod-domain'
import type { ContentBlock, JsonSchema, ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { acceptsMedia } from '../x/actions.ts'
import { xErrorText } from '../x/errors.ts'
import { X_GUIDE } from '../x/guide.ts'
import { MEDIA_LIMIT, loadMedia } from '../x/media.ts'
import { nothingRead, refundReason, type XCharge } from '../x/meter.ts'
import type { XWriteOutcome } from '../x/writes.ts'
import { failure, int, oneOf, podTool, str, strList, success, text, texts, type ToolValue } from './define.ts'

/** 要现开 x.com 再发请求，给足时间。 */
const TIMEOUT_MS = 120_000
/** 带文件时要传完、等 X 处理完（视频最多 10 分钟）。 */
const UPLOAD_TIMEOUT_MS = 15 * 60_000

const object = (description: string): JsonSchema => ({ type: 'object', description })

/** 接口列表、例子和过滤结果是成段的文字，原样交给模型，不包成 JSON。 */
function plain(value: ToolValue): ContentBlock[] {
  return [{ type: 'text', text: value.ok ? value.message : JSON.stringify(value) }]
}

function outcome(result: XWriteOutcome): ToolValue {
  return result.ok ? success(result.message, result.data ?? {}) : failure(result.message)
}

function objectArg(args: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, unknown>> | undefined {
  const value = args[key]
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined
}

function headersArg(args: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(objectArg(args, 'headers') ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

/** 按位置对应的文字列表：空的留成空字符串，不把后面的挤上来。 */
function positional(args: Readonly<Record<string, unknown>>, key: string): readonly string[] {
  const value = args[key]
  return Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item.trim() : '')) : []
}

function limitArg(args: Readonly<Record<string, unknown>>, fallback: number, max: number): number {
  const value = args.limit
  return typeof value === 'number' && Number.isInteger(value) ? Math.min(Math.max(value, 1), max) : fallback
}

/** 读加密聊天的错：还没输聊天密码时说清楚怎么解锁。 */
function chatErrorText(error: unknown): string {
  const text = xErrorText(error)
  return text.startsWith('XChat is locked') ? '加密聊天还没解锁：请用户在 dsh-bot 的浏览器里打开 https://x.com/i/chat，输一次聊天密码，再来读。' : text
}

interface RequestArgs {
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly params: Readonly<Record<string, unknown>>
  readonly data: Readonly<Record<string, unknown>> | undefined
  readonly headers: Readonly<Record<string, string>>
  readonly files: readonly string[]
  readonly alts: readonly string[]
}

/**
 * 用 dsh-bot 浏览器里登录的 X 账号读写 X（x_ 开头）：列出接口、看录下的例子、发请求（响应存起来）、
 * 用 jq 过滤着读；另外能读加密聊天。
 * 改东西的请求按 x.com 的站点规则：默认交给用户批准，免审批的直接做，只读和禁止的不做；dsh web 对外开放时一律不做。
 */
export function xTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const current = (): PodSession => pod.registry.get(session.id) ?? session

  /** 读 X 先扣 aibot 的次数（用完了就不读），出错时退回，错误按 errorText 说。 */
  const metered = async (tool: string, errorText: (error: unknown) => string, work: (charge: XCharge) => Promise<ToolValue>): Promise<ToolValue> => {
    const charge = await pod.x.meter.charge({ tool, kind: 'read', files: 0 })
    if (charge.blocked !== undefined) return failure(charge.blocked)
    try {
      return await work(charge)
    } catch (error) {
      pod.x.meter.refund(charge, refundReason(error))
      return failure(errorText(error))
    }
  }

  const read = (request: XRequest): Promise<ToolValue> =>
    metered('x_api_request', xErrorText, async (charge) => {
      const response = await pod.x.account.use((client) => client.dispatch(request))
      const id = pod.x.responses.add(session.id, response)
      const errors = readErrors(response)
      if (errors.length === 0) return success(`响应存为 ${id}，用 x_filter_response 读`, { id })
      if (nothingRead(response)) pod.x.meter.refund(charge, 'x_errors')
      return success(`响应存为 ${id}，里面有 errors（X 没做成或部分没做成），先用 x_filter_response 看 .errors`, { id, errors: errors.slice(0, 3) })
    })

  const account = podTool<Record<string, never>>({
    name: 'x_account',
    description: '看 dsh-bot 浏览器里登录的是哪个 X 账号（x_ 工具都用它），以及 X 写操作现在要不要用户批准。',
    properties: {},
    parse: () => ({}),
    timeoutMs: TIMEOUT_MS,
    run: async () => {
      const status = await pod.x.account.check()
      const mode = SITE_MODE_LABELS[xWriteMode(pod.settings.get().siteRules)]
      const data = { state: status.state, handle: status.handle, name: status.name, writes: mode }
      if (status.state === 'ready') return success(`登录的是 @${status.handle}${status.name === '' ? '' : `（${status.name}）`}。X 写操作：${mode}。`, data)
      if (status.state === 'signed-out') return success('dsh-bot 的浏览器里没登录 X。请用户在 设置 → 通用 → X 账号 里点“登录”，登录好再用 x_ 工具。', data)
      return failure(status.message === '' ? '没查到登录的 X 账号' : status.message)
    },
  })

  const listEndpoints = podTool<Record<string, never>>({
    name: 'x_list_endpoints',
    description: 'All callable endpoints, one per line: GraphQL as "/graphql/<queryId>/<operationName>", REST as "METHOD <path>". Use a line verbatim as `path` in x_get_operation and x_api_request.',
    properties: {},
    parse: () => ({}),
    concurrent: true,
    render: plain,
    run: async () => success(endpointLines(await loadCatalog()).join('\n')),
  })

  const getOperation = podTool<{ readonly path: string }>({
    name: 'x_get_operation',
    description: 'Recorded real example for an endpoint, in the exact shape x_api_request accepts. Multiple lines are multiple recorded variants.',
    properties: { path: str('A line from x_list_endpoints, verbatim') },
    required: ['path'],
    parse: (args) => {
      const path = text(args, 'path')
      return path === '' ? '缺少 path' : { path }
    },
    concurrent: true,
    render: plain,
    run: async (args) => {
      const found = examples(await loadCatalog(), args.path)
      if (found.length === 0) return success(`Not in catalog: ${args.path}. Pick a line from x_list_endpoints.`)
      return success(found.map((item) => JSON.stringify(item)).join('\n'))
    },
  })

  const request = podTool<RequestArgs>({
    name: 'x_api_request',
    description: `Call an endpoint and return a response id (never the body - read it with x_filter_response). GraphQL: send {variables: {...}} in params (GET) or data (POST). REST: copy params/data from x_get_operation. Paths not in the catalog are sent as-is.\n\n${X_GUIDE}`,
    properties: {
      method: oneOf('Only used when `path` is not in the catalog (default GET)', ['GET', 'POST']),
      path: str('A line from x_list_endpoints, verbatim; or a raw path relative to https://x.com/i/api'),
      params: object('Query parameters; object values are JSON-encoded automatically'),
      data: object('JSON body (POST)'),
      headers: object('Extra headers; rarely needed'),
      files: strList(`要带的图片、GIF 或视频：工作区里的路径（相对你的工作目录或绝对路径），最多 ${MEDIA_LIMIT} 个，每个不超过 1 GB；收 JPEG、PNG、WebP、GIF、MP4、MOV。只用在 CreateTweet 这类 variables 里有 media.media_entities 的请求上`),
      alt_texts: strList('每个文件的说明文字（替代文字，读给看不到图的人听），按 files 的顺序一一对应，可以不填'),
    },
    required: ['path'],
    timeoutMs: UPLOAD_TIMEOUT_MS,
    parse: (args) => {
      const path = text(args, 'path')
      const files = texts(args, 'files')
      const alts = positional(args, 'alt_texts')
      if (path === '') return '缺少 path'
      if (files.length > MEDIA_LIMIT) return `files 最多 ${MEDIA_LIMIT} 个`
      if (alts.length > files.length) return 'alt_texts 比 files 多，要按 files 的顺序一一对应'
      const method = typeof args.method === 'string' && args.method.toUpperCase() === 'POST' ? 'POST' : 'GET'
      return { method, path, params: objectArg(args, 'params') ?? {}, data: objectArg(args, 'data'), headers: headersArg(args), files, alts }
    },
    run: async (args) => {
      const built = buildRequest(await loadCatalog(), { method: args.method, path: args.path, params: args.params, headers: args.headers, ...(args.data === undefined ? {} : { data: args.data }) })
      const problem = pathProblem(built.path) ?? credentialProblem(built)
      if (problem !== undefined) return failure(problem)
      if (args.files.length > 0 && !acceptsMedia(built)) return failure('files 只能用在 CreateTweet 这类 variables 里有 media.media_entities 的请求上')
      if (!isWrite(built)) return read(built)
      const me = current()
      const media = args.files.length === 0 ? [] : await loadMedia(args.files, args.alts, (path) => pod.browser.owner.resolveWorkspaceFile(path, pod.folderOf(me)), pod.workspaceRoot)
      if (typeof media === 'string') return failure(media)
      return outcome(await pod.x.writes.request(me, { request: built, ...(media.length === 0 ? {} : { media }) }))
    },
  })

  const filterResponse = podTool<{ readonly id: string; readonly jq: string }>({
    name: 'x_filter_response',
    description: 'Apply a jq filter to a stored response and return the result - the only way to read an x_api_request response. Re-call freely with different filters on the same id.',
    properties: { id: str('A response id returned by x_api_request'), jq: str('jq filter applied to the stored raw response') },
    required: ['id', 'jq'],
    parse: (args) => {
      const id = text(args, 'id')
      const jq = typeof args.jq === 'string' ? args.jq : ''
      if (id === '') return '缺少 id'
      return jq.trim() === '' ? '缺少 jq' : { id, jq }
    },
    concurrent: true,
    render: plain,
    run: async (args) => {
      const result = await pod.x.responses.filter(session.id, args.id, args.jq)
      return result.ok ? success(result.text) : failure(result.text)
    },
  })

  const chats = podTool<{ readonly limit: number }>({
    name: 'x_chats',
    description:
      '读登录的 X 账号的加密聊天（XChat，x.com/i/chat）会话列表，最近的在前：会话 id、对方名字、最后一条的预览和时间（照 X 网页显示的）。',
    properties: { limit: int('最多读多少个会话，默认 20，最多 100') },
    timeoutMs: TIMEOUT_MS,
    parse: (args) => ({ limit: limitArg(args, 20, 100) }),
    run: (args) =>
      metered('x_chats', chatErrorText, async () => {
        const conversations = await pod.x.account.use((client) => readChats(client, { limit: args.limit }))
        return success(`${conversations.length} 个会话`, { conversations })
      }),
  })

  const chat = podTool<{ readonly conversation: string; readonly limit: number }>({
    name: 'x_chat',
    description: '读加密聊天里一个会话最近的消息，按时间从早到晚：发送人、是不是自己发的（mine）、日期、时间、正文和发送状态（照 X 网页显示的）。',
    properties: { conversation: str('x_chats 给的会话 id，或 https://x.com/i/chat/… 链接'), limit: int('最多读多少条，默认 50，最多 300') },
    required: ['conversation'],
    timeoutMs: TIMEOUT_MS,
    parse: (args) => {
      const conversation = text(args, 'conversation')
      return conversation === '' ? '缺少 conversation' : { conversation, limit: limitArg(args, 50, 300) }
    },
    run: (args) =>
      metered('x_chat', chatErrorText, async () => {
        const result = await pod.x.account.use((client) => readChatMessages(client, args.conversation, { limit: args.limit }))
        return success(`${result.name === '' ? result.id : result.name}：${result.messages.length} 条`, { id: result.id, name: result.name, messages: result.messages })
      }),
  })

  return [account, listEndpoints, getOperation, request, filterResponse, chats, chat]
}
