/** 读 X 返回的 JSON 用的几个小工具。 */

export function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined
}

export function dig(value: unknown, ...keys: readonly string[]): unknown {
  return keys.reduce<unknown>((current, key) => record(current)?.[key], value)
}

export function textAt(value: unknown, ...keys: readonly string[]): string {
  const found = dig(value, ...keys)
  return typeof found === 'string' ? found : ''
}

/** 里面所有的字符串，按出现顺序。 */
export function strings(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  const object = record(value)
  return object === undefined ? [] : Object.values(object).flatMap(strings)
}
