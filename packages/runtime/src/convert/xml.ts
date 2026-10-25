/**
 * 很小的 XML 扫描器：Office 文件里的 XML 都是规整的，只需要按顺序拿到开始标签、结束标签和文字。
 * 标签名去掉前缀（w:p 当成 p），兼容不写前缀或换了前缀的生成器。
 * mc:Fallback 整段跳过：它是给老软件看的备用内容，和 mc:Choice 里的文字重复。
 */

export interface XmlVisitor {
  /** attrs 是原样的属性串，用 attr() 取值；自闭合标签在 open 之后紧跟一次 close。 */
  readonly open?: (name: string, attrs: string) => void
  readonly close?: (name: string) => void
  readonly text?: (value: string) => void
}

const TOKEN = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g
const NAMED: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function localName(name: string): string {
  const colon = name.indexOf(':')
  return colon === -1 ? name : name.slice(colon + 1)
}

function codePoint(code: number, whole: string): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
}

export function decode(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return codePoint(Number.parseInt(body.slice(2), 16), whole)
    if (body.startsWith('#')) return codePoint(Number.parseInt(body.slice(1), 10), whole)
    return NAMED[body] ?? whole
  })
}

/** 每个属性名只编译一次正则：表格里每个单元格都要取好几个属性。 */
const patterns = new Map<string, RegExp>()

/** 按本地名取属性（w:val 和 val 都算 val）。 */
export function attr(attrs: string, name: string): string | undefined {
  const known = patterns.get(name)
  const pattern = known ?? new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)
  if (known === undefined) patterns.set(name, pattern)
  const match = pattern.exec(attrs)
  return match === null ? undefined : decode(match[1] ?? match[2] ?? '')
}

/** 部件引用的编号（r:id）：一定带前缀，和同一个标签上不带前缀的 id 区分开。 */
export function relationId(attrs: string): string | undefined {
  const match = /(?:^|\s)[\w.-]+:id\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs)
  return match === null ? undefined : decode(match[1] ?? match[2] ?? '')
}

export function walkXml(xml: string, visitor: XmlVisitor): void {
  let skipping = 0
  for (const match of xml.matchAll(TOKEN)) {
    const tag = match[3]
    if (tag !== undefined) {
      const closing = match[2] === '/'
      const empty = match[5] === '/'
      if (skipping > 0) {
        if (closing) skipping -= 1
        else if (!empty) skipping += 1
        continue
      }
      const name = localName(tag)
      if (closing) {
        visitor.close?.(name)
        continue
      }
      if (name === 'Fallback') {
        if (!empty) skipping = 1
        continue
      }
      visitor.open?.(name, match[4] ?? '')
      if (empty) visitor.close?.(name)
      continue
    }
    if (skipping > 0 || visitor.text === undefined) continue
    const cdata = match[1]
    if (cdata !== undefined) visitor.text(cdata)
    else if (match[6] !== undefined) visitor.text(decode(match[6]))
  }
}
