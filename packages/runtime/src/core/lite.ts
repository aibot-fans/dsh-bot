import { ZERO_USAGE, currentLanguage, withLanguage, type Usage } from 'pod-domain'
import type { LlmService, ModelSelection, UserMessage } from '../dsh.ts'

/**
 * 轻量调用：摘要、记忆提取、交接笔记、写操作复核这类不需要 agent 循环的单次请求。
 * 直接走 ctx.llm，仍然用 dsh 配置的模型服务和凭据；默认取模型支持的最低推理档位。
 * 界面是英文时补一句语言说明，写出来给人看的东西（记忆、交接笔记、复盘）也用英文。
 */

export interface LiteRequest {
  /** 给日志和用量统计看的用途，例如 memory-extract。 */
  readonly purpose: string
  readonly system: string
  readonly prompt: string
  readonly maxTokens?: number
  readonly signal?: AbortSignal
  /** 不填就用设置里的轻量模型。 */
  readonly model?: ModelSelection
}

export interface LiteResult {
  readonly text: string
  readonly usage: Usage
  readonly provider: string
  readonly model: string
}

export interface LiteDeps {
  readonly llm: () => LlmService | undefined
  readonly resolveModel: () => Promise<ModelSelection>
  readonly onUsage: (purpose: string, result: LiteResult) => void
}

const DEFAULT_MAX_TOKENS = 2048

function failureText(reason: unknown): string | undefined {
  if (typeof reason !== 'object' || reason === null) return undefined
  const record = reason as { readonly kind?: unknown; readonly failure?: { readonly message?: unknown } }
  if (record.kind !== 'error' && record.kind !== 'aborted') return undefined
  const message = record.failure?.message
  return typeof message === 'string' ? message : String(record.kind)
}

/** 从模型输出里取第一个 JSON 值：先找 ```json 代码块，再找第一个 { 或 [ 起的片段。 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidates = [fenced?.[1], text]
  for (const candidate of candidates) {
    if (candidate === undefined) continue
    const start = candidate.search(/[[{]/)
    if (start < 0) continue
    const open = candidate[start]
    const close = open === '{' ? '}' : ']'
    const end = candidate.lastIndexOf(close)
    if (end <= start) continue
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as unknown
    } catch {
      // 换下一个候选。
    }
  }
  return undefined
}

export class LiteLlm {
  private readonly deps: LiteDeps

  constructor(deps: LiteDeps) {
    this.deps = deps
  }

  get available(): boolean {
    return this.deps.llm() !== undefined
  }

  async complete(request: LiteRequest): Promise<LiteResult> {
    const llm = this.deps.llm()
    if (llm === undefined) throw new Error('这个 dsh 没有提供 ctx.llm，轻量调用不可用')
    const route = request.model ?? (await this.deps.resolveModel())
    const call = await llm.prepareCall(
      { provider: route.provider, model: route.model, maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS },
      request.signal,
      (controls, model) => {
        const lowest = model.reasoning?.efforts[0]?.id
        return lowest === undefined ? controls : { ...controls, reasoningEffort: lowest }
      },
    )
    const message: UserMessage = Object.freeze({
      id: globalThis.crypto.randomUUID(),
      role: 'user',
      content: Object.freeze([Object.freeze({ type: 'text', text: request.prompt })]),
      source: Object.freeze({ kind: 'pod-lite' }),
    }) as UserMessage
    let text = ''
    let usage: Usage = ZERO_USAGE
    const stream = call.stream({
      ...call.config,
      messages: [message],
      system: withLanguage(request.system, currentLanguage()),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      else if (chunk.type === 'usage' && typeof chunk.usage === 'object' && chunk.usage !== null) {
        const raw = chunk.usage as { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }
        usage = {
          inputTokens: raw.inputTokens ?? 0,
          outputTokens: raw.outputTokens ?? 0,
          cacheReadTokens: raw.cacheReadTokens ?? 0,
        }
      } else if (chunk.type === 'finish') {
        const failure = failureText(chunk.reason)
        if (failure !== undefined) throw new Error(`轻量调用失败：${failure}`)
      }
    }
    const result: LiteResult = { text: text.trim(), usage, provider: call.config.provider, model: call.config.model }
    this.deps.onUsage(request.purpose, result)
    return result
  }

  /** 要求模型只输出 JSON；解析或校验失败返回 undefined，调用方决定怎么退化。 */
  async completeJson<T>(request: LiteRequest, validate: (value: unknown) => T | undefined): Promise<T | undefined> {
    const result = await this.complete(request)
    return validate(extractJson(result.text))
  }
}
