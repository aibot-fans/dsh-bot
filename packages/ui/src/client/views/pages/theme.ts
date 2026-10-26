import { useEffect, useState } from 'react'
import type { PageTheme } from '../../api/pages.ts'

const SENTINEL = '#010203'

/** 任意 CSS 颜色换成 RGB：交给 canvas 解析，oklch、color-mix 这些写法也认。 */
function toRgb(color: string): readonly [number, number, number] | undefined {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return undefined
  context.fillStyle = SENTINEL
  context.fillStyle = color
  if (context.fillStyle === SENTINEL) return undefined
  context.fillRect(0, 0, 1, 1)
  const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data
  return [red, green, blue]
}

/** dsh 现在是深色还是浅色：看它的底色变量有多亮；取不到就跟系统设置。 */
function surfaceTheme(): PageTheme {
  if (typeof document === 'undefined') return 'light'
  const app = document.querySelector('.pod-app')
  const raw = app === null ? '' : getComputedStyle(app).getPropertyValue('--dsw-alias-bg-layer-1').trim()
  const rgb = raw === '' ? undefined : toRgb(raw)
  if (rgb === undefined) return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true ? 'dark' : 'light'
  const [red, green, blue] = rgb
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 < 0.5 ? 'dark' : 'light'
}

/** 跟着 dsh 切换深浅色：页面用同一套深浅，图表在两种底色下都看得清。 */
export function useSurfaceTheme(): PageTheme {
  const [theme, setTheme] = useState<PageTheme>(surfaceTheme)
  useEffect(() => {
    const read = (): void => setTheme(surfaceTheme())
    // 第一次渲染时 .pod-app 可能还没挂上（外壳自己就在用它），挂上以后再读一次。
    read()
    const observer = new MutationObserver(read)
    for (const node of [document.documentElement, document.body]) observer.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'] })
    observer.observe(document.head, { childList: true })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', read)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', read)
    }
  }, [])
  return theme
}
