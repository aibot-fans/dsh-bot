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
 * 把 aibot 的 MCP 工具变成 bot 会话里的工具：参数的 schema 原样给模型，调用转给 aibot。
 * 读写按工具自带的 annotations 认：只读的可以同时调，会改东西的一个一个来，会删改设置的在说明里加一句提醒。
 */
export function xTools(tools: readonly McpTool[], call: (name: string, args: unknown) => Promise<XToolValue>): readonly ToolDefinition[] {
  return tools.map(
    (tool): ToolDefinition => ({
      name: tool.name,
      description: `${tool.description === '' ? t('aibot 的 X 工具 {name}', { name: tool.name }) : tool.description}${tool.destructive ? `\n${DESTRUCTIVE_NOTE}` : ''}`,
      parameters: tool.inputSchema,
      output: { schema: OUTPUT_SCHEMA, render },
      timeoutMs: CALL_TIMEOUT_MS,
      ...(tool.readOnly ? { isConcurrencySafe: () => true } : {}),
      execute: (args: unknown) => call(tool.name, withDefaults(tool.name, args)),
    }),
  )
}

/** 名字、角色或能力标签里提到 X、推特、Twitter 的 bot 也给 X 工具。 */
export function wantsX(bot: Bot): boolean {
  return [bot.name, bot.title, ...bot.capabilities].some((label) => /推特|twitter|(^|[^a-z])x($|[^a-z])/i.test(label))
}
