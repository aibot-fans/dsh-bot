import type { Readable, Writable } from 'node:stream'

/** CDP 调用超时：浏览器卡住了，或者在等一个一直不回的网站。 */
export class CdpTimeout extends Error {}

export interface CdpEvent {
  readonly method: string
  readonly params: Readonly<Record<string, unknown>>
  readonly sessionId: string | undefined
}

interface Pending {
  readonly method: string
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * 和 Chrome 之间的 CDP 连接。走 --remote-debugging-pipe：消息是以 \0 分隔的 JSON，
 * 不开调试端口，本机其他程序和 bot 的 shell 都连不上这个浏览器。
 */
export class CdpConnection {
  private nextId = 1
  private buffer = ''
  private closed = false
  private readonly pending = new Map<number, Pending>()
  private readonly listeners = new Set<(event: CdpEvent) => void>()
  private readonly closeListeners = new Set<() => void>()
  private readonly input: Writable

  constructor(input: Writable, output: Readable) {
    this.input = input
    output.setEncoding('utf8')
    output.on('data', (chunk: string) => this.receive(chunk))
    output.on('close', () => this.shutdown())
    output.on('error', () => this.shutdown())
    input.on('error', () => this.shutdown())
  }

  get isClosed(): boolean {
    return this.closed
  }

  private receive(chunk: string): void {
    let start = 0
    let end = chunk.indexOf('\0', start)
    while (end !== -1) {
      const message = this.buffer + chunk.slice(start, end)
      this.buffer = ''
      this.dispatch(message)
      start = end + 1
      end = chunk.indexOf('\0', start)
    }
    this.buffer += chunk.slice(start)
  }

  private dispatch(raw: string): void {
    let message: { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string; result?: unknown; error?: { message?: string } }
    try {
      message = JSON.parse(raw) as typeof message
    } catch {
      return
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error !== undefined) pending.reject(new Error(`${pending.method}：${message.error.message ?? '出错了'}`))
      else pending.resolve(message.result ?? {})
      return
    }
    if (typeof message.method !== 'string') return
    const event: CdpEvent = { method: message.method, params: message.params ?? {}, sessionId: message.sessionId }
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // 一个监听出错不影响其他监听。
      }
    }
  }

  send<T = Record<string, unknown>>(method: string, params: Readonly<Record<string, unknown>> = {}, sessionId?: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    if (this.closed) return Promise.reject(new Error('浏览器连接已断开'))
    const id = this.nextId
    this.nextId += 1
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CdpTimeout(`${method}：浏览器没有响应`))
      }, timeoutMs)
      this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timer })
      this.input.write(`${JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) })}\0`)
    })
  }

  on(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  close(): void {
    try {
      this.input.end()
    } catch {
      // 管道已经关了。
    }
    this.shutdown()
  }

  private shutdown(): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('浏览器连接已断开'))
    }
    this.pending.clear()
    for (const listener of this.closeListeners) listener()
  }
}
