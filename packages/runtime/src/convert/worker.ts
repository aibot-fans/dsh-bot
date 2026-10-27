/**
 * 文字版转换的 worker 线程：每次转换起一个，转完把文字版写到 target，交回字数和概况就退出。
 * 放在单独的线程里，转大表格、大 PDF 时 dsh web 照常响应。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { addEnglish, setLanguage, t, type Language } from 'pod-domain'
import { RUNTIME_EN } from '../locales/en.ts'
import { extractDocument } from './extract.ts'
import { ConvertError, type ConvertReply, type DocumentFormat } from './formats.ts'
import { countChars, textDocument } from './markdown.ts'

interface Job {
  readonly source: string
  readonly target: string
  readonly name: string
  readonly format: DocumentFormat
  /** 宿主现在的界面语言：worker 是单独的线程，要自己登记译文、切语言。 */
  readonly language: Language
}

async function convert(job: Job): Promise<ConvertReply> {
  try {
    const extracted = await extractDocument(job.source, job.format)
    const note = extracted.warning === undefined ? extracted.note : `${extracted.note}${extracted.warning}`
    await mkdir(dirname(job.target), { recursive: true })
    await writeFile(job.target, textDocument(job.name, note, extracted.body))
    return { ok: true, chars: countChars(extracted.body), summary: extracted.summary, ...(extracted.warning === undefined ? {} : { warning: extracted.warning }) }
  } catch (error) {
    return { ok: false, reason: error instanceof ConvertError ? error.message : t('文件读不出来，可能已经损坏') }
  }
}

const job = workerData as Job
addEnglish(RUNTIME_EN)
setLanguage(job.language)
void convert(job).then((reply) => parentPort?.postMessage(reply))
