import { open, realpath, stat, readFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { t } from 'pod-domain'
import type { FetchRoute } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { POD_API_PREFIX } from './router.ts'

const IMAGES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}
const MEDIA: Readonly<Record<string, string>> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
}
const PDF = 'application/pdf'
const TEXT = 'text/plain; charset=utf-8'
const MAX_TEXT = 5 * 1024 * 1024
const MAX_IMAGE = 15 * 1024 * 1024
const MAX_WHOLE = 100 * 1024 * 1024
/** 音视频按段给：浏览器拖进度条时要哪段给哪段，一次最多 4 MB。 */
const MEDIA_CHUNK = 4 * 1024 * 1024
/** 不在 dsh 的页面里执行任何东西：HTML、SVG 直接打开也在沙箱里。 */
const SANDBOX = "default-src 'none'; sandbox"

interface Found {
  readonly path: string
  readonly size: number
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

function plain(status: number, text: string): Response {
  return new Response(text, { status, headers: { 'content-type': TEXT } })
}

/** 只认工作区里的文件（按真实路径判断，符号链接指到外面也不行）；相对路径先按工作区找，再按任务文件夹找。 */
async function locate(pod: PodRuntime, raw: string, taskId: string | null): Promise<Found | undefined> {
  const root = await realpath(pod.workspaceRoot).catch(() => resolve(pod.workspaceRoot))
  const task = taskId === null ? undefined : pod.tasks.get(taskId)
  const candidates = isAbsolute(raw) ? [raw] : [join(root, raw), ...(task === undefined ? [] : [join(root, task.folder, raw)])]
  for (const candidate of candidates) {
    const real = await realpath(candidate).catch(() => undefined)
    if (real === undefined || !inside(root, real)) continue
    const info = await stat(real).catch(() => undefined)
    if (info !== undefined && info.isFile()) return { path: real, size: info.size }
  }
  return undefined
}

async function whole(file: Found, type: string, max: number, extra: Readonly<Record<string, string>>): Promise<Response> {
  if (file.size > max) return plain(413, t('文件太大，不能预览'))
  const data = await readFile(file.path)
  return new Response(new Uint8Array(data), { status: 200, headers: { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } })
}

/** Range: bytes=开始-结束，只认一段；没写或写不对就当整份要。 */
function rangeOf(header: string | null, total: number): { readonly start: number; readonly end: number } | 'invalid' | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '')
  if (match === null || (match[1] === '' && match[2] === '')) return undefined
  const from = match[1] ?? ''
  const to = match[2] ?? ''
  const start = from === '' ? Math.max(0, total - Number(to)) : Number(from)
  const end = from === '' || to === '' ? total - 1 : Math.min(Number(to), total - 1)
  return start <= end ? { start, end } : 'invalid'
}

async function slice(path: string, start: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const handle = await open(path, 'r')
  try {
    const buffer = new Uint8Array(length)
    const { bytesRead } = await handle.read(buffer, 0, length, start)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** 音视频：浏览器带 Range 来要一段就给一段（206），这样能拖进度条，大文件也不用整个读进内存。 */
async function media(file: Found, type: string, header: string | null): Promise<Response> {
  const range = rangeOf(header, file.size)
  if (range === 'invalid') return new Response(null, { status: 416, headers: { 'content-range': `bytes */${file.size}` } })
  if (range === undefined) return whole(file, type, MAX_WHOLE, { 'accept-ranges': 'bytes', 'content-security-policy': SANDBOX })
  const end = Math.min(range.end, range.start + MEDIA_CHUNK - 1)
  const data = await slice(file.path, range.start, end - range.start + 1)
  return new Response(data, {
    status: 206,
    headers: {
      'content-type': type,
      'content-range': `bytes ${range.start}-${range.start + data.byteLength - 1}/${file.size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': SANDBOX,
    },
  })
}

/** 太大的文字文件（比如大表格的文字版）只给开头 5 MB，截在最后一个换行处；x-pod-partial 写原文件大小，页面据此提示去下载完整的。 */
async function textHead(file: Found): Promise<Response> {
  const data = await slice(file.path, 0, MAX_TEXT)
  const cut = data.lastIndexOf(0x0a)
  return new Response(cut > 0 ? data.subarray(0, cut + 1) : data, {
    status: 200,
    headers: { 'content-type': TEXT, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': SANDBOX, 'x-pod-partial': String(file.size) },
  })
}

/** 下载用的文件名：中文和空格按 RFC 5987 编码。 */
function attachmentName(path: string): string {
  const encoded = encodeURIComponent(basename(path)).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename*=UTF-8''${encoded}`
}

/**
 * 产物预览和下载：只能读工作区里的文件。
 * 图片、音视频按原格式返回；PDF 交给浏览器自带的阅读器（它在沙箱里打不开，所以不加沙箱）；
 * 其余一律当纯文本返回（HTML 不在 dsh 的页面里执行，由预览框放进沙箱），超过 5 MB 的只给开头。download=1 时按原样下载。
 */
export function fileRoute(pod: PodRuntime): FetchRoute {
  return {
    path: `${POD_API_PREFIX}/file`,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const params = new URL(request.url).searchParams
      const file = await locate(pod, params.get('path') ?? '', params.get('taskId'))
      if (file === undefined) return plain(404, t('找不到这个文件，或者它不在工作区里'))
      const extension = extname(file.path).toLowerCase()
      const known = IMAGES[extension] ?? MEDIA[extension] ?? (extension === '.pdf' ? PDF : undefined)
      if (params.get('download') === '1') return whole(file, known ?? 'application/octet-stream', MAX_WHOLE, { 'content-disposition': attachmentName(file.path), 'content-security-policy': SANDBOX })
      const audioOrVideo = MEDIA[extension]
      if (audioOrVideo !== undefined) return media(file, audioOrVideo, request.headers.get('range'))
      if (extension === '.pdf') return whole(file, PDF, MAX_WHOLE, { 'content-disposition': 'inline' })
      const image = IMAGES[extension]
      if (image !== undefined) return whole(file, image, MAX_IMAGE, { 'content-security-policy': SANDBOX })
      return file.size > MAX_TEXT ? textHead(file) : whole(file, TEXT, MAX_TEXT, { 'content-security-policy': SANDBOX })
    },
  }
}
