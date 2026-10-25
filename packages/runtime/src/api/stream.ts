import type { PodEvent, PodEventEnvelope } from 'pod-domain'
import type { PodBus } from '../core/bus.ts'
import type { FetchRoute } from '../dsh.ts'
import { POD_API_PREFIX } from './router.ts'

/** 心跳间隔：代理和浏览器不会把空闲连接当成断开。 */
const HEARTBEAT_MS = 25_000

const encoder = new TextEncoder()

function frame(envelope: PodEventEnvelope): Uint8Array {
  return encoder.encode(`id: ${envelope.seq}\nevent: pod\ndata: ${JSON.stringify(envelope)}\n\n`)
}

function control(event: PodEvent, seq: number): Uint8Array {
  return frame({ seq, time: Date.now(), event })
}

/** 断线重连时从哪里补：标准的 Last-Event-ID 头，或者查询参数 after。 */
function resumePoint(request: Request): number | undefined {
  const header = request.headers.get('last-event-id')
  const query = new URL(request.url).searchParams.get('after')
  const raw = header ?? query
  if (raw === null || raw === '') return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/**
 * 实时事件流（SSE）。dsh 的 /api 桥会逐块写出响应体，但客户端断开后桥仍会读完响应，
 * 所以必须在请求的 abort 信号上主动关流，否则订阅会一直挂着。
 */
export function eventStreamRoute(bus: PodBus): FetchRoute {
  return {
    path: `${POD_API_PREFIX}/events`,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const after = resumePoint(request)
      let cleanup = (): void => {}
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          let closed = false
          const send = (chunk: Uint8Array): void => {
            if (closed) return
            try {
              controller.enqueue(chunk)
            } catch {
              close()
            }
          }
          const unsubscribe = bus.subscribe((envelope) => send(frame(envelope)))
          const heartbeat = setInterval(() => send(encoder.encode(': ping\n\n')), HEARTBEAT_MS)
          const close = (): void => {
            if (closed) return
            closed = true
            unsubscribe()
            clearInterval(heartbeat)
            request.signal.removeEventListener('abort', close)
            try {
              controller.close()
            } catch {
              // 已经关了。
            }
          }
          cleanup = close
          request.signal.addEventListener('abort', close)
          send(encoder.encode('retry: 3000\n\n'))
          if (after === undefined) {
            send(control({ type: 'hello', seq: bus.currentSeq }, bus.currentSeq))
            return
          }
          const missed = bus.since(after)
          if (missed === undefined) send(control({ type: 'resync' }, bus.currentSeq))
          else for (const envelope of missed) send(frame(envelope))
        },
        cancel() {
          cleanup()
        },
      })
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          'x-accel-buffering': 'no',
        },
      })
    },
  }
}
