import { ConvertError, type Extracted } from './formats.ts'
import { table } from './markdown.ts'
import { mainPart, relatedOfType, relationships } from './opc.ts'
import { attr, relationId, walkXml } from './xml.ts'
import type { ZipArchive } from './zip.ts'

interface Line {
  readonly text: string
  readonly level: number
}

type Item = { readonly kind: 'shape'; readonly placeholder: string | undefined; readonly lines: readonly Line[] } | { readonly kind: 'table'; readonly markdown: string }

interface Slide {
  readonly items: readonly Item[]
  readonly pictures: number
  readonly charts: number
  readonly hidden: boolean
}

interface ShapeDraft {
  placeholder: string | undefined
  readonly lines: Line[]
}

interface TableDraft {
  readonly rows: string[][]
  row: string[] | undefined
  cell: string[] | undefined
}

const TITLES = new Set(['title', 'ctrTitle'])
/** 页码、日期、页脚每页都一样，不写进文字版。 */
const SKIPPED = new Set(['sldNum', 'dt', 'ftr', 'hdr', 'sldImg'])

/** 一页幻灯片（或备注页）里的文字框和表格，按出现的顺序。 */
function readSlide(xml: string): Slide {
  const items: Item[] = []
  const shapes: ShapeDraft[] = []
  let draft: TableDraft | undefined
  let paragraph: { readonly texts: string[]; level: number } | undefined
  let inText = false
  let pictures = 0
  let charts = 0
  let hidden = false
  walkXml(xml, {
    open: (name, attrs) => {
      switch (name) {
        case 'sld':
          hidden = attr(attrs, 'show') === '0'
          break
        case 'sp':
          shapes.push({ placeholder: undefined, lines: [] })
          break
        case 'ph': {
          const shape = shapes.at(-1)
          if (shape !== undefined) shape.placeholder = attr(attrs, 'type') ?? 'body'
          break
        }
        case 'p':
          paragraph = { texts: [], level: 0 }
          break
        case 'pPr':
          if (paragraph !== undefined) paragraph.level = Number(attr(attrs, 'lvl') ?? 0) || 0
          break
        case 't':
          inText = true
          break
        case 'br':
          paragraph?.texts.push('\n')
          break
        case 'pic':
          pictures += 1
          break
        case 'chart':
          charts += 1
          break
        case 'tbl':
          draft = { rows: [], row: undefined, cell: undefined }
          break
        case 'tr':
          if (draft !== undefined) draft.row = []
          break
        case 'tc':
          if (draft !== undefined) draft.cell = []
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
        case 'p': {
          const text = paragraph?.texts.join('').trim() ?? ''
          if (text !== '' && paragraph !== undefined) {
            if (draft?.cell !== undefined) draft.cell.push(text)
            else shapes.at(-1)?.lines.push({ text, level: paragraph.level })
          }
          paragraph = undefined
          break
        }
        case 'sp': {
          const shape = shapes.pop()
          if (shape !== undefined && shape.lines.length > 0) items.push({ kind: 'shape', placeholder: shape.placeholder, lines: shape.lines })
          break
        }
        case 'tc':
          if (draft?.cell !== undefined) {
            draft.row?.push(draft.cell.join(' '))
            draft.cell = undefined
          }
          break
        case 'tr':
          if (draft?.row !== undefined) {
            draft.rows.push(draft.row)
            draft.row = undefined
          }
          break
        case 'tbl':
          if (draft !== undefined && draft.rows.length > 0) items.push({ kind: 'table', markdown: table(draft.rows) })
          draft = undefined
          break
        default:
          break
      }
    },
    text: (value) => {
      if (inText) paragraph?.texts.push(value)
    },
  })
  return { items, pictures, charts, hidden }
}

function shapeText(item: Item): string {
  if (item.kind === 'table') return item.markdown
  return item.lines.map((line) => `${'  '.repeat(Math.min(line.level, 8))}- ${line.text.replace(/\n+/g, ' ')}`).join('\n')
}

function notesOf(zip: ZipArchive, slidePart: string): string {
  const notesPart = relatedOfType(relationships(zip, slidePart), '/notesSlide')
  const xml = notesPart === undefined ? undefined : zip.text(notesPart)
  if (xml === undefined) return ''
  const lines = readSlide(xml).items.flatMap((item) => (item.kind === 'shape' && item.placeholder === 'body' ? item.lines.map((line) => line.text) : []))
  return lines.length === 0 ? '' : lines.map((line, index) => `> ${index === 0 ? '备注：' : ''}${line}`).join('\n')
}

function renderSlide(slide: Slide, number: number, notes: string): string {
  const title = slide.items
    .flatMap((item) => (item.kind === 'shape' && item.placeholder !== undefined && TITLES.has(item.placeholder) ? item.lines.map((line) => line.text) : []))
    .join(' ')
    .replace(/\s+/g, ' ')
  const body = slide.items
    .filter((item) => item.kind === 'table' || item.placeholder === undefined || (!TITLES.has(item.placeholder) && !SKIPPED.has(item.placeholder)))
    .map(shapeText)
  const visuals = [slide.pictures > 0 ? `${slide.pictures} 张图片` : '', slide.charts > 0 ? `${slide.charts} 个图表` : ''].filter((item) => item !== '')
  const parts = [
    `## 第 ${number} 页${title === '' ? '' : `：${title}`}${slide.hidden ? '（隐藏）' : ''}`,
    ...(body.length === 0 && visuals.length === 0 ? ['（这页没有文字）'] : body),
    ...(visuals.length === 0 ? [] : [`（这页还有 ${visuals.join('、')}，文字版里没有）`]),
    ...(notes === '' ? [] : [notes]),
  ]
  return parts.join('\n\n')
}

/** PPT（.pptx）：按放映顺序，每页的标题、文字、表格和备注。 */
export function extractPptx(zip: ZipArchive): Extracted {
  const part = mainPart(zip, 'ppt/presentation.xml')
  const xml = zip.text(part)
  if (xml === undefined) throw new ConvertError('找不到 PPT 的幻灯片列表')
  const relations = relationships(zip, part)
  const slideParts: string[] = []
  walkXml(xml, {
    open: (name, attrs) => {
      if (name !== 'sldId') return
      const target = relations.get(relationId(attrs) ?? '')?.target
      if (target !== undefined) slideParts.push(target)
    },
  })
  const slides = slideParts.map((slidePart, index) => {
    const slideXml = zip.text(slidePart)
    return slideXml === undefined ? `## 第 ${index + 1} 页\n\n（读不到这一页）` : renderSlide(readSlide(slideXml), index + 1, notesOf(zip, slidePart))
  })
  return {
    body: slides.join('\n\n'),
    note: '由 Pod 从 PPT 自动转出；按放映顺序写出每页的标题、文字、表格和备注，图片、图表和动画没有保留。',
    summary: `共 ${slides.length} 页`,
  }
}
