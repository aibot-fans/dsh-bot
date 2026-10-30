import { randomUUID } from 'node:crypto'
import { loadJq, type JqInput } from 'jq-wasm'
import { lazy, readAsset } from './assets.ts'

interface Stored {
  readonly sessionId: string
  readonly value: JqInput
}

export interface Filtered {
  readonly ok: boolean
  readonly text: string
}

/** 几个会话共用，多存一些。 */
const LIMIT = 32
/** 过滤结果最多回给 bot 多少字：再长就该换个窄一点的过滤。 */
const OUTPUT_LIMIT = 50_000

const jq = lazy(async () => loadJq({ wasmBinary: await readAsset('jq.wasm') }))

/**
 * x_api_request 的响应（一般 100 KB 以上）不直接给 bot，存在这里，bot 用 jq 过滤着读（x_filter_response）。
 * 按会话分开：一个会话读不到别的会话存的。
 */
export class XResponses {
  private entries: ReadonlyMap<string, Stored> = new Map()

  add(sessionId: string, value: unknown): string {
    const id = randomUUID().slice(0, 8)
    this.entries = new Map([...this.entries, [id, { sessionId, value: (value ?? null) as JqInput }] as const].slice(-LIMIT))
    return id
  }

  async filter(sessionId: string, id: string, query: string): Promise<Filtered> {
    const stored = this.entries.get(id)
    if (stored === undefined || stored.sessionId !== sessionId) return { ok: false, text: `Unknown id: ${id}. Ids expire as newer responses fill the store.` }
    const filtered = (await jq()).raw(stored.value, query, ['-c'])
    if (filtered.exitCode !== 0) return { ok: false, text: `${filtered.stderr}\n(id:${id})` }
    if (filtered.stdout === '' || filtered.stdout === 'null' || filtered.stdout === '[]') {
      const hint = `(jq matched nothing. If you expected data: the filter path may be wrong, or the request failed - inspect via x_filter_response with id:${id}, e.g. check .errors or [.. | objects | select(.type?) | .type] | unique)`
      return { ok: true, text: `${filtered.stdout}\n${hint}` }
    }
    const output = filtered.stdout.length <= OUTPUT_LIMIT ? filtered.stdout : `${filtered.stdout.slice(0, OUTPUT_LIMIT)}\n(output cut at ${OUTPUT_LIMIT} of ${filtered.stdout.length} characters - project fewer fields)`
    return { ok: true, text: `${output}\n(id:${id})` }
  }
}
