import { useEffect, type RefObject } from 'react'

/** 屏幕下面被挡住不到这么高时不算键盘（地址栏收起展开、取整误差）。 */
const KEYBOARD_MIN = 80

/**
 * 手机上弹出键盘时，键盘挡住的高度写进 --pod-keyboard，样式按它把输入框顶到键盘上面。
 * 键盘弹出时浏览器会把整页往上推，顶部的标题被推出屏幕；这里把页面推回去，靠留出的高度让输入框露出来。
 * enabled 为 false（宽屏）或浏览器不支持 visualViewport 时什么都不做。
 */
export function useKeyboardInset(root: RefObject<HTMLElement>, enabled: boolean): void {
  useEffect(() => {
    const viewport = typeof window === 'undefined' ? null : window.visualViewport
    const element = root.current
    if (!enabled || viewport === null || element === null) return
    let shown = -1
    const update = (): void => {
      const keyboard = window.innerHeight - viewport.height
      const open = keyboard >= KEYBOARD_MIN
      if (open && window.scrollY > 0 && element.contains(document.activeElement)) window.scrollTo(0, 0)
      const inset = open ? Math.max(0, Math.round(keyboard - viewport.offsetTop)) : 0
      if (inset === shown) return
      shown = inset
      element.style.setProperty('--pod-keyboard', `${inset}px`)
      element.classList.toggle('pod-keyboard-open', inset > 0)
    }
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    update()
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      element.style.removeProperty('--pod-keyboard')
      element.classList.remove('pod-keyboard-open')
    }
  }, [root, enabled])
}
