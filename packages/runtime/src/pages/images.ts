import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, resolve } from 'node:path'
import { PAGE_IMAGE_MAX_BYTES, allBlocks, mapBlocks, type PageDoc } from 'pod-domain'
import type { PageAsset } from 'pod-store'

/** 页面里能用的图片格式（按扩展名认，再核对文件头）。 */
const TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

export interface ImageScope {
  readonly workspaceRoot: string
  /** 相对路径依次在这些文件夹里找：会话的文件夹，然后是工作区根目录。 */
  readonly folders: readonly string[]
  /** 这个页面已经存过这张图（asset:哈希）。新页面一张都没有。 */
  readonly has: (hash: string) => boolean
}

export type ImageResult = { readonly ok: true; readonly doc: PageDoc; readonly assets: readonly PageAsset[] } | { readonly ok: false; readonly errors: readonly string[] }

function matches(data: Uint8Array, mime: string): boolean {
  const starts = (...bytes: readonly number[]): boolean => bytes.every((byte, index) => data[index] === byte)
  switch (mime) {
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47)
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff)
    case 'image/gif':
      return starts(0x47, 0x49, 0x46, 0x38)
    case 'image/webp':
      return starts(0x52, 0x49, 0x46, 0x46) && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
    case 'image/svg+xml':
      return /<svg[\s>]/i.test(new TextDecoder().decode(data.subarray(0, 4096)))
    default:
      return false
  }
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

async function load(src: string, scope: ImageScope, root: string): Promise<PageAsset | string> {
  const extension = extname(src).toLowerCase()
  const mime = TYPES[extension]
  if (mime === undefined) return `「${src}」不是页面能用的图片（支持 PNG、JPG、GIF、WebP、SVG）`
  const candidates = isAbsolute(src) ? [src] : scope.folders.map((folder) => join(folder, src))
  for (const candidate of candidates) {
    const real = await realpath(candidate).catch(() => undefined)
    if (real === undefined || !inside(root, real)) continue
    const info = await stat(real).catch(() => undefined)
    if (info === undefined || !info.isFile()) continue
    if (info.size > PAGE_IMAGE_MAX_BYTES) return `「${src}」有 ${(info.size / 1_048_576).toFixed(1)} MB，一张图最多 ${PAGE_IMAGE_MAX_BYTES / 1_048_576} MB`
    const data = new Uint8Array(await readFile(real))
    if (!matches(data, mime)) return `「${src}」的内容和扩展名对不上，不像 ${extension.slice(1).toUpperCase()} 图片`
    return { hash: createHash('sha256').update(data).digest('hex').slice(0, 24), mime, data }
  }
  return `找不到图片「${src}」，或者它不在工作区里（相对路径先按你的文件夹找，再按工作区根目录找）`
}

/** 页面内容里用到的已存图片（asset:哈希）。 */
export function assetHashes(doc: PageDoc): readonly string[] {
  return [...new Set(allBlocks(doc).flatMap((block) => (block.type === 'image' && block.src.startsWith('asset:') ? [block.src.slice(6)] : [])))]
}

/**
 * 把 image 组件里写的工作区文件路径换成页面自己存的图片（asset:哈希）。
 * 页面不联网，所以不收网址；图片跟着页面存一份，原文件之后改了删了，页面和旧版本都不受影响。
 */
export async function resolveImages(doc: PageDoc, scope: ImageScope): Promise<ImageResult> {
  const root = await realpath(scope.workspaceRoot).catch(() => resolve(scope.workspaceRoot))
  const sources = [...new Set(allBlocks(doc).flatMap((block) => (block.type === 'image' && block.src !== '' && !block.src.startsWith('asset:') ? [block.src] : [])))]
  const errors: string[] = []
  const loaded = new Map<string, PageAsset>()
  for (const src of sources) {
    if (/^(https?:)?\/\//i.test(src)) errors.push(`图片「${src.slice(0, 80)}」是网址：页面不联网，先把图片下载到工作区，再写文件路径`)
    else if (src.startsWith('data:')) errors.push('图片不能直接写 data: 数据，先存成工作区里的文件，再写文件路径')
    else {
      const result = await load(src, scope, root)
      if (typeof result === 'string') errors.push(result)
      else loaded.set(src, result)
    }
  }
  for (const hash of assetHashes(doc)) {
    if (!scope.has(hash)) errors.push(`asset:${hash} 不是这个页面里的图片；新图片写工作区里的文件路径`)
  }
  if (errors.length > 0) return { ok: false, errors }
  const next = mapBlocks(doc, (block) => {
    if (block.type !== 'image') return block
    const asset = loaded.get(block.src)
    return asset === undefined ? block : { ...block, src: `asset:${asset.hash}` }
  })
  const unique = new Map([...loaded.values()].map((asset) => [asset.hash, asset]))
  return { ok: true, doc: next, assets: [...unique.values()] }
}
