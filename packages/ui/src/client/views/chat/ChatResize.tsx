import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { t } from 'pod-domain'
import { CHAT_WIDTH_DEFAULT, CHAT_WIDTH_MIN, clampWidth, previewChatWidth, saveChatWidth, setChatWidth, type ChatWidth } from '../../state/chatWidth.ts'

/** 键盘上每按一下左右键变多少像素。 */
const STEP = 40

/**
 * 对话区右边缘的拖动条：左右拖改聊天宽度（对话居中，两边一起变），拖到头就是铺满，双击回到默认；
 * 也能用键盘左右键调。宽度只存在这台设备上，手机上没有这个。
 */
export function ChatResize(props: { readonly width: ChatWidth }) {
  const start = useRef<{ readonly x: number; readonly width: number; readonly room: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const roomOf = (element: HTMLElement): number => element.parentElement?.clientWidth ?? window.innerWidth
  const widthIn = (room: number): number => (props.width === 'full' ? room : Math.min(props.width, room))
  const toWidth = (value: number, room: number): ChatWidth => (value >= room ? 'full' : Math.max(CHAT_WIDTH_MIN, Math.round(value)))

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const room = roomOf(event.currentTarget)
    start.current = { x: event.clientX, width: widthIn(room), room }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    setDragging(true)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const from = start.current
    if (from === null) return
    previewChatWidth(toWidth(from.width + (event.clientX - from.x) * 2, from.room))
  }
  const onPointerEnd = (): void => {
    if (start.current === null) return
    start.current = null
    setDragging(false)
    saveChatWidth()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const room = roomOf(event.currentTarget)
    const next = widthIn(room) + (event.key === 'ArrowRight' ? STEP : -STEP) * 2
    setChatWidth(next >= room ? 'full' : clampWidth(next))
  }

  return (
    <div
      className={`pod-chat-resize${dragging ? ' pod-chat-resize-on' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('聊天宽度：左右拖动调整，双击恢复默认')}
      title={t('左右拖动调整聊天宽度，双击恢复默认')}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={() => setChatWidth(CHAT_WIDTH_DEFAULT)}
      onKeyDown={onKeyDown}
    />
  )
}
