/**
 * 行内的 Markdown：行内代码、粗体、斜体、删除线、链接、网址，以及反斜杠转义。
 * 时间线显示消息、输入框读回草稿和粘贴的文字都用这一套，两边认的格式一样。
 * 删除线只认两个波浪号：中文里单个“~”常用来表示范围（3~5 天）。
 */

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong' | 'em' | 'strike'; readonly children: readonly Inline[] }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly Inline[] }
  | { readonly kind: 'url'; readonly href: string }

// 网址到空白、括号、中文和全角标点为止；末尾的英文标点算句子的，不算网址。
const URL_CHARS = '[^\\s<>()（）\\u2018-\\u201f\\u3000-\\u303f\\u3400-\\u4dbf\\u4e00-\\u9fff\\uff01-\\uff0f\\uff1a-\\uff20]+'

// 星号两边都紧挨字母数字时不算格式：2*3*4、2**10 这类算式原样显示；“React**组件**”照样是粗体。
const open = (stars: string): string => `(?:(?<!\\w)|(?=${stars}[^\\w\\s*]))${stars}(?!\\s)`
const close = (stars: string): string => `(?<!\\s)${stars}(?:(?!\\w)|(?<=[^\\w\\s*]${stars}))`

const PATTERN = new RegExp(
  [
    '\\\\([!-/:-@[-`{-~])', // 1 转义
    '``\\s?(.+?)\\s?``', // 2 带反引号的行内代码
    '`([^`]+)`', // 3 行内代码
    `${open('\\*\\*\\*')}([^*]+?)${close('\\*\\*\\*')}`, // 4 粗斜体
    `${open('\\*\\*')}((?:[^*]|\\*(?!\\*))+?)${close('\\*\\*')}`, // 5 粗体，里面可以套斜体
    '~~(?!\\s)([^~]+?)(?<!\\s)~~', // 6 删除线
    '\\[([^\\]]+)\\]\\(([^)\\s]+)\\)', // 7、8 链接
    `(https?:\\/\\/${URL_CHARS})`, // 9 网址
    `${open('\\*')}([^*]+?)${close('\\*')}`, // 10 斜体
    '(?<!\\w)_(?!\\s)([^_]+?)(?<!\\s)_(?!\\w)', // 11 下划线斜体，词中间的下划线不算
  ].join('|'),
  'g',
)

function pushText(tokens: Inline[], text: string): void {
  if (text === '') return
  const last = tokens[tokens.length - 1]
  if (last?.kind === 'text') tokens[tokens.length - 1] = { kind: 'text', text: last.text + text }
  else tokens.push({ kind: 'text', text })
}

function tokenOf(match: RegExpMatchArray): Inline {
  const [, escaped, doubleCode, code, strongEm, strong, strike, label, href, , em, underscored] = match
  if (escaped !== undefined) return { kind: 'text', text: escaped }
  if (doubleCode !== undefined) return { kind: 'code', text: doubleCode }
  if (code !== undefined) return { kind: 'code', text: code }
  if (strongEm !== undefined) return { kind: 'strong', children: [{ kind: 'em', children: parseInline(strongEm) }] }
  if (strong !== undefined) return { kind: 'strong', children: parseInline(strong) }
  if (strike !== undefined) return { kind: 'strike', children: parseInline(strike) }
  if (label !== undefined && href !== undefined) return { kind: 'link', href, children: parseInline(label) }
  if (em !== undefined) return { kind: 'em', children: parseInline(em) }
  return { kind: 'em', children: parseInline(underscored ?? '') }
}

/** 一行文字拆成行内记号；相邻的文字合成一段。 */
export function parseInline(text: string): readonly Inline[] {
  const tokens: Inline[] = []
  let last = 0
  for (const match of text.matchAll(PATTERN)) {
    const start = match.index ?? 0
    pushText(tokens, text.slice(last, start))
    const url = match[9]
    if (url !== undefined) {
      const href = url.replace(/[.,;:!?'"]+$/, '')
      tokens.push({ kind: 'url', href })
      pushText(tokens, url.slice(href.length))
    } else {
      const token = tokenOf(match)
      if (token.kind === 'text') pushText(tokens, token.text)
      else tokens.push(token)
    }
    last = start + match[0].length
  }
  pushText(tokens, text.slice(last))
  return tokens
}
