import { useEffect, useRef, useState } from 'react'
import { t } from 'pod-domain'
import { computerApi } from '../../api/computer.ts'
import { Button } from '../../components/common.tsx'

type Phase = 'loading' | 'live' | 'ended' | 'error'

/** 小助手发来的状态帧：ready、geometry、stats、ended，推不了时是 error。 */
interface Meta {
  readonly type?: string
  readonly error?: string
}

const hex = (value: number | undefined): string => (value ?? 0).toString(16).padStart(2, '0')

/** 在 Annex-B 里找 SPS（NAL 类型 7），拼出 WebCodecs 要的 avc1.PPCCLL；没有就是 undefined。 */
function codecOf(data: Uint8Array): string | undefined {
  for (let i = 0; i + 6 < data.length; i += 1) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1 && ((data[i + 3] ?? 0) & 0x1f) === 7) return `avc1.${hex(data[i + 4])}${hex(data[i + 5])}${hex(data[i + 6])}`
  }
  return undefined
}

function joined(head: Uint8Array, tail: Uint8Array): Uint8Array {
  if (head.length === 0) return tail
  const all = new Uint8Array(head.length + tail.length)
  all.set(head)
  all.set(tail, head.length)
  return all
}

/** 小助手的原话换成你看得懂的。 */
function explain(error: string, app: string): string {
  if (/Screen Recording/i.test(error)) return t('小助手还没有屏幕录制权限：在 设置 → 用电脑 里点“打开授权窗口”授权')
  if (/App was not found/i.test(error)) return t('「{app}」还没打开，或者现在没有窗口', { app })
  return error
}

/**
 * 电脑面板的实时画面：从流式接口收小助手的一帧帧（类型 1 字节、长度 4 字节大端、内容），
 * 视频帧（flags 1 字节、时间 8 字节、Annex-B 的 H.264）交给 WebCodecs 解码画在 canvas 上。
 * 只看不动：接管以后你直接在这台 Mac 上操作。换了应用（app 变了）就重连。
 */
export function ComputerLiveView(props: { readonly app: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [problem, setProblem] = useState('')
  const [attempt, setAttempt] = useState(0)
  const { app } = props

  useEffect(() => {
    if (typeof VideoDecoder === 'undefined') {
      setProblem(t('这个浏览器不支持 WebCodecs，看不了电脑画面；换新版的 Chrome、Edge 或 Safari'))
      setPhase('error')
      return undefined
    }
    setPhase('loading')
    setProblem('')
    const abort = new AbortController()
    let decoder: VideoDecoder | undefined
    let codec = ''
    const draw = (frame: VideoFrame): void => {
      const canvas = canvasRef.current
      if (canvas !== null) {
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth
          canvas.height = frame.displayHeight
          // 画面按窗口实际的宽高比显示；全屏时按这个比例放到最大。
          canvas.style.setProperty('--pod-live-ratio', String(frame.displayWidth / frame.displayHeight))
        }
        canvas.getContext('2d')?.drawImage(frame, 0, 0)
        setPhase('live')
      }
      frame.close()
    }
    const video = (payload: Uint8Array): void => {
      if (payload.length <= 9) return
      const key = ((payload[0] ?? 0) & 1) === 1
      const timestamp = Number(new DataView(payload.buffer, payload.byteOffset + 1, 8).getBigUint64(0))
      const data = payload.slice(9)
      const found = key ? codecOf(data) : undefined
      // 关键帧带着 SPS：第一次、或者窗口大小变了换了编码参数时（重新）配置解码器。
      if (found !== undefined && (decoder === undefined || decoder.state === 'closed' || found !== codec)) {
        decoder?.close()
        decoder = new VideoDecoder({ output: draw, error: (error) => setProblem(error.message) })
        decoder.configure({ codec: found, optimizeForLatency: true })
        codec = found
      }
      if (decoder === undefined || decoder.state !== 'configured') return
      decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp, data }))
    }
    const meta = (value: Meta): void => {
      if (value.type === 'error' || (value.type === 'ended' && typeof value.error === 'string')) {
        setProblem(explain(value.error ?? '', app))
        setPhase('error')
      }
    }
    const read = async (): Promise<void> => {
      const response = await fetch(computerApi.streamUrl(String(Date.now())), { credentials: 'same-origin', signal: abort.signal })
      if (!response.ok || response.body === null) throw new Error(t('连不上电脑画面（{status}）', { status: String(response.status) }))
      const reader = response.body.getReader()
      let buffer: Uint8Array = new Uint8Array(0)
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer = joined(buffer, value)
        let offset = 0
        while (buffer.length - offset >= 5) {
          const length = new DataView(buffer.buffer, buffer.byteOffset + offset + 1, 4).getUint32(0)
          if (buffer.length - offset - 5 < length) break
          const type = buffer[offset]
          const payload = buffer.subarray(offset + 5, offset + 5 + length)
          offset += 5 + length
          if (type === 1) video(payload)
          else if (type === 2) meta(JSON.parse(new TextDecoder().decode(payload)) as Meta)
        }
        buffer = buffer.slice(offset)
      }
      setPhase((current) => (current === 'error' ? current : 'ended'))
    }
    read().catch((error: unknown) => {
      if (abort.signal.aborted) return
      setProblem(error instanceof Error ? error.message : String(error))
      setPhase('error')
    })
    return () => {
      abort.abort()
      if (decoder !== undefined && decoder.state !== 'closed') decoder.close()
    }
  }, [app, attempt])

  return (
    <div className="pod-live">
      <canvas ref={canvasRef} width={1280} height={800} />
      {phase === 'live' ? null : (
        <div className="pod-live-status pod-computer-status">
          {phase === 'loading' ? <span>{t('正在连接画面…')}</span> : <span>{phase === 'ended' ? t('画面断开了') : problem}</span>}
          {phase === 'loading' ? null : (
            <Button small onClick={() => setAttempt((value) => value + 1)}>
              {t('重新连接')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
