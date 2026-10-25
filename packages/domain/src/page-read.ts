/** 读 bot 写的页面内容用的宽松读取：数字写成字符串也认，多余字段忽略，错误按位置记下来。 */

export type Raw = Readonly<Record<string, unknown>>

/** 一次最多报这么多处错误，够 bot 改一轮。 */
const MAX_ERRORS = 12

export interface ReadContext {
  readonly errors: string[]
}

export function report(ctx: ReadContext, path: string, message: string): void {
  if (ctx.errors.length < MAX_ERRORS) ctx.errors.push(`${path}：${message}`)
}

export function record(value: unknown): Raw | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : undefined
}

/** 按码点截断，不切坏汉字和表情。 */
export function clip(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length <= max ? value : chars.slice(0, max).join('')
}

/** 文字：字符串或数字都认，去掉首尾空白，超长截断。 */
export function textOf(value: unknown, max = 2000): string {
  if (typeof value === 'string') return clip(value.trim(), max)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? '是' : '否'
  return ''
}

/** 依次取几个别名里第一个有值的。 */
export function field(raw: Raw, keys: readonly string[], max = 2000): string {
  for (const key of keys) {
    const value = textOf(raw[key], max)
    if (value !== '') return value
  }
  return ''
}

/** 数字：数字或者能读成数字的字符串（允许千分位逗号、末尾的 %）。读不出来返回 null。 */
export function numberOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const cleaned = value.trim().replaceAll(',', '').replace(/%$/, '')
  if (cleaned === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

export function flagOf(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1) return true
  if (value === 'false' || value === 0) return false
  return fallback
}

export function choice<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  if (typeof value !== 'string') return fallback
  const lowered = value.trim().toLowerCase()
  return (options as readonly string[]).includes(lowered) ? (lowered as T) : fallback
}

export function listOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

/** 数组超过上限时记一处错误并截断。 */
export function capped(ctx: ReadContext, path: string, value: unknown, max: number, what: string): readonly unknown[] {
  const items = listOf(value)
  if (items.length <= max) return items
  report(ctx, path, `${what}最多 ${max} 个，现在有 ${items.length} 个`)
  return items.slice(0, max)
}

export function numbers(value: unknown): readonly (number | null)[] {
  return listOf(value).map(numberOf)
}

export function strings(value: unknown, max = 200): readonly string[] {
  return listOf(value)
    .map((item) => textOf(item, max))
    .filter((item) => item !== '')
}
