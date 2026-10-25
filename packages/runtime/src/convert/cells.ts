import { attr, walkXml } from './xml.ts'

/** 内置的日期时间格式编号；27–36、50–58 是中文、日文版 Excel 的日期格式（如 yyyy年m月d日）。 */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])
const DAY = 86_400_000

/** 自定义格式里去掉引号里的字、转义字符和 [颜色]、[$-804] 这类方括号，剩下有年月日时分秒就是日期。 */
function isDateCode(code: string): boolean {
  const cleaned = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '')
  return /[ymdhs]/i.test(cleaned)
}

/** styles.xml 里每种单元格样式是不是日期：单元格的 s 属性是这里的下标。 */
export function dateStyles(xml: string | undefined): readonly boolean[] {
  const flags: boolean[] = []
  if (xml === undefined) return flags
  const custom = new Map<number, string>()
  let inCellFormats = false
  walkXml(xml, {
    open: (name, attrs) => {
      if (name === 'numFmt') custom.set(Number(attr(attrs, 'numFmtId')), attr(attrs, 'formatCode') ?? '')
      else if (name === 'cellXfs') inCellFormats = true
      else if (name === 'xf' && inCellFormats) {
        const id = Number(attr(attrs, 'numFmtId') ?? 0)
        const code = custom.get(id)
        flags.push(code === undefined ? DATE_FORMAT_IDS.has(id) : isDateCode(code))
      }
    },
    close: (name) => {
      if (name === 'cellXfs') inCellFormats = false
    },
  })
  return flags
}

/** Excel 用 _x000D_ 这种写法存控制字符。 */
export function unescapeExcel(text: string): string {
  return text.includes('_x') ? text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))) : text
}

/** 数字按 Excel 的 15 位有效数字显示，免得出现 0.30000000000000004。 */
export function formatNumber(raw: string): string {
  const value = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(value)) return raw
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)))
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 日期序号转成 2024-03-15、2024-03-15 09:30 或 09:30:15。
 * 1900 日期系统沿用 Excel 把 1900 年当闰年的老问题：60 号以后要减一天。
 */
export function formatSerial(serial: number, date1904: boolean): string | undefined {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_466) return undefined
  const days = Math.floor(serial)
  const seconds = Math.round((serial - days) * 86_400)
  const base = date1904 ? Date.UTC(1904, 0, 1) + days * DAY : Date.UTC(1899, 11, 31) + (days >= 60 ? days - 1 : days) * DAY
  const moment = new Date(base + seconds * 1000)
  if (Number.isNaN(moment.getTime())) return undefined
  const date = `${moment.getUTCFullYear()}-${pad(moment.getUTCMonth() + 1)}-${pad(moment.getUTCDate())}`
  const time = `${pad(moment.getUTCHours())}:${pad(moment.getUTCMinutes())}${moment.getUTCSeconds() === 0 ? '' : `:${pad(moment.getUTCSeconds())}`}`
  if (serial < 1) return time
  return seconds === 0 ? date : `${date} ${time}`
}

/** 列号：A → 0，Z → 25，AA → 26。 */
export function columnIndex(ref: string): number | undefined {
  const letters = /^[A-Za-z]+/.exec(ref)?.[0]
  if (letters === undefined) return undefined
  return [...letters.toUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1
}
