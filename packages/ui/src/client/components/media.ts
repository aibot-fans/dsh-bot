import { useSyncExternalStore } from 'react'

/** 手机这样的窄屏：Pod 换成一次一页（列表、对话、详情）。和样式里的 760px 断点一致。 */
export const NARROW_QUERY = '(max-width: 760px)'

/** 没有鼠标悬停的设备（手机、平板）：操作靠长按，不靠鼠标移上去浮出的按钮。 */
export const TOUCH_QUERY = '(hover: none)'

const lists = new Map<string, MediaQueryList>()

function listOf(query: string): MediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
  const known = lists.get(query)
  if (known !== undefined) return known
  const created = window.matchMedia(query)
  lists.set(query, created)
  return created
}

/** 现在是否符合这个媒体查询；不在浏览器里当成不符合。 */
export function matches(query: string): boolean {
  return listOf(query)?.matches === true
}

/** 跟着媒体查询变的布尔值：转屏、改窗口大小时自动更新。 */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = listOf(query)
      list?.addEventListener('change', listener)
      return () => list?.removeEventListener('change', listener)
    },
    () => matches(query),
    () => false,
  )
}

export function useNarrow(): boolean {
  return useMedia(NARROW_QUERY)
}

export function useTouch(): boolean {
  return useMedia(TOUCH_QUERY)
}
