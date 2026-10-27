import { t } from 'pod-domain'
/** 转出来的文字版统一写成 Markdown：Pod 的预览能显示标题和表格，bot 读起来也清楚。 */

/** 单元格里的竖线换成全角、换行换成空格：Pod 的 Markdown 和 bot 都按竖线分列。 */
export function cell(text: string): string {
  return text.replace(/\|/g, '｜').replace(/\s*\n\s*/g, ' ').trim()
}

/** Markdown 表格：第一行当表头，列数按最宽的一行补齐。 */
export function table(rows: readonly (readonly string[])[]): string {
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 1)
  const line = (row: readonly string[]): string => `| ${Array.from({ length: width }, (_, index) => cell(row[index] ?? '')).join(' | ')} |`
  const [head, ...body] = rows
  return [line(head ?? []), `|${' --- |'.repeat(width)}`, ...body.map(line)].join('\n')
}

/** 文字版的开头：标题写原文件名，下面一句说明是怎么来的、丢了什么。 */
export function textDocument(fileName: string, note: string, body: string): string {
  const content = body.trim()
  return `# ${t('{fileName}（文字版）', { fileName })}\n\n> ${note}\n\n${content === '' ? t('（没有读到文字）') : content}\n`
}

/** 不算空白的字数，用来告诉 bot 文字版有多长。 */
export function countChars(text: string): number {
  let count = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code > 32 && code !== 0xa0 && code !== 0x3000) count += 1
  }
  return count
}
