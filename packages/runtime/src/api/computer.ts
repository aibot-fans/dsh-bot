import { ok, readString } from 'pod-domain'
import type { FetchRoute } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { get, post, POD_API_PREFIX, type RouteSpec } from './router.ts'

/** 用电脑：设置页看小助手和系统权限；电脑面板看谁在用、接管和交还。 */
export function computerRoutes(pod: PodRuntime): readonly RouteSpec[] {
  return [
    get('/computer/status', () => ok(pod.computer.status())),
    post('/computer/check', async () => ok(await pod.computer.check())),
    post('/computer/permissions', async () => ok(await pod.computer.openPermissionFlow())),
    post('/computer/takeover', () => pod.computer.takeover()),
    post('/computer/handback', (body) => pod.computer.handback(readString(body, 'note').slice(0, 500))),
  ]
}

const HEADERS = { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } as const

/** 一帧 JSON：类型 2、长度 4 字节大端、内容，和小助手发的帧一个格式。 */
function jsonFrame(value: unknown): Uint8Array<ArrayBuffer> {
  const payload = new TextEncoder().encode(JSON.stringify(value))
  const frame = new Uint8Array(5 + payload.length)
  frame[0] = 2
  new DataView(frame.buffer).setUint32(1, payload.length)
  frame.set(payload, 5)
  return frame
}

/** 小助手不肯推画面时回的那一行 JSON（不是一帧）：取出原因。 */
function refusal(chunk: Buffer): string {
  try {
    const line = JSON.parse(chunk.toString('utf8').split('\n')[0] ?? '') as { readonly response?: { readonly error?: string } }
    return line.response?.error ?? 'refused'
  } catch {
    return 'refused'
  }
}

/**
 * 电脑面板的画面：GET /api/pod/computer/stream，二进制流，原样转发小助手的一帧帧（类型 1 字节、长度 4 字节大端、内容；
 * 1 是 H.264，2 是 JSON 状态）。推不了时只发一帧 JSON（type 是 error）就结束；电脑交还、面板关掉时断开。
 * 页面读得慢时先停下读小助手，不在内存里越攒越多。
 */
export function computerMediaRoutes(pod: PodRuntime): readonly FetchRoute[] {
  return [
    {
      path: `${POD_API_PREFIX}/computer/stream`,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const opened = await pod.computer.stream().catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
        if (typeof opened === 'string') return new Response(jsonFrame({ type: 'error', error: opened }), { status: 200, headers: HEADERS })
        const socket = opened
        let stop = (): void => {}
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            let closed = false
            let first = true
            const close = (): void => {
              if (closed) return
              closed = true
              unwatch()
              request.signal.removeEventListener('abort', close)
              socket.destroy()
              try {
                controller.close()
              } catch {
                // 已经关了。
              }
            }
            const unwatch = pod.computer.watch(close)
            stop = close
            request.signal.addEventListener('abort', close)
            socket.on('data', (chunk: Buffer) => {
              if (closed) return
              if (first) {
                first = false
                if (chunk[0] === 0x7b) {
                  controller.enqueue(jsonFrame({ type: 'error', error: refusal(chunk) }))
                  close()
                  return
                }
              }
              try {
                controller.enqueue(new Uint8Array(chunk))
                if ((controller.desiredSize ?? 1) <= 0) socket.pause()
              } catch {
                close()
              }
            })
            socket.on('close', close)
            socket.on('error', close)
          },
          pull() {
            socket.resume()
          },
          cancel() {
            stop()
          },
        })
        return new Response(body, { status: 200, headers: HEADERS })
      },
    },
  ]
}
