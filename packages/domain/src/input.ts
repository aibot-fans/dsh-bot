/** 读请求体和工具参数的小工具：只认对的类型，其余一律当作没给。 */

import { isRecord } from './text.ts'

export type InputRecord = Readonly<Record<string, unknown>>

export function asRecord(input: unknown): InputRecord {
  return isRecord(input) ? input : {}
}

/** 必填 id：非空字符串，去掉首尾空白。 */
export function readId(input: unknown, key: string): string | undefined {
  const value = asRecord(input)[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

export function readObject(input: unknown, key: string): unknown {
  return asRecord(input)[key]
}

/** 可选文字：没给返回 undefined，给了但不是文字返回 null，方便区分“没改”和“填错了”。 */
export function readText(input: unknown, key: string): string | undefined | null {
  const value = asRecord(input)[key]
  if (value === undefined) return undefined
  return typeof value === 'string' ? value.trim() : null
}

export function readString(input: unknown, key: string, fallback = ''): string {
  const value = asRecord(input)[key]
  return typeof value === 'string' ? value.trim() : fallback
}

export function readBool(input: unknown, key: string): boolean | undefined {
  const value = asRecord(input)[key]
  return typeof value === 'boolean' ? value : undefined
}

export function readInt(input: unknown, key: string): number | undefined {
  const value = asRecord(input)[key]
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

/** 字符串数组：丢掉非字符串和空串，去掉首尾空白。 */
export function readStringArray(input: unknown, key: string): readonly string[] | undefined {
  const value = asRecord(input)[key]
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
}

/** 从固定选项里读一个值。 */
export function readEnum<T extends string>(input: unknown, key: string, options: readonly T[]): T | undefined {
  const value = asRecord(input)[key]
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : undefined
}
