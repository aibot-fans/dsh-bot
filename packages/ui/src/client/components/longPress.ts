import { useRef, type MouseEvent, type TouchEvent } from 'react'

/** 按住多久算长按。 */
const HOLD_MS = 480

/** 手指移动超过这么多像素就当成在滚动，不算长按。 */
const SLOP = 10

export interface LongPressHandlers {
  readonly onTouchStart: (event: TouchEvent) => void
  readonly onTouchMove: (event: TouchEvent) => void
  readonly onTouchEnd: () => void
  readonly onTouchCancel: () => void
  readonly onClickCapture: (event: MouseEvent) => void
}

/**
 * 触屏上的长按：按住不动约半秒就调 onPress（带手指的位置），这一次按下之后的点击不再算数。
 * 手指一动（在滚动）、抬起或被打断都取消。enabled 为 false 时什么都不做。
 */
export function useLongPress(onPress: (x: number, y: number) => void, enabled = true): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const origin = useRef<{ readonly x: number; readonly y: number } | undefined>(undefined)
  const fired = useRef(false)
  const cancel = (): void => {
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = undefined
  }
  return {
    onTouchStart: (event) => {
      const touch = event.touches[0]
      if (!enabled || event.touches.length !== 1 || touch === undefined) return
      const x = touch.clientX
      const y = touch.clientY
      fired.current = false
      origin.current = { x, y }
      cancel()
      timer.current = setTimeout(() => {
        timer.current = undefined
        fired.current = true
        navigator.vibrate?.(8)
        onPress(x, y)
      }, HOLD_MS)
    },
    onTouchMove: (event) => {
      const touch = event.touches[0]
      const start = origin.current
      if (touch === undefined || start === undefined) return
      if (Math.abs(touch.clientX - start.x) > SLOP || Math.abs(touch.clientY - start.y) > SLOP) cancel()
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onClickCapture: (event) => {
      if (!fired.current) return
      fired.current = false
      event.preventDefault()
      event.stopPropagation()
    },
  }
}
