import type { PodEvent, PodEventEnvelope } from 'pod-domain'
import { eventsUrl } from './http.ts'

type Listener = (event: PodEvent) => void

export type StreamState = 'connecting' | 'open' | 'closed'

/** 最后一个订阅者走后多久断开连接（切换页面时不来回重连）。 */
const IDLE_CLOSE_MS = 15_000

/**
 * 宿主的实时事件流（SSE）。EventSource 断线会自己重连并带上 Last-Event-ID，
 * 宿主据此补发；补不全时发 resync，页面整页刷新数据。
 */
export class PodEvents {
  private source: EventSource | undefined
  private readonly listeners = new Set<Listener>()
  private readonly stateListeners = new Set<(state: StreamState) => void>()
  private closeTimer: ReturnType<typeof setTimeout> | undefined
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
    this.setState('connecting')
    const source = new EventSource(eventsUrl(), { withCredentials: true })
    source.addEventListener('open', () => this.setState('open'))
    source.addEventListener('error', () => this.setState(source.readyState === EventSource.CLOSED ? 'closed' : 'connecting'))
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

  private disconnect(): void {
    this.closeTimer = undefined
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
  }
}
