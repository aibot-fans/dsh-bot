import { t } from 'pod-domain'
import type { Extracted } from './formats.ts'
import { table } from './markdown.ts'
import { mainPart, relatedOfType, relationships } from './opc.ts'
import { attr, walkXml } from './xml.ts'
import type { ZipArchive } from './zip.ts'

interface StyleEntry {
  readonly level: number | undefined
  readonly basedOn: string | undefined
}

/** 段落样式 → 标题级别。中文版 Word 的样式编号常是 “1”“2”，所以按样式名（heading 1、标题 1）和大纲级别认。 */
function headingLevels(xml: string | undefined): ReadonlyMap<string, number> {
  const styles = new Map<string, StyleEntry>()
  let current: { id: string; level: number | undefined; basedOn: string | undefined } | undefined
  if (xml !== undefined) {
    walkXml(xml, {
      open: (name, attrs) => {
        if (name === 'style') {
          current = attr(attrs, 'type') === 'paragraph' ? { id: attr(attrs, 'styleId') ?? '', level: undefined, basedOn: undefined } : undefined
          return
        }
        if (current === undefined) return
        if (name === 'name') {
          const label = attr(attrs, 'val') ?? ''
          const heading = /^(?:heading|标题)\s*(\d)$/i.exec(label)
          if (heading !== null) current.level = Number(heading[1])
          else if (/^(?:title|标题)$/i.test(label)) current.level = 1
        } else if (name === 'outlineLvl' && current.level === undefined) {
          const outline = Number(attr(attrs, 'val'))
          if (outline >= 0 && outline < 9) current.level = outline + 1
        } else if (name === 'basedOn') current.basedOn = attr(attrs, 'val')
      },
      close: (name) => {
        if (name !== 'style' || current === undefined) return
        styles.set(current.id, { level: current.level, basedOn: current.basedOn })
        current = undefined
      },
    })
  }
  const levels = new Map<string, number>()
  for (const id of styles.keys()) {
    let style = styles.get(id)
    for (let hops = 0; style !== undefined && style.level === undefined && style.basedOn !== undefined && hops < 10; hops += 1) style = styles.get(style.basedOn)
    if (style?.level !== undefined) levels.set(id, style.level)
  }
  return levels
}

interface Paragraph {
  readonly texts: string[]
  style: string | undefined
  outline: number | undefined
  list: boolean
  level: number
}

interface TableDraft {
  readonly rows: string[][]
  row: string[] | undefined
  cell: string[] | undefined
}

const LIST_ITEM = /^\s*- /

/** 连着的列表项挨在一起，其余块之间空一行。 */
function joinBlocks(blocks: readonly string[]): string {
  return blocks.reduce((joined, block, index) => {
    if (index === 0) return block
    const previous = blocks[index - 1] ?? ''
    return `${joined}${LIST_ITEM.test(previous) && LIST_ITEM.test(block) ? '\n' : '\n\n'}${block}`
  }, '')
}

/** Word（.docx）：正文段落、标题、列表和表格；文本框里的字也算。图片只留一个 [图片] 记号。 */
export function extractDocx(zip: ZipArchive): Extracted {
  const part = mainPart(zip, 'word/document.xml')
  const xml = zip.text(part)
  if (xml === undefined) throw new Error(t('找不到 Word 的正文'))
  const levels = headingLevels(zip.text(relatedOfType(relationships(zip, part), '/styles') ?? 'word/styles.xml'))
  const blocks: string[] = []
  const paragraphs: Paragraph[] = []
  let draft: TableDraft | undefined
  let tableDepth = 0
  let tables = 0
  let pictures = 0
  let runDepth = 0
  let inText = false
  const emit = (text: string): void => {
    if (draft?.cell !== undefined) draft.cell.push(text)
    else blocks.push(text)
  }
  const render = (paragraph: Paragraph): string | undefined => {
    const text = paragraph.texts.join('').replace(/[ \t]+$/gm, '').trim()
    if (text === '') return undefined
    if (draft?.cell !== undefined) return text
    const level = paragraph.outline !== undefined && paragraph.outline < 9 ? paragraph.outline + 1 : paragraph.style === undefined ? undefined : levels.get(paragraph.style)
    if (level !== undefined) return `${'#'.repeat(Math.min(6, level + 1))} ${text.replace(/\s+/g, ' ')}`
    return paragraph.list ? `${'  '.repeat(Math.min(paragraph.level, 8))}- ${text}` : text
  }
  walkXml(xml, {
    open: (name, attrs) => {
      const paragraph = paragraphs.at(-1)
      switch (name) {
        case 'p':
          paragraphs.push({ texts: [], style: undefined, outline: undefined, list: false, level: 0 })
          break
        case 'pStyle':
          if (paragraph !== undefined) paragraph.style = attr(attrs, 'val')
          break
        case 'outlineLvl':
          if (paragraph !== undefined) paragraph.outline = Number(attr(attrs, 'val'))
          break
        case 'numPr':
          if (paragraph !== undefined) paragraph.list = true
          break
        case 'ilvl':
          if (paragraph !== undefined) paragraph.level = Number(attr(attrs, 'val') ?? 0) || 0
          break
        case 'r':
          runDepth += 1
          break
        case 't':
          inText = true
          break
        case 'tab':
          if (runDepth > 0) paragraph?.texts.push('\t')
          break
        case 'br':
        case 'cr':
          if (runDepth > 0) paragraph?.texts.push('\n')
          break
        case 'noBreakHyphen':
          if (runDepth > 0) paragraph?.texts.push('-')
          break
        case 'pic':
        case 'imagedata':
          pictures += 1
          paragraph?.texts.push(t('[图片]'))
          break
        case 'tbl':
          tableDepth += 1
          if (tableDepth === 1) {
            draft = { rows: [], row: undefined, cell: undefined }
            tables += 1
          }
          break
        case 'tr':
          if (tableDepth === 1 && draft !== undefined) draft.row = []
          break
        case 'tc':
          if (tableDepth === 1 && draft !== undefined) draft.cell = []
          break
        default:
          break
      }
    },
    close: (name) => {
      switch (name) {
        case 't':
          inText = false
          break
        case 'r':
          runDepth = Math.max(0, runDepth - 1)
          break
        case 'p': {
          const paragraph = paragraphs.pop()
          const text = paragraph === undefined ? undefined : render(paragraph)
          if (text !== undefined) emit(text)
          break
        }
        case 'tc':
          if (tableDepth === 1 && draft?.cell !== undefined) {
            draft.row?.push(draft.cell.join(' '))
            draft.cell = undefined
          }
          break
        case 'tr':
          if (tableDepth === 1 && draft?.row !== undefined) {
            draft.rows.push(draft.row)
            draft.row = undefined
          }
          break
        case 'tbl':
          if (tableDepth === 1 && draft !== undefined && draft.rows.length > 0) blocks.push(table(draft.rows))
          if (tableDepth === 1) draft = undefined
          tableDepth = Math.max(0, tableDepth - 1)
          break
        default:
          break
      }
    },
    text: (value) => {
      if (inText) paragraphs.at(-1)?.texts.push(value)
    },
  })
  const parts = [tables > 0 ? t('{tables} 个表格', { tables }) : '', pictures > 0 ? t('{pictures} 张图片', { pictures }) : ''].filter((item) => item !== '')
  return {
    body: joinBlocks(blocks),
    note: t('由 dsh-bot 从 Word 文档自动转出；图片、批注、页眉页脚和排版没有保留。'),
    summary: parts.length === 0 ? '' : t('含 {parts}', { parts: parts.join(t('、')) }),
  }
}
