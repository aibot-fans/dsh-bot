import { inflateRawSync } from 'node:zlib'
import { t } from 'pod-domain'
import { ConvertError } from './formats.ts'

/** 解压后合计最多 512 MB：防止压缩炸弹把 dsh 的内存撑爆。 */
const MAX_TOTAL = 512 * 1024 * 1024
const END_OF_DIRECTORY = 0x06054b50
const DIRECTORY_ENTRY = 0x02014b50
const LOCAL_HEADER = 0x04034b50

interface Entry {
  readonly name: string
  readonly method: number
  readonly compressed: number
  readonly offset: number
}

/** 只读的 ZIP 包：Word、Excel、PPT 的新格式都是 ZIP 里装 XML。条目名不分大小写。 */
export interface ZipArchive {
  readonly names: readonly string[]
  text(name: string): string | undefined
}

function findEnd(data: Buffer): number {
  const stop = Math.max(0, data.length - 22 - 0xffff)
  for (let index = data.length - 22; index >= stop; index -= 1) {
    if (data.readUInt32LE(index) === END_OF_DIRECTORY) return index
  }
  throw new ConvertError(t('不是有效的 ZIP 文件'))
}

function readEntries(data: Buffer): readonly Entry[] {
  const end = findEnd(data)
  const count = data.readUInt16LE(end + 10)
  const start = data.readUInt32LE(end + 16)
  if (count === 0xffff || start === 0xffffffff) throw new ConvertError(t('不支持 ZIP64 格式的文件'))
  const entries: Entry[] = []
  let cursor = start
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > data.length || data.readUInt32LE(cursor) !== DIRECTORY_ENTRY) throw new ConvertError(t('ZIP 目录损坏'))
    const flags = data.readUInt16LE(cursor + 8)
    if ((flags & 1) === 1) throw new ConvertError(t('文件有密码'))
    const nameLength = data.readUInt16LE(cursor + 28)
    const extraLength = data.readUInt16LE(cursor + 30)
    const commentLength = data.readUInt16LE(cursor + 32)
    entries.push({
      name: data.toString('utf8', cursor + 46, cursor + 46 + nameLength),
      method: data.readUInt16LE(cursor + 10),
      compressed: data.readUInt32LE(cursor + 20),
      offset: data.readUInt32LE(cursor + 42),
    })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function key(name: string): string {
  return name.replace(/^\/+/, '').toLowerCase()
}

export function openZip(data: Buffer): ZipArchive {
  const entries = new Map(readEntries(data).map((entry) => [key(entry.name), entry]))
  let used = 0
  const read = (entry: Entry): Buffer => {
    if (entry.offset + 30 > data.length || data.readUInt32LE(entry.offset) !== LOCAL_HEADER) throw new ConvertError(t('ZIP 条目损坏'))
    const start = entry.offset + 30 + data.readUInt16LE(entry.offset + 26) + data.readUInt16LE(entry.offset + 28)
    const raw = data.subarray(start, start + entry.compressed)
    if (entry.method === 0) return raw
    if (entry.method !== 8) throw new ConvertError(t('不支持的压缩方式（{method}）', { method: entry.method }))
    try {
      return inflateRawSync(raw, { maxOutputLength: Math.max(1, MAX_TOTAL - used) })
    } catch (error) {
      throw error instanceof RangeError ? new ConvertError(t('文件解压后太大')) : error
    }
  }
  return {
    names: [...entries.values()].map((entry) => entry.name),
    text: (name) => {
      const entry = entries.get(key(name))
      if (entry === undefined) return undefined
      const content = read(entry)
      used += content.length
      return content.toString('utf8')
    },
  }
}
