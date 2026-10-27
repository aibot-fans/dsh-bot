import { currentLanguage, intlLocale } from 'pod-domain'

/** 拼 HTML 用的小工具：所有来自 bot 的文字都要先转义。 */

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
}

/** 属性值里的 JSON（给组件脚本读的数据）。 */
export function jsonAttr(value: unknown): string {
  return esc(JSON.stringify(value))
}

/** 只认 http、https 和 mailto 的链接；其余返回 undefined，按纯文字显示。 */
export function safeHref(raw: string): string | undefined {
  const value = raw.trim()
  if (/^mailto:[^\s<>"]+$/i.test(value)) return value
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function link(href: string, text: string): string {
  return `<a href="${esc(href)}" rel="noopener noreferrer" target="_blank">${text}</a>`
}

/** 大数字缩写：中文按万、亿，英文按 K、M、B。 */
export function compact(value: number): string {
  const abs = Math.abs(value)
  if (currentLanguage() === 'en') {
    if (abs >= 1e9) return `${trim(value / 1e9)}B`
    if (abs >= 1e6) return `${trim(value / 1e6)}M`
    if (abs >= 1e4) return `${trim(value / 1e3)}K`
    return trim(value)
  }
  if (abs >= 1e8) return `${trim(value / 1e8)}亿`
  if (abs >= 1e4) return `${trim(value / 1e4)}万`
  return trim(value)
}

function trim(value: number): string {
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2
  return Number(value.toFixed(digits)).toLocaleString(intlLocale(), { maximumFractionDigits: digits })
}

/** 表格和提示里的完整数字：千分位，最多两位小数。 */
export function full(value: number): string {
  return value.toLocaleString(intlLocale(), { maximumFractionDigits: 2 })
}

/** 坐标轴刻度：取整齐的数（1、2、5 乘 10 的幂）。 */
export function niceTicks(min: number, max: number, count = 5): readonly number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.5
    return niceTicks(min - pad, max + pad, count)
  }
  const span = max - min
  const raw = span / Math.max(1, count - 1)
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= raw) ?? 10 * power)
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let value = start; value <= end + step / 2; value += step) ticks.push(Number(value.toFixed(10)))
  return ticks
}

/** 估一段文字画出来多宽（汉字按整字宽，其余按半个）。 */
export function textWidth(text: string, size = 12): number {
  let units = 0
  for (const char of text) units += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char) ? 1 : 0.58
  return units * size
}

/** 按宽度折行，最多 lines 行，多出来的用省略号。 */
export function wrap(text: string, maxWidth: number, size = 12, lines = 2): readonly string[] {
  const result: string[] = []
  let current = ''
  for (const char of text) {
    if (textWidth(current + char, size) > maxWidth && current !== '') {
      result.push(current)
      current = ''
      if (result.length === lines) break
    }
    current += char
  }
  if (result.length < lines && current !== '') result.push(current)
  const used = result.join('').length
  if (used < Array.from(text).length && result.length > 0) {
    const last = result[result.length - 1] ?? ''
    result[result.length - 1] = `${Array.from(last).slice(0, -1).join('')}…`
  }
  return result
}
