import { useEffect, useRef, useState } from 'react'
import { t } from 'pod-domain'
import { api, type BrowserInput, type BrowserOverlay } from '../../api/endpoints.ts'
import { mediaUrl } from '../../api/http.ts'

export interface Pointer {
  readonly x: number
  readonly y: number
  readonly label: string
  readonly at: number
}

/** 这些键直接转给页面；其余可打印的字由输入框收下，组好字后一次发过去。 */
const SPECIAL_KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])
const BUTTONS = ['left', 'middle', 'right']

function modifiers(event: { readonly altKey: boolean; readonly ctrlKey: boolean; readonly metaKey: boolean; readonly shiftKey: boolean }): number {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
}

/**
 * 一个标签页的实时画面：从流式接口收 JPEG 帧画在 canvas 上。
 * 你接管时，画面上的点击、滚轮、按键转给页面；中文在这边组字后用一次输入发过去，粘贴也一样。
 */
export function LiveView(props: { readonly tabId: string; readonly controlled: boolean; readonly pointer: Pointer | null; readonly onOverlay: (overlay: BrowserOverlay) => void; readonly onError: (message: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imeRef = useRef<HTMLTextAreaElement | null>(null)
  const viewport = useRef({ width: 1280, height: 800 })
  const [state, setState] = useState<'loading' | 'live' | 'closed'>('loading')
  const queue = useRef<BrowserInput[]>([])
  const flushing = useRef(false)
  const lastMove = useRef(0)
  const { tabId, controlled, onOverlay, onError } = props

  useEffect(() => {
    setState('loading')
    const source = new EventSource(mediaUrl('/browser/frames', { tabId }))
    let pending: { readonly data: string; readonly w: number; readonly h: number } | undefined
    let drawing = false
    const draw = (): void => {
      const frame = pending
      const canvas = canvasRef.current
      if (frame === undefined || canvas === null || drawing) return
      pending = undefined
      drawing = true
      const image = new Image()
      image.onload = () => {
        if (canvas.width !== image.naturalWidth) canvas.width = image.naturalWidth
        if (canvas.height !== image.naturalHeight) canvas.height = image.naturalHeight
        canvas.getContext('2d')?.drawImage(image, 0, 0)
        viewport.current = frame.w > 0 ? { width: frame.w, height: frame.h } : viewport.current.width > 0 ? viewport.current : { width: image.naturalWidth, height: image.naturalHeight }
        drawing = false
        setState('live')
        draw()
      }
      image.onerror = () => {
        drawing = false
        draw()
      }
      image.src = `data:image/jpeg;base64,${frame.data}`
    }
    source.addEventListener('frame', (event) => {
      try {
        pending = JSON.parse((event as MessageEvent<string>).data) as { readonly data: string; readonly w: number; readonly h: number }
        draw()
      } catch {
        // 坏帧跳过。
      }
    })
    source.addEventListener('closed', () => {
      setState('closed')
      source.close()
    })
    return () => source.close()
  }, [tabId])

  const flush = (): void => {
    if (flushing.current || queue.current.length === 0) return
    flushing.current = true
    const events = queue.current
    queue.current = []
    api
      .browserInput(tabId, events)
      .then((result) => {
        if (result.overlay !== null) onOverlay(result.overlay)
      })
      .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => {
        flushing.current = false
        flush()
      })
  }

  const send = (event: BrowserInput): void => {
    if (!controlled) return
    queue.current = [...queue.current, event]
    flush()
  }

  const toPage = (clientX: number, clientY: number): { readonly x: number; readonly y: number } => {
    const canvas = canvasRef.current
    if (canvas === null) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: ((clientX - rect.left) / rect.width) * viewport.current.width, y: ((clientY - rect.top) / rect.height) * viewport.current.height }
  }

  // 滚轮要能 preventDefault，React 的 onWheel 是被动监听，只能自己挂。
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || !controlled) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const point = toPage(event.clientX, event.clientY)
      send({ type: 'wheel', ...point, deltaX: event.deltaX, deltaY: event.deltaY })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  })

  const marker = props.pointer !== null && Date.now() - props.pointer.at < 2500 ? props.pointer : null

  return (
    <div className={`pod-live${controlled ? ' pod-live-controlled' : ''}`}>
      <canvas
        ref={canvasRef}
        width={1280}
        height={800}
        onMouseDown={(event) => {
          if (!controlled) return
          event.preventDefault()
          imeRef.current?.focus()
          send({ type: 'mouse', action: 'down', ...toPage(event.clientX, event.clientY), button: BUTTONS[event.button] ?? 'left', clickCount: event.detail, modifiers: modifiers(event) })
        }}
        onMouseUp={(event) => {
          if (!controlled) return
          send({ type: 'mouse', action: 'up', ...toPage(event.clientX, event.clientY), button: BUTTONS[event.button] ?? 'left', clickCount: event.detail, modifiers: modifiers(event) })
        }}
        onMouseMove={(event) => {
          if (!controlled || Date.now() - lastMove.current < 60) return
          lastMove.current = Date.now()
          send({ type: 'mouse', action: 'move', ...toPage(event.clientX, event.clientY) })
        }}
        onContextMenu={(event) => event.preventDefault()}
      />
      {controlled ? (
        <textarea
          ref={imeRef}
          className="pod-live-ime"
          aria-label={t('向页面输入')}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            const combo = event.ctrlKey || event.metaKey
            if (combo && (event.key === 'v' || event.key === 'V')) return
            if (!SPECIAL_KEYS.has(event.key) && !combo) return
            event.preventDefault()
            send({ type: 'key', action: 'down', key: event.key, code: event.code, keyCode: event.keyCode, modifiers: modifiers(event), ...(event.key === 'Enter' ? { text: '\r' } : {}) })
          }}
          onKeyUp={(event) => {
            if (!SPECIAL_KEYS.has(event.key) && !(event.ctrlKey || event.metaKey)) return
            send({ type: 'key', action: 'up', key: event.key, code: event.code, keyCode: event.keyCode, modifiers: modifiers(event) })
          }}
          onCompositionEnd={(event) => {
            if (event.data !== '') send({ type: 'text', text: event.data })
            event.currentTarget.value = ''
          }}
          onInput={(event) => {
            const native = event.nativeEvent as InputEvent
            if (native.isComposing) return
            const value = event.currentTarget.value
            if (value !== '') send({ type: 'text', text: value })
            event.currentTarget.value = ''
          }}
          onPaste={(event) => {
            event.preventDefault()
            const text = event.clipboardData.getData('text/plain')
            if (text !== '') send({ type: 'text', text })
          }}
        />
      ) : null}
      {marker === null ? null : (
        <span className="pod-live-pointer" style={{ left: `${(marker.x / viewport.current.width) * 100}%`, top: `${(marker.y / viewport.current.height) * 100}%` }} title={marker.label} />
      )}
      {state === 'live' ? null : <div className="pod-live-status">{state === 'loading' ? t('正在连接画面…') : t('这个标签页已经关了')}</div>}
    </div>
  )
}
