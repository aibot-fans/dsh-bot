import type { ContentBlock, JsonSchema, ToolDefinition, ToolRunContext } from '../dsh.ts'

/**
 * Pod 工具的定义方式：参数写成 dsh 支持的 JSON Schema 子集，执行前自己再读一遍参数
 * （只认对的类型），结果统一是 { ok, message, ...数据 }，渲染成紧凑 JSON 给模型。
 */

export type ToolValue = Readonly<Record<string, unknown>> & { readonly ok: boolean; readonly message: string }

export interface PodToolSpec<A> {
  readonly name: string
  readonly description: string
  readonly properties: Readonly<Record<string, JsonSchema>>
  readonly required?: readonly string[]
  /** 读参数；返回字符串表示参数不对，原样告诉模型。 */
  readonly parse: (args: Readonly<Record<string, unknown>>) => A | string
  readonly run: (args: A, exec: ToolRunContext) => Promise<ToolValue> | ToolValue
  readonly timeoutMs?: number
  /** 只读、可以和其他工具并行的才设 true。 */
  readonly concurrent?: boolean
  /** 结果里除了文字还有别的（比如截图），自己决定怎么交给模型。 */
  readonly render?: (value: ToolValue) => ContentBlock[]
}

const OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, message: { type: 'string' } },
  required: ['ok', 'message'],
}

function render(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

export function failure(message: string): ToolValue {
  return { ok: false, message }
}

export function success(message: string, data: Readonly<Record<string, unknown>> = {}): ToolValue {
  return { ok: true, message, ...data }
}

export function podTool<A>(spec: PodToolSpec<A>): ToolDefinition {
  const parameters: JsonSchema = {
    type: 'object',
    properties: spec.properties,
    ...(spec.required === undefined || spec.required.length === 0 ? {} : { required: spec.required }),
  }
  return {
    name: spec.name,
    description: spec.description,
    parameters,
    output: { schema: OUTPUT_SCHEMA, render: spec.render === undefined ? render : (_args: unknown, value: unknown) => (spec.render as (value: ToolValue) => ContentBlock[])(value as ToolValue) },
    ...(spec.timeoutMs === undefined ? {} : { timeoutMs: spec.timeoutMs }),
    ...(spec.concurrent === true ? { isConcurrencySafe: () => true } : {}),
    async execute(raw: unknown, exec: ToolRunContext): Promise<unknown> {
      const args = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Readonly<Record<string, unknown>>) : {}
      const parsed = spec.parse(args)
      if (typeof parsed === 'string') return failure(`参数不对：${parsed}`)
      try {
        return await spec.run(parsed, exec)
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error))
      }
    },
  }
}

// ---------- 常用的参数写法 ----------

export const str = (description: string): JsonSchema => ({ type: 'string', description })

export const strList = (description: string): JsonSchema => ({ type: 'array', items: { type: 'string' }, description })

export const intList = (description: string): JsonSchema => ({ type: 'array', items: { type: 'integer' }, description })

export const bool = (description: string): JsonSchema => ({ type: 'boolean', description })

export const int = (description: string): JsonSchema => ({ type: 'integer', description })

export const oneOf = (description: string, values: readonly string[]): JsonSchema => ({ type: 'string', enum: values, description })

export function text(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function texts(args: Readonly<Record<string, unknown>>, key: string): readonly string[] {
  const value = args[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
}

export function ints(args: Readonly<Record<string, unknown>>, key: string): readonly number[] {
  const value = args[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item))
}

export function flag(args: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  const value = args[key]
  return typeof value === 'boolean' ? value : undefined
}
