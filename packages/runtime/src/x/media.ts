import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { relative } from 'node:path'
import { XError, detectMediaType, type XMediaInput } from 'aibot-x-post'
import { t } from 'pod-domain'

export type MediaKind = 'image' | 'gif' | 'video'

/**
 * 发推带的一个文件。提交时读过一遍，记下路径、大小、类型和内容的 sha256；
 * 执行时再读一遍，内容和提交时不一样就不发：你批准的就是发出去的。
 */
export interface XMedia {
  /** 工作区里的绝对路径。 */
  readonly path: string
  /** 给人看的名字：相对工作区的路径。 */
  readonly name: string
  readonly size: number
  readonly type: string
  readonly kind: MediaKind
  readonly sha256: string
  /** 说明文字（替代文字）。 */
  readonly alt?: string
}

/** 一条推最多带几个文件（X 网页的发帖框也是 4 个）。 */
export const MEDIA_LIMIT = 4
/** X 收的文件类型。 */
const KINDS: Readonly<Record<string, MediaKind>> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'gif',
  'video/mp4': 'video',
  'video/quicktime': 'video',
}
const ALT_LIMIT = 1000
const KIND_LABELS: Readonly<Record<MediaKind, string>> = { image: '图片', gif: 'GIF 动图', video: '视频' }
/**
 * 读之前先按大小挡掉：文件要整个读进内存再送进浏览器，最多 1 GB。
 * 再往下的大小、时长由 X 按这个账号的上限查（会员的视频能更大），太大的图片 X 会自己压缩。
 */
const READ_LIMIT = 1024 * 1024 * 1024

export function kindLabel(kind: MediaKind): string {
  return t(KIND_LABELS[kind])
}

export function sizeLabel(size: number): string {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`
}

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

async function loadOne(path: string, full: string, alt: string, root: string): Promise<XMedia | string> {
  const info = await stat(full).catch(() => undefined)
  if (info === undefined) return `读不到文件：${path}`
  if (info.size > READ_LIMIT) return `${path} 太大了（${sizeLabel(info.size)}），一个文件最多 1 GB`
  if (info.size === 0) return `${path} 是空文件`
  if ([...alt].length > ALT_LIMIT) return `${path} 的说明文字超过 ${ALT_LIMIT} 字`
  const data = await readFile(full)
  const type = detectMediaType(data)
  const kind = type === undefined ? undefined : KINDS[type]
  if (type === undefined || kind === undefined) return `${path} 不能发到 X：X 收 JPEG、PNG、WebP、GIF、MP4 和 MOV（这个是 ${type ?? '认不出的格式'}）`
  return { path: full, name: relative(root, full), size: data.length, type, kind, sha256: digest(data), ...(alt === '' ? {} : { alt }) }
}

/**
 * 带的文件：把路径换成工作区里的文件，读出来按 X 的要求检查类型、大小和说明文字。
 * alts 按位置对应 paths，空的表示不写说明。返回字符串是给 bot 看的原因。
 */
export async function loadMedia(paths: readonly string[], alts: readonly string[], locate: (path: string) => string | undefined, root: string): Promise<readonly XMedia[] | string> {
  if (paths.length > MEDIA_LIMIT) return `一条推最多带 ${MEDIA_LIMIT} 个文件`
  const located = paths.map((path) => ({ path, full: locate(path) }))
  const outside = located.find((item) => item.full === undefined)
  if (outside !== undefined) return `只能带工作区里已有的文件：${outside.path}`
  const loaded = await Promise.all(located.map((item, index) => loadOne(item.path, item.full ?? '', alts[index]?.trim() ?? '', root)))
  const problem = loaded.find((item): item is string => typeof item === 'string')
  return problem ?? loaded.filter((item): item is XMedia => typeof item !== 'string')
}

/** 执行时按记下的路径再读一遍；不在了或者内容变了就不发。 */
export async function readMedia(media: readonly XMedia[]): Promise<readonly XMediaInput[]> {
  return Promise.all(
    media.map(async (item) => {
      const data = await readFile(item.path).catch(() => undefined)
      if (data === undefined) throw new XError('invalid-input', t('附件 {name} 已经不在了', { name: item.name }))
      if (digest(data) !== item.sha256) throw new XError('invalid-input', t('附件 {name} 在提交以后改过了，没有发', { name: item.name }))
      return { data, type: item.type, ...(item.alt === undefined ? {} : { alt: item.alt }) }
    }),
  )
}
