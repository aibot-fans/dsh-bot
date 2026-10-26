import type { PodEvent, PodEventEnvelope } from 'pod-domain'
import { eventsUrl } from './http.ts'

type Listener = (event: PodEvent) => void

export type StreamState = 'connecting' | 'open' | 'closed'

/** 最后一个订阅者走后多久断开连接（切换页面时不来回重连）。 */
const IDLE_CLOSE_MS = 15_000

/** 连接被宿主以出错关掉以后隔多久重连：从 1 秒开始翻倍，最多 30 秒。 */
const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 30_000

/**
 * 宿主的实时事件流（SSE）。网络断了 EventSource 会自己重连并带上 Last-Event-ID，宿主据此补发；补不全时发 resync，页面整页刷新数据。
 * 宿主回了出错的响应（比如 dsh web 重启那一下）EventSource 会彻底放弃，这时由这里按退避重连，连上后整页刷新一次。
 * 页面从后台回到前台时，断着的连接马上重连。
 */
export class PodEvents {
  private source: EventSource | undefined
  private readonly listeners = new Set<Listener>()
  private readonly stateListeners = new Set<(state: StreamState) => void>()
  private closeTimer: ReturnType<typeof setTimeout> | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private retryDelay = RETRY_MIN_MS
  /** 这条连接是放弃以后自己重连的：新连接不带 Last-Event-ID，连上后要整页刷新。 */
  private recovering = false
  private watching = false
  private lastSeq = 0
  state: StreamState = 'closed'

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    if (this.closeTimer !== undefined) {
      clearTimeout(this.closeTimer)
      this.closeTimer = undefined
    }
    this.connect()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.closeTimer = setTimeout(() => this.disconnect(), IDLE_CLOSE_MS)
    }
  }

  onState(listener: (state: StreamState) => void): () => void {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  private setState(state: StreamState): void {
    this.state = state
    for (const listener of this.stateListeners) listener(state)
  }

  private connect(): void {
    if (this.source !== undefined || typeof EventSource === 'undefined') return
    if (this.retryTimer !== undefined) {
      // 正等着重连时有新的订阅：现在就连，连上后照样整页刷新。
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
      this.recovering = true
    }
    this.watchVisibility()
    this.setState('connecting')
    const source = new EventSource(eventsUrl(), { withCredentials: true })
    source.addEventListener('open', () => {
      this.retryDelay = RETRY_MIN_MS
      this.setState('open')
      if (!this.recovering) return
      this.recovering = false
      this.dispatch({ type: 'resync' })
    })
    source.addEventListener('error', () => {
      if (source.readyState !== EventSource.CLOSED) {
        this.setState('connecting')
        return
      }
      source.close()
      if (this.source === source) this.source = undefined
      this.setState('closed')
      this.scheduleRetry()
    })
    source.addEventListener('pod', (message) => {
      let envelope: PodEventEnvelope
      try {
        envelope = JSON.parse((message as MessageEvent<string>).data) as PodEventEnvelope
      } catch {
        return
      }
      // 宿主重启后序号从头开始：当成一次整页刷新。
      const restarted = envelope.event.type === 'hello' && envelope.seq < this.lastSeq
      this.lastSeq = envelope.seq
      this.dispatch(restarted ? { type: 'resync' } : envelope.event)
    })
    this.source = source
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== undefined || this.listeners.size === 0) return
    const delay = this.retryDelay
    this.retryDelay = Math.min(RETRY_MAX_MS, delay * 2)
    this.retryTimer = setTimeout(() => this.reconnect(), delay)
  }

  private reconnect(): void {
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    if (this.source !== undefined || this.listeners.size === 0) return
    this.recovering = true
    this.connect()
  }

  private readonly onVisible = (): void => {
    if (document.visibilityState === 'visible' && this.source === undefined && this.listeners.size > 0) this.reconnect()
  }

  private watchVisibility(): void {
    if (this.watching || typeof document === 'undefined') return
    this.watching = true
    document.addEventListener('visibilitychange', this.onVisible)
  }

  private disconnect(): void {
    this.closeTimer = undefined
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.source?.close()
    this.source = undefined
    this.setState('closed')
  }

  private dispatch(event: PodEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch {
        // 一个组件出错不影响其他组件。
      }
    }
  }

  dispose(): void {
    if (this.closeTimer !== undefined) clearTimeout(this.closeTimer)
    this.disconnect()
    this.listeners.clear()
    if (this.watching) document.removeEventListener('visibilitychange', this.onVisible)
    this.watching = false
  }
}
