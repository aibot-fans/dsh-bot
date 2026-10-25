import { dirname, join } from 'node:path/posix'
import { attr, walkXml } from './xml.ts'
import type { ZipArchive } from './zip.ts'

/** Office 包里部件之间的引用（.rels 文件）：编号 → 目标部件的完整路径和类型。 */
export interface Relationship {
  readonly target: string
  readonly type: string
}

function relsPath(part: string): string {
  const dir = dirname(part)
  const file = part.slice(dir === '.' ? 0 : dir.length + 1)
  return dir === '.' ? `_rels/${file}.rels` : `${dir}/_rels/${file}.rels`
}

/** 读一个部件的引用表；外部链接（网址）不算。 */
export function relationships(zip: ZipArchive, part: string): ReadonlyMap<string, Relationship> {
  const xml = zip.text(relsPath(part))
  const found = new Map<string, Relationship>()
  if (xml === undefined) return found
  walkXml(xml, {
    open: (name, attrs) => {
      if (name !== 'Relationship' || attr(attrs, 'TargetMode') === 'External') return
      const id = attr(attrs, 'Id')
      const target = attr(attrs, 'Target')
      if (id === undefined || target === undefined) return
      const resolved = target.startsWith('/') ? target.slice(1) : join(dirname(part) === '.' ? '' : dirname(part), target)
      found.set(id, { target: resolved, type: attr(attrs, 'Type') ?? '' })
    },
  })
  return found
}

/** 包的主部件（document.xml、workbook.xml、presentation.xml），找不到就用常见位置。 */
export function mainPart(zip: ZipArchive, fallback: string): string {
  for (const relation of relationships(zip, '').values()) {
    if (relation.type.endsWith('/officeDocument')) return relation.target
  }
  return fallback
}

/** 按类型找第一个引用，比如幻灯片对应的备注页。 */
export function relatedOfType(relations: ReadonlyMap<string, Relationship>, suffix: string): string | undefined {
  for (const relation of relations.values()) {
    if (relation.type.endsWith(suffix)) return relation.target
  }
  return undefined
}
