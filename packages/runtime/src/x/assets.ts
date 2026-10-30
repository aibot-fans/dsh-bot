import { readFile } from 'node:fs/promises'

/** 构建时拷进 lib/x/ 的文件（见 tsdown.config.ts）：jq 的 wasm。 */
export type XAsset = 'jq.wasm'

export function readAsset(name: XAsset): Promise<Buffer> {
  return readFile(new URL(`x/${name}`, import.meta.url))
}

/** 第一次用到时才加载，以后用同一份；加载失败了下次重来。 */
export function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let current: Promise<T> | undefined
  return () => {
    if (current === undefined) {
      const next = load()
      current = next
      next.catch(() => {
        if (current === next) current = undefined
      })
    }
    return current
  }
}
