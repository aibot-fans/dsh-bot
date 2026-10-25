/** 文字小工具：按读者的感受计数和截断，一个汉字算一个字。 */

export function charLength(value: string): number {
  return [...value].length
}

/** 截到最多 max 个字，超出时以省略号结尾。 */
export function truncate(value: string, max: number): string {
  const chars = [...value]
  if (chars.length <= max) return value
  return `${chars.slice(0, Math.max(0, max - 1)).join('')}…`
}

/** 压成一行：换行和连续空白变成一个空格。 */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** 32 位 FNV-1a，给网页指纹、去重这类不涉及安全的场合用。 */
export function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    hash ^= code
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 粗估 token 数：中文按 1 字 1 token，其余按 4 个字符 1 token。只用于预算显示，计费以接口返回为准。 */
export function estimateTokens(value: string): number {
  let cjk = 0
  let other = 0
  for (const char of value) {
    if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(char)) cjk += 1
    else other += 1
  }
  return cjk + Math.ceil(other / 4)
}
