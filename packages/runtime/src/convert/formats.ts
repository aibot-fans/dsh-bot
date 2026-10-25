import { extname } from 'node:path'

/** 能转成文字版的几种文件；老版的 .xls、.ppt 认得出来，但只能告诉你转不了。 */
export type DocumentFormat = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'textutil' | 'old-excel' | 'old-ppt'

const FORMATS: Readonly<Record<string, DocumentFormat>> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.docm': 'docx',
  '.dotx': 'docx',
  '.xlsx': 'xlsx',
  '.xlsm': 'xlsx',
  '.xltx': 'xlsx',
  '.pptx': 'pptx',
  '.pptm': 'pptx',
  '.ppsx': 'pptx',
  '.potx': 'pptx',
  '.doc': 'textutil',
  '.rtf': 'textutil',
  '.odt': 'textutil',
  '.xls': 'old-excel',
  '.ppt': 'old-ppt',
}

export function documentFormat(name: string): DocumentFormat | undefined {
  return FORMATS[extname(name).toLowerCase()]
}

/** 说得清原因的失败（有密码、老格式、文件坏了）；其他异常统一说“读不出来”。 */
export class ConvertError extends Error {}

/** 一种格式抽出来的内容。 */
export interface Extracted {
  /** 文字版正文（Markdown），开头的标题和说明由调用方加。 */
  readonly body: string
  /** 写在文字版开头的说明：从什么转来的、丢了什么。 */
  readonly note: string
  /** 概况，比如“共 12 页”；没有就留空。 */
  readonly summary: string
  /** 要提醒的事，比如 PDF 几乎没有文字（可能是扫描件）。 */
  readonly warning?: string
}

/** worker 交回来的结果：成功时文字版已经写好。 */
export type ConvertReply =
  | { readonly ok: true; readonly chars: number; readonly summary: string; readonly warning?: string }
  | { readonly ok: false; readonly reason: string }
