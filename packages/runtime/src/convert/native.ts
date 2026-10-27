import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { t } from 'pod-domain'
import { ConvertError, type Extracted } from './formats.ts'
import { countChars } from './markdown.ts'

const run = promisify(execFile)
/** 外部程序最多跑两分钟。 */
const TIMEOUT = 120_000

/**
 * 用 macOS 自带的 PDFKit 逐页取文字（JXA 脚本，路径从参数传进去，不拼进脚本）。
 * 结果写成 JSON 文件，避免大段中文经过标准输出时出编码问题。
 */
const PDF_SCRIPT = `function run(argv) {
  ObjC.import('PDFKit')
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]))
  if (doc.isNil()) return 'broken'
  if (doc.isLocked) return 'locked'
  const pages = []
  for (let index = 0; index < doc.pageCount; index += 1) {
    const text = doc.pageAtIndex(index).string
    pages.push(text.isNil() ? '' : text.js)
  }
  $(JSON.stringify(pages)).writeToFileAtomicallyEncodingError(argv[1], true, $.NSUTF8StringEncoding, null)
  return 'ok'
}`

function requireMac(what: string): void {
  if (process.platform !== 'darwin') throw new ConvertError(t('只有 macOS 上能自动转{what}', { what }))
}

async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'pod-convert-'))
  try {
    return await work(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function failure(error: unknown, what: string): ConvertError {
  const killed = typeof error === 'object' && error !== null && 'killed' in error && error.killed === true
  return new ConvertError(killed ? t('{what}超过两分钟还没转完', { what }) : t('{what}转换失败，文件可能已经损坏', { what }))
}

/** PDF：每页一节。几乎没有文字时提醒可能是扫描件。 */
export async function extractPdf(path: string): Promise<Extracted> {
  requireMac(' PDF')
  return withTempDir(async (dir) => {
    const output = join(dir, 'pages.json')
    const status = await run('osascript', ['-l', 'JavaScript', '-e', PDF_SCRIPT, path, output], { timeout: TIMEOUT }).then(
      (result) => result.stdout.trim(),
      (error: unknown) => {
        throw failure(error, 'PDF ')
      },
    )
    if (status === 'locked') throw new ConvertError(t('PDF 有密码'))
    if (status !== 'ok') throw new ConvertError(t('PDF 打不开，可能已经损坏'))
    const parsed: unknown = JSON.parse(await readFile(output, 'utf8'))
    const pages = Array.isArray(parsed) ? parsed.map((page) => (typeof page === 'string' ? cleanText(page) : '')) : []
    const chars = countChars(pages.join(''))
    const scanned = pages.length > 0 && chars < pages.length * 20
    return {
      body: pages.map((page, index) => t('## 第 {index} 页\n\n{value}', { index: index + 1, value: page === '' ? t('（这页没有文字）') : page })).join('\n\n'),
      note: t('由 dsh-bot 用 macOS 自带的 PDFKit 从 PDF 抽出文字；图片和排版没有保留，表格会变成一行行的文字。'),
      summary: t('共 {length} 页', { length: pages.length }),
      ...(scanned ? { warning: t('这份 PDF 几乎没有文字层，可能是扫描件或图片，文字版里基本没有正文。') } : {}),
    }
  })
}

/** 老版 Word（.doc）、RTF、ODT：交给 macOS 自带的 textutil。 */
export async function extractWithTextutil(path: string): Promise<Extracted> {
  requireMac(t('这种格式'))
  return withTempDir(async (dir) => {
    const output = join(dir, 'text.txt')
    await run('textutil', ['-convert', 'txt', '-encoding', 'UTF-8', '-output', output, path], { timeout: TIMEOUT }).catch((error: unknown) => {
      throw failure(error, '')
    })
    return {
      body: cleanText(await readFile(output, 'utf8')),
      note: t('由 dsh-bot 用 macOS 自带的 textutil 转出；图片和排版没有保留。'),
      summary: '',
    }
  })
}
