import { t, type Bot } from 'pod-domain'
import type { ContentBlock, JsonSchema, ToolDefinition } from '../dsh.ts'
import type { McpTool } from './mcp.ts'

/** X 工具的结果：成功时 text 是 aibot 返回的内容（JSON 文字），失败时 message 是原因。 */
export interface XToolValue {
  readonly ok: boolean
  readonly message: string
  readonly text?: string
}

const OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, message: { type: 'string' }, text: { type: 'string' } },
  required: ['ok', 'message'],
}

/** 一次结果最多给模型这么多字，再多就截掉，省 token。 */
const MAX_TEXT = 40_000
const CALL_TIMEOUT_MS = 90_000

/** 加监控时没说监控哪些事件，就监控原创、回复和引用。 */
export const DEFAULT_EVENT_TYPES = ['tweetOriginal', 'tweetReply', 'tweetQuote']

/** 加监控的两个工具：没给事件类型时补上默认的（对接文档建议的默认值）。 */
const MONITOR_ADD_TOOLS: readonly string[] = ['twitter_monitor_add', 'twitter_monitor_bulk_add']

/** 会删除或修改设置的工具（destructiveHint）给模型多一句提醒。 */
const DESTRUCTIVE_NOTE = '（这个工具会删除或修改已有的设置，只在用户明确要求时调用。）'

/**
 * 监控工具多一段说明：新动态怎么到用户手里。不写的话，bot 看到结果里 aibot 给的 WebSocket 推送通道和订阅的轮询间隔，
 * 会跟用户说“每 60 秒查一次”，或者说自己去连 WebSocket；其实 dsh-bot 一直连着 aibot 的实时事件流，这两样都用不上。
 */
const MONITOR_NOTE =
  '（dsh-bot：有监控时 dsh-bot 一直连着 aibot 的实时事件流，aibot 一发现新动态（一般几秒内）就推过来，dsh-bot 直接发进「X 监控」群并通知用户。你不用另外接收、轮询或连 WebSocket，也别跟用户说“每多少秒查一次”。）'

/**
 * 监控工具的结果里去掉的字段：pushChannel 是给自己连 WebSocket 的客户端用的推送通道，带着令牌，dsh-bot 走的是事件流；
 * pollIntervalSeconds 是订阅上的旧字段，正在监控的账号 aibot 一直在盯，跟推送快慢无关。参数里也不给 pollIntervalSeconds。
 */
const MONITOR_HIDDEN: ReadonlySet<string> = new Set(['pushChannel', 'pollIntervalSeconds'])

function isMonitorTool(name: string): boolean {
  return name.startsWith('twitter_monitor')
}

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !MONITOR_HIDDEN.has(key)).map(([key, item]) => [key, scrub(item)] as const))
}

/** 监控工具的结果去掉 MONITOR_HIDDEN 里的字段；不是 JSON 的原样返回。 */
export function cleanMonitorText(text: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  return JSON.stringify(scrub(parsed), null, text.includes('\n') ? 2 : undefined)
}

/** 监控工具的参数去掉 pollIntervalSeconds（见 MONITOR_HIDDEN）。 */
function monitorSchema(schema: JsonSchema): JsonSchema {
  const properties = schema.properties
  if (typeof properties !== 'object' || properties === null || !('pollIntervalSeconds' in properties)) return schema
  const rest = Object.fromEntries(Object.entries(properties).filter(([key]) => key !== 'pollIntervalSeconds'))
  const required = Array.isArray(schema.required) ? { required: schema.required.filter((key: unknown) => key !== 'pollIntervalSeconds') } : {}
  return { ...schema, properties: rest, ...required }
}

async function cleaned(call: Promise<XToolValue>): Promise<XToolValue> {
  const value = await call
  return value.ok && value.text !== undefined ? { ...value, text: cleanMonitorText(value.text) } : value
}

function render(_args: unknown, value: unknown): ContentBlock[] {
  const result = value as XToolValue
  if (!result.ok) return [{ type: 'text', text: JSON.stringify({ ok: false, message: result.message }) }]
  const body = result.text ?? ''
  return [{ type: 'text', text: body.length > MAX_TEXT ? `${body.slice(0, MAX_TEXT)}\n（内容太长，后面截掉了；需要的话缩小范围再查）` : body || '（aibot 没有返回内容）' }]
}

/** 加监控没给事件类型时补上默认的。 */
export function withDefaults(name: string, args: unknown): unknown {
  if (!MONITOR_ADD_TOOLS.includes(name) || typeof args !== 'object' || args === null || Array.isArray(args)) return args
  const record = args as Readonly<Record<string, unknown>>
  return Array.isArray(record.eventTypes) && record.eventTypes.length > 0 ? record : { ...record, eventTypes: DEFAULT_EVENT_TYPES }
}

/**
 * 把 aibot 的 MCP 工具变成 bot 会话里的工具：参数的 schema 原样给模型（监控工具去掉轮询间隔），调用转给 aibot。
 * 读写按工具自带的 annotations 认：只读的可以同时调，会改东西的一个一个来，会删改设置的在说明里加一句提醒。
 * 监控工具再加一段事件怎么到用户手里的说明，结果里去掉推送通道和轮询间隔。
 */
export function xTools(tools: readonly McpTool[], call: (name: string, args: unknown) => Promise<XToolValue>): readonly ToolDefinition[] {
  return tools.map((tool): ToolDefinition => {
    const monitor = isMonitorTool(tool.name)
    const notes = [tool.destructive ? DESTRUCTIVE_NOTE : '', monitor ? MONITOR_NOTE : ''].filter((note) => note !== '')
    return {
      name: tool.name,
      description: [tool.description === '' ? t('aibot 的 X 工具 {name}', { name: tool.name }) : tool.description, ...notes].join('\n'),
      parameters: monitor ? monitorSchema(tool.inputSchema) : tool.inputSchema,
      output: { schema: OUTPUT_SCHEMA, render },
      timeoutMs: CALL_TIMEOUT_MS,
      ...(tool.readOnly ? { isConcurrencySafe: () => true } : {}),
      execute: (args: unknown) => (monitor ? cleaned(call(tool.name, withDefaults(tool.name, args))) : call(tool.name, withDefaults(tool.name, args))),
    }
  })
}

/** 名字、角色或能力标签里提到 X、推特、Twitter 的 bot 也给 X 工具。 */
export function wantsX(bot: Bot): boolean {
  return [bot.name, bot.title, ...bot.capabilities].some((label) => /推特|twitter|(^|[^a-z])x($|[^a-z])/i.test(label))
}
