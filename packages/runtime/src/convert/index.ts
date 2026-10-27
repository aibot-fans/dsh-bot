import { basename, dirname, join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { currentLanguage, t } from 'pod-domain'
import { documentFormat, type ConvertReply } from './formats.ts'

/** 转好的文字版。 */
export interface TextVersion {
  /** 文字版的绝对路径（Markdown）。 */
  readonly path: string
  /** 不算空白的字数。 */
  readonly chars: number
  /** 概况，比如“共 12 页”。 */
  readonly summary: string
  readonly warning?: string
}

export type ConvertOutcome = { readonly ok: true; readonly value: TextVersion } | { readonly ok: false; readonly reason: string }

/** 文字版放在原文件旁边的「文字版」文件夹里，名字是原文件名加 .md（季度报告.pdf → 文字版/季度报告.pdf.md）。 */
export const TEXT_FOLDER = '文字版'
/** worker 最多等两分钟，超时就停掉。 */
const TIMEOUT = 120_000

/** PDF、Word、Excel、PPT（含老版格式，老版的会说明转不了）。 */
export function canConvert(name: string): boolean {
  return documentFormat(name) !== undefined
}

export function textVersionPath(source: string): string {
  return join(dirname(source), TEXT_FOLDER, `${basename(source)}.md`)
}

/** 把文件转成文字版：每次转换起一个 worker 线程（入口是打包后的 convert-worker.js）。 */
export class TextConverter {
  private readonly workerUrl: URL

  constructor(workerUrl: URL) {
    this.workerUrl = workerUrl
  }

  convert(source: string): Promise<ConvertOutcome> {
    const format = documentFormat(source)
    if (format === undefined) return Promise.resolve({ ok: false, reason: t('这种格式不用转') })
    const target = textVersionPath(source)
    return new Promise((resolve) => {
      let settled = false
      const worker = new Worker(this.workerUrl, { workerData: { source, target, name: basename(source), format, language: currentLanguage() } })
      const finish = (outcome: ConvertOutcome): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        void worker.terminate()
        resolve(outcome)
      }
      const timer = setTimeout(() => finish({ ok: false, reason: t('超过两分钟还没转完') }), TIMEOUT)
      worker.on('message', (reply: ConvertReply) => {
        finish(reply.ok ? { ok: true, value: { path: target, chars: reply.chars, summary: reply.summary, ...(reply.warning === undefined ? {} : { warning: reply.warning }) } } : reply)
      })
      worker.on('error', (error) => finish({ ok: false, reason: t('转换出错：{message}', { message: error.message }) }))
      worker.on('exit', () => finish({ ok: false, reason: t('转换中途停了') }))
    })
  }
}
