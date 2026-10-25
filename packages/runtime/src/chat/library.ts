import { readdir, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

/** 资料库里的一项：对话里产出的文档、截图、网页存档和你上传的文件。 */
export interface LibraryItem {
  readonly name: string
  /** 相对工作区的路径，预览用 /api/pod/file。 */
  readonly path: string
  readonly size: number
  readonly modifiedAt: number
  readonly kind: 'image' | 'doc' | 'web' | 'file'
}

const IMAGES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'])
const DOCS = new Set(['.md', '.txt', '.pdf', '.doc', '.docx', '.csv', '.xlsx', '.xls', '.pptx', '.json', '.html', '.htm'])
const MAX_ITEMS = 100
const MAX_DEPTH = 4

function kindOf(path: string): LibraryItem['kind'] {
  const extension = extname(path).toLowerCase()
  if (IMAGES.has(extension)) return 'image'
  if (path.includes('网页存档') || path.includes('web-archive')) return 'web'
  return DOCS.has(extension) ? 'doc' : 'file'
}

async function walk(root: string, dir: string, depth: number, found: Map<string, LibraryItem>): Promise<void> {
  if (depth > MAX_DEPTH || found.size >= MAX_ITEMS * 4) return
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(root, full, depth + 1, found)
      continue
    }
    if (!entry.isFile()) continue
    const info = await stat(full).catch(() => undefined)
    if (info === undefined) continue
    const path = relative(root, full)
    found.set(path, { name: entry.name, path, size: info.size, modifiedAt: info.mtimeMs, kind: kindOf(path) })
  }
}

/** 列出几个工作区文件夹里的文件，按修改时间从新到旧，最多 100 个。文件夹是相对工作区的路径。 */
export async function listLibrary(workspaceRoot: string, folders: readonly string[]): Promise<readonly LibraryItem[]> {
  const found = new Map<string, LibraryItem>()
  for (const folder of new Set(folders.filter((item) => item !== '' && !item.includes('..')))) {
    await walk(workspaceRoot, join(workspaceRoot, folder), 0, found)
  }
  return [...found.values()].sort((left, right) => right.modifiedAt - left.modifiedAt).slice(0, MAX_ITEMS)
}
