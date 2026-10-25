import type { PodEvent, PodEventEnvelope } from 'pod-domain'

/** 环形缓冲保留的事件数；断线重连在这个范围内能补齐，超出就让页面整页刷新数据。 */
const BUFFER_SIZE = 500

type Listener = (envelope: PodEventEnvelope) => void

/**
 * 进程内事件总线：服务往里发事件，SSE 路由订阅后推给页面。
 * 只在内存里，重启后序号从头开始，页面收到 hello 发现序号变小就整页刷新。
 */
export class PodBus {
  private seq = 0
  private buffer: readonly PodEventEnvelope[] = []
  /** 已经挤出缓冲的最大序号；要补发的起点比它早，就补不全了。 */
  private evictedThrough = 0
  private readonly listeners = new Set<Listener>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  get currentSeq(): number {
    return this.seq
  }

  emit(event: PodEvent): void {
    this.seq += 1
    const envelope: PodEventEnvelope = { seq: this.seq, time: this.now(), event }
    // 画面帧只给在线的人，不进缓冲，避免把补发队列挤满。
    if (event.type !== 'frame' && event.type !== 'stream') {
      const kept = this.buffer.slice(-(BUFFER_SIZE - 1))
      const evicted = this.buffer[this.buffer.length - kept.length - 1]
      if (evicted !== undefined) this.evictedThrough = evicted.seq
      this.buffer = [...kept, envelope]
    }
    for (const listener of this.listeners) {
      try {
        listener(envelope)
      } catch {
        // 一个订阅者出错不影响其他订阅者。
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** after 之后的事件；缓冲里已经找不全时返回 undefined。 */
  since(after: number): readonly PodEventEnvelope[] | undefined {
    if (after > this.seq) return undefined
    if (after < this.evictedThrough) return undefined
    return this.buffer.filter((envelope) => envelope.seq > after)
  }

  get listenerCount(): number {
    return this.listeners.size
  }
}
