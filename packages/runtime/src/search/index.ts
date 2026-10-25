import { Worker } from 'node:worker_threads'
import type { SearchDoc, SearchFilters, SearchHit } from 'pod-domain'

/** 单次请求最多等多久；worker 卡死时不拖住调用方。 */
const REQUEST_TIMEOUT_MS = 15_000

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

/**
 * 搜索索引的主线程这一侧：把请求转给 worker，按 id 对上答复。
 * worker 崩溃时自动重启；写入失败只告警，不影响业务（索引随时可以重建）。
 */
export class SearchIndex {
  private worker: Worker | undefined
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private stopped = false
  private readonly file: string
  private readonly workerUrl: URL
  private readonly warn: (message: string) => void

  constructor(file: string, workerUrl: URL, warn: (message: string) => void) {
    this.file = file
    this.workerUrl = workerUrl
    this.warn = warn
  }

  private ensure(): Worker {
    if (this.worker !== undefined) return this.worker
    const worker = new Worker(this.workerUrl, { workerData: { file: this.file } })
    worker.unref()
    worker.on('message', (reply: { readonly id: number; readonly ok: boolean; readonly value?: unknown; readonly error?: string }) => {
      const pending = this.pending.get(reply.id)
      if (pending === undefined) return
      this.pending.delete(reply.id)
      clearTimeout(pending.timer)
      if (reply.ok) pending.resolve(reply.value)
      else pending.reject(new Error(reply.error ?? '搜索出错'))
    })
    worker.on('error', (error) => {
      this.warn(`搜索 worker 出错：${error.message}`)
    })
    worker.on('exit', () => {
      this.worker = undefined
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer)
        pending.reject(new Error('搜索 worker 退出了'))
        this.pending.delete(id)
      }
    })
    this.worker = worker
    return worker
  }

  private call<T>(op: string, args: unknown): Promise<T> {
    if (this.stopped) return Promise.reject(new Error('搜索已停止'))
    const worker = this.ensure()
    const id = this.nextId
    this.nextId += 1
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('搜索超时'))
      }, REQUEST_TIMEOUT_MS)
      timer.unref()
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      worker.postMessage({ id, op, args })
    })
  }

  upsert(docs: readonly SearchDoc[]): void {
    if (docs.length === 0) return
    this.call('upsert', { docs }).catch((error: unknown) => this.warn(`写搜索索引失败：${error instanceof Error ? error.message : String(error)}`))
  }

  remove(refs: readonly string[]): void {
    if (refs.length === 0) return
    this.call('remove', { refs }).catch((error: unknown) => this.warn(`删搜索索引失败：${error instanceof Error ? error.message : String(error)}`))
  }

  search(query: string, filters: SearchFilters = {}): Promise<readonly SearchHit[]> {
    return this.call<readonly SearchHit[]>('search', { query, filters })
  }

  fileState(path: string): Promise<{ readonly mtime: number; readonly size: number } | null> {
    return this.call('fileState', { path })
  }

  setFileState(path: string, mtime: number, size: number): Promise<null> {
    return this.call('setFileState', { path, mtime, size })
  }

  count(): Promise<number> {
    return this.call('count', {})
  }

  clear(): Promise<null> {
    return this.call('clear', {})
  }

  async stop(): Promise<void> {
    this.stopped = true
    const worker = this.worker
    this.worker = undefined
    if (worker !== undefined) await worker.terminate()
  }
}
