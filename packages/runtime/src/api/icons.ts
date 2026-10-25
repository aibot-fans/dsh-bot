import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOT_ICONS } from 'pod-domain'
import type { FetchRoute } from '../dsh.ts'
import { POD_API_PREFIX } from './router.ts'

/** 内置图标在 pod-runtime 包的 assets/bot-icons 里：构建后从 lib/ 往上一层，直接跑源码时往上两层。 */
function iconFolder(): string | undefined {
  for (const relative of ['../assets/bot-icons/', '../../assets/bot-icons/']) {
    const path = fileURLToPath(new URL(relative, import.meta.url))
    if (existsSync(path)) return path
  }
  return undefined
}

/**
 * 内置图标：/api/pod/bot-icon?kind=coder&size=head|full。head 是圆形小头像用的头部特写，full 是全身图。
 * 只认内置的种类，读过的放在内存里；页面地址里带着版本号，可以放心长期缓存。
 */
export function botIconRoute(): FetchRoute {
  const folder = iconFolder()
  const cache = new Map<string, Uint8Array>()
  const missing = (): Response => new Response('not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  return {
    path: `${POD_API_PREFIX}/bot-icon`,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const params = new URL(request.url).searchParams
      const kind = BOT_ICONS.find((item) => item === params.get('kind'))
      if (kind === undefined || folder === undefined) return missing()
      const name = `${kind}.${params.get('size') === 'full' ? 'full' : 'head'}.webp`
      const data = cache.get(name) ?? (await readFile(join(folder, name)).then((buffer) => new Uint8Array(buffer)).catch(() => undefined))
      if (data === undefined) return missing()
      cache.set(name, data)
      return new Response(data.slice(), { status: 200, headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } })
    },
  }
}
