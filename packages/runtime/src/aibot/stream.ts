import { t } from 'pod-domain'
import { isJson, reasonOf, text } from './client.ts'
import { AibotError } from './errors.ts'

/** 服务端每 20 秒一条心跳；超过 60 秒什么都没收到就当断线。 */
const SILENCE_MS = 60_000
const MAX_BACKOFF_MS = 60_000

export type StreamState = 'connected' | 'retrying' | 'idle'

export interface StreamDeps {
  readonly url: URL
  readonly key: () => string | undefined
  /** 收到一条新事件（还没去重）。 */
  readonly onEvent: (raw: unknown) => void
  /** 连上了：补拉断线期间漏掉的事件。 */
  readonly onOpen: () => Promise<void>
  readonly onState: (state: StreamState) => void
  /** 连接被拒（401、403 这类）：返回 stop 就不再重连。 */
  readonly onRefused: (error: AibotError) => Promise<'stop' | 'retry'>
  readonly warn: (message: string) => void
}

/**
 * X 监控的实时事件流（SSE）：断线后按 1、2、4…最长 60 秒退避重连，
 * 每次连上先补拉漏掉的事件。只在有监控时开着。
 */
export class MonitorStream {
  private readonly deps: StreamDeps
  private controller: AbortController | undefined
  private reconnect: ReturnType<typeof setTimeout> | undefined
  private silence: ReturnType<typeof setTimeout> | undefined
  private attempts = 0
  private running = false

  constructor(deps: StreamDeps) {
    this.deps = deps
  }

  get active(): boolean {
    return this.running
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.attempts = 0
    void this.connect()
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    clearTimeout(this.reconnect)
    clearTimeout(this.silence)
    this.controller?.abort()
    this.controller = undefined
    this.deps.onState('idle')
  }

  /** 换了 Key（重新开通、绑定账号）：断开重连。 */
  restart(): void {
    this.stop()
    this.start()
  }

  private async connect(): Promise<void> {
    if (!this.running) return
    const key = this.deps.key()
    if (key === undefined) {
      this.stop()
      return
    }
    const controller = new AbortController()
    this.controller = controller
    try {
      const response = await fetch(this.deps.url, { headers: { authorization: `Bearer ${key}`, accept: 'text/event-stream', 'cache-control': 'no-cache' }, signal: controller.signal })
      if (!response.ok || response.body === null) {
        const body = await response.text().catch(() => '')
        throw refusal(response, body)
      }
      this.deps.onState('connected')
      this.watch(controller)
      void this.deps.onOpen().catch((error: unknown) => this.deps.warn(`补拉 X 监控事件失败：${reasonOf(error)}`))
      await this.read(response.body, controller)
    } catch (error) {
      if (!this.running || this.controller !== controller) return
      if (error instanceof AibotError && (await this.deps.onRefused(error)) === 'stop') {
        this.stop()
        return
      }
      if (!controller.signal.aborted) this.deps.warn(`X 监控事件流断了：${reasonOf(error)}`)
    } finally {
      clearTimeout(this.silence)
    }
    this.retry()
  }

  private retry(): void {
    if (!this.running) return
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempts)
    this.attempts += 1
    this.deps.onState('retrying')
    clearTimeout(this.reconnect)
    this.reconnect = setTimeout(() => void this.connect(), delay)
  }

  /** 60 秒没有任何消息（包括心跳）就断开重连。 */
  private watch(controller: AbortController): void {
    clearTimeout(this.silence)
    this.silence = setTimeout(() => controller.abort(), SILENCE_MS)
  }

  private async read(body: ReadableStream<Uint8Array>, controller: AbortController): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let name = ''
    let data: readonly string[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      // 真收到了东西才算连稳，退避从头算。
      this.attempts = 0
      this.watch(controller)
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
        if (line === '') {
          if (name === 'twitter.event.created' && data.length > 0) this.dispatch(data.join('\n'))
          name = ''
          data = []
        } else if (line.startsWith('event:')) {
          name = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          data = [...data, line.slice(5).trimStart()]
        }
      }
    }
  }

  private dispatch(payload: string): void {
    try {
      this.deps.onEvent(JSON.parse(payload) as unknown)
    } catch {
      this.deps.warn('X 监控事件不是 JSON，跳过了')
    }
  }
}

function refusal(response: Response, body: string): AibotError {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    parsed = undefined
  }
  const error = isJson(parsed) && isJson(parsed.error) ? parsed.error : {}
  return new AibotError({ status: response.status, code: text(error.code) || `http_${response.status}`, message: text(error.message) || t('事件流返回 HTTP {status}', { status: response.status }) })
}
