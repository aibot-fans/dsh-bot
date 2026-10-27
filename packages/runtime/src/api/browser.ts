import { readFile } from 'node:fs/promises'
import { fail, ok, readId, t, tabOwnerLabel, type PodResult, type TabInfo } from 'pod-domain'
import { CdpTimeout } from '../browser/cdp.ts'
import { NavigationError } from '../browser/navigation.ts'
import type { FetchRoute } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { get, post, POD_API_PREFIX, type RouteSpec } from './router.ts'

export interface TabView extends TabInfo {
  readonly ownerName: string
  readonly botId: string | null
  readonly taskId: string | null
  readonly taskTitle: string
  /** 这个标签页属于哪个对话：bot 在那个对话（或那个任务的群）里打开的，或者你在那个群的浏览器页里开的。 */
  readonly roomId: string | null
}

function roomOf(pod: PodRuntime, info: TabInfo): string | null {
  if (info.owner.kind === 'owner') return info.owner.roomId ?? null
  if (info.owner.kind !== 'bot') return null
  const session = pod.registry.get(info.owner.sessionId)
  if (session !== undefined && session.roomId !== null) return session.roomId
  return info.owner.taskId === null ? null : (pod.tasks.get(info.owner.taskId)?.roomId ?? null)
}

function view(pod: PodRuntime, info: TabInfo): TabView {
  const botId = info.owner.kind === 'bot' ? info.owner.botId : null
  const taskId = info.owner.kind === 'bot' ? info.owner.taskId : null
  return {
    ...info,
    ownerName: tabOwnerLabel(info.owner, (id) => pod.bots.get(id)?.name),
    botId,
    taskId,
    taskTitle: taskId === null ? '' : (pod.tasks.get(taskId)?.title ?? ''),
    roomId: roomOf(pod, info),
  }
}

/** 标签页没响应、页面正在跳转、浏览器起不来时，给一句看得懂的原因，不报“内部错误”。 */
/**
 * 浏览器操作出错时给页面的话：打不开网页就直说原因；浏览器卡住或断开才说“浏览器没有响应”，
 * 其余的说“浏览器出错了”，不再把每个错误都说成浏览器没响应。
 */
async function guarded<T>(work: () => PodResult<T> | Promise<PodResult<T>>): Promise<PodResult<T>> {
  try {
    return await work()
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, 160)
    if (error instanceof NavigationError) return fail('invalid-input', reason)
    if (error instanceof CdpTimeout || reason.includes('浏览器连接已断开')) return fail('session-unavailable', t('浏览器没有响应，稍后再试'))
    return fail('session-unavailable', t('浏览器出错了：{value}', { value: reason || t('请稍后再试') }))
  }
}

/** 浏览器面板用的接口：标签页列表、打开、地址栏、前进后退、接管交还、输入转发、原生控件浮层。 */
export function browserRoutes(pod: PodRuntime): readonly RouteSpec[] {
  const owner = pod.browser.owner
  return [
    get('/browser/tabs', () => ok({ status: pod.browser.browser.status(), tabs: pod.browser.browser.list().filter((info) => !(info.owner.kind === 'pod' && info.owner.hidden === true)).map((info) => view(pod, info)) })),
    post('/browser/open', (body) => guarded(() => owner.open(body))),
    post('/browser/navigate', (body) => guarded(() => owner.navigate(body))),
    post('/browser/history', (body) => guarded(() => owner.history(body))),
    post('/browser/close', (body) => guarded(() => owner.close(body))),
    post('/browser/takeover', (body) => guarded(() => owner.takeover(body))),
    post('/browser/handback', (body) => guarded(() => owner.handback(body))),
    post('/browser/input', (body) => guarded(() => owner.input(body)), { writes: false }),
    post('/browser/select', (body) => guarded(() => owner.select(body))),
    post('/browser/dialog', (body) => guarded(() => owner.dialog(body))),
    get('/browser/files', (query) => guarded(() => owner.files(query))),
    post('/browser/file', (body) => guarded(() => owner.chooseFile(body))),
    get('/browser/selection', (query) => guarded(() => owner.selection(query))),
  ]
}

const encoder = new TextEncoder()
const HEARTBEAT_MS = 25_000

function image(data: Buffer | Uint8Array): Response {
  return new Response(new Uint8Array(data), { status: 200, headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } })
}

function missing(): Response {
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

/**
 * 不是 JSON 的浏览器接口：实时画面（SSE，只给你正在看的标签页推流，断开就停）、
 * 缩略图、截图和审批卡上的截图。
 */
export function browserMediaRoutes(pod: PodRuntime): readonly FetchRoute[] {
  const thumbs = new Map<string, { readonly at: number; readonly data: Buffer }>()
  const tabOf = (request: Request) => {
    const id = new URL(request.url).searchParams.get('tabId') ?? ''
    return pod.browser.browser.get(id)
  }
  return [
    {
      path: `${POD_API_PREFIX}/browser/frames`,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const tab = tabOf(request)
        if (tab === undefined) return missing()
        let stop = (): void => {}
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            let closed = false
            const send = (text: string): void => {
              if (closed) return
              try {
                controller.enqueue(encoder.encode(text))
              } catch {
                close()
              }
            }
            const unsubscribe = pod.browser.browser.subscribe(tab.id, {
              frame: (frame) => send(`event: frame\ndata: ${JSON.stringify({ data: frame.data, w: frame.viewportWidth, h: frame.viewportHeight })}\n\n`),
              closed: () => {
                send('event: closed\ndata: {}\n\n')
                close()
              },
            })
            const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS)
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
            stop = close
            request.signal.addEventListener('abort', close)
            send('retry: 2000\n\n')
            // 先发一张截图，画面不用等页面变化才出现。
            void tab
              .screenshot(60)
              .then((data) => send(`event: frame\ndata: ${JSON.stringify({ data: data.toString('base64'), w: 0, h: 0 })}\n\n`))
              .catch(() => undefined)
          },
          cancel() {
            stop()
          },
        })
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } })
      },
    },
    {
      path: `${POD_API_PREFIX}/browser/thumb`,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const tab = tabOf(request)
        if (tab === undefined) return missing()
        const cached = thumbs.get(tab.id)
        if (cached !== undefined && Date.now() - cached.at < 10_000) return image(cached.data)
        const data = await tab.screenshot(35).catch(() => undefined)
        if (data === undefined) return missing()
        thumbs.set(tab.id, { at: Date.now(), data })
        return image(data)
      },
    },
    {
      path: `${POD_API_PREFIX}/browser/screenshot`,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const tab = tabOf(request)
        const data = tab === undefined ? undefined : await tab.screenshot(90).catch(() => undefined)
        return data === undefined ? missing() : image(data)
      },
    },
    {
      path: `${POD_API_PREFIX}/browser/approval-shot`,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const waitId = readId(Object.fromEntries(new URL(request.url).searchParams), 'waitId')
        const wait = waitId === undefined ? undefined : pod.waits.get(waitId)
        const shot = typeof wait?.data.shot === 'string' ? wait.data.shot : undefined
        if (shot === undefined) return missing()
        const data = await readFile(pod.browser.approvals.shotPath(shot)).catch(() => undefined)
        return data === undefined ? missing() : image(data)
      },
    },
  ]
}
