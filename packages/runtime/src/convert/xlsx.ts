import { columnIndex, dateStyles, formatNumber, formatSerial, unescapeExcel } from './cells.ts'
import { ConvertError, type Extracted } from './formats.ts'
import { table } from './markdown.ts'
import { mainPart, relatedOfType, relationships } from './opc.ts'
import { attr, relationId, walkXml } from './xml.ts'
import type { ZipArchive } from './zip.ts'

interface SheetRef {
  readonly name: string
  readonly target: string | undefined
  readonly hidden: boolean
}

interface Workbook {
  readonly sheets: readonly SheetRef[]
  readonly date1904: boolean
}

interface CellDraft {
  readonly column: number
  readonly type: string
  readonly style: number
  value: string
  formula: string
  readonly inline: string[]
}

type Row = readonly (readonly [number, string])[]

function readWorkbook(zip: ZipArchive, part: string): Workbook {
  const xml = zip.text(part)
  if (xml === undefined) throw new ConvertError('找不到 Excel 的工作表列表')
  const relations = relationships(zip, part)
  const sheets: SheetRef[] = []
  let date1904 = false
  walkXml(xml, {
    open: (name, attrs) => {
      if (name === 'workbookPr') date1904 = ['1', 'true'].includes(attr(attrs, 'date1904') ?? '')
      else if (name === 'sheet') {
        sheets.push({
          name: attr(attrs, 'name') ?? `Sheet${sheets.length + 1}`,
          target: relations.get(relationId(attrs) ?? '')?.target,
          hidden: (attr(attrs, 'state') ?? 'visible') !== 'visible',
        })
      }
    },
  })
  return { sheets, date1904 }
}

/** 共享字符串表：单元格里 t="s" 的值是这里的下标。注音（rPh）不要。 */
function sharedStrings(xml: string | undefined): readonly string[] {
  const strings: string[] = []
  if (xml === undefined) return strings
  let parts: string[] | undefined
  let phonetic = 0
  let inText = false
  walkXml(xml, {
    open: (name) => {
      if (name === 'si') parts = []
      else if (name === 'rPh') phonetic += 1
      else if (name === 't') inText = true
    },
    close: (name) => {
      if (name === 'si') {
        strings.push(unescapeExcel(parts?.join('') ?? ''))
        parts = undefined
      } else if (name === 'rPh') phonetic = Math.max(0, phonetic - 1)
      else if (name === 't') inText = false
    },
    text: (value) => {
      if (inText && phonetic === 0) parts?.push(value)
    },
  })
  return strings
}

interface SheetContext {
  readonly strings: readonly string[]
  readonly dates: readonly boolean[]
  readonly date1904: boolean
}

function display(cell: CellDraft, context: SheetContext): string {
  switch (cell.type) {
    case 's':
      return context.strings[Number(cell.value)] ?? ''
    case 'inlineStr':
      return unescapeExcel(cell.inline.join(''))
    case 'str':
      return unescapeExcel(cell.value)
    case 'b':
      return cell.value === '1' ? 'TRUE' : cell.value === '0' ? 'FALSE' : cell.value
    case 'e':
    case 'd':
      return cell.value
    default: {
      // 没有算好的值（有些程序生成的表只存公式）就把公式写出来。
      if (cell.value.trim() === '') return cell.formula === '' ? '' : `=${cell.formula}`
      const date = context.dates[cell.style] === true ? formatSerial(Number(cell.value), context.date1904) : undefined
      return date ?? formatNumber(cell.value)
    }
  }
}

/** 一个工作表里有值的行；每行是（列号, 显示的值）。 */
function readRows(xml: string, context: SheetContext): readonly Row[] {
  const rows: Row[] = []
  let cells: (readonly [number, string])[] = []
  let cell: CellDraft | undefined
  let column = -1
  let field: 'value' | 'formula' | 'inline' | undefined
  let inInline = false
  let phonetic = 0
  walkXml(xml, {
    open: (name, attrs) => {
      switch (name) {
        case 'row':
          cells = []
          column = -1
          break
        case 'c': {
          const ref = attr(attrs, 'r')
          column = (ref === undefined ? undefined : columnIndex(ref)) ?? column + 1
          cell = { column, type: attr(attrs, 't') ?? 'n', style: Number(attr(attrs, 's') ?? 0), value: '', formula: '', inline: [] }
          break
        }
        case 'v':
          field = 'value'
          break
        case 'f':
          field = 'formula'
          break
        case 'is':
          inInline = true
          break
        case 'rPh':
          phonetic += 1
          break
        case 't':
          if (inInline) field = 'inline'
          break
        default:
          break
      }
    },
    close: (name) => {
      switch (name) {
        case 'v':
        case 'f':
        case 't':
          field = undefined
          break
        case 'is':
          inInline = false
          break
        case 'rPh':
          phonetic = Math.max(0, phonetic - 1)
          break
        case 'c':
          if (cell !== undefined) {
            const shown = display(cell, context)
            if (shown.trim() !== '') cells.push([cell.column, shown])
          }
          cell = undefined
          break
        case 'row':
          if (cells.length > 0) rows.push(cells)
          cells = []
          break
        default:
          break
      }
    },
    text: (value) => {
      if (cell === undefined || field === undefined) return
      if (field === 'value') cell.value += value
      else if (field === 'formula') cell.formula += value
      else if (phonetic === 0) cell.inline.push(value)
    },
  })
  return rows
}

/** 去掉左边整列都空的部分，按列号排成表格。 */
function renderRows(rows: readonly Row[]): { readonly text: string; readonly width: number } {
  let first = Number.POSITIVE_INFINITY
  let last = -1
  for (const row of rows) {
    for (const [column] of row) {
      first = Math.min(first, column)
      last = Math.max(last, column)
    }
  }
  const width = last - first + 1
  const grid = rows.map((row) => {
    const byColumn = new Map(row)
    return Array.from({ length: width }, (_, index) => byColumn.get(first + index) ?? '')
  })
  return { text: table(grid), width }
}

/** Excel（.xlsx）：每个工作表一张 Markdown 表格，公式只留算好的值，日期按单元格格式转成年月日。 */
export function extractXlsx(zip: ZipArchive): Extracted {
  const part = mainPart(zip, 'xl/workbook.xml')
  const workbook = readWorkbook(zip, part)
  const relations = relationships(zip, part)
  const context: SheetContext = {
    strings: sharedStrings(zip.text(relatedOfType(relations, '/sharedStrings') ?? 'xl/sharedStrings.xml')),
    dates: dateStyles(zip.text(relatedOfType(relations, '/styles') ?? 'xl/styles.xml')),
    date1904: workbook.date1904,
  }
  const sections = workbook.sheets.map((sheet) => {
    const hidden = sheet.hidden ? '，隐藏' : ''
    const xml = sheet.target === undefined || sheet.target.includes('chartsheets/') ? undefined : zip.text(sheet.target)
    if (xml === undefined) return `## 工作表「${sheet.name}」\n\n（图表页或读不到的工作表，没有表格数据）`
    const rows = readRows(xml, context)
    if (rows.length === 0) return `## 工作表「${sheet.name}」（空${hidden}）`
    const rendered = renderRows(rows)
    return `## 工作表「${sheet.name}」（${rows.length} 行 × ${rendered.width} 列${hidden}）\n\n${rendered.text}`
  })
  return {
    body: sections.join('\n\n'),
    note: '由 Pod 从 Excel 表格自动转出；每个工作表一张表，第一行当表头，空行省掉了；公式只留算好的值，格式、图表和图片没有保留。',
    summary: `共 ${workbook.sheets.length} 个工作表`,
  }
}
