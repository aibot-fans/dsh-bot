import { useEffect, useMemo, useRef } from 'react'
import { pageViewUrl, type PageTheme } from '../../api/pages.ts'

/**
 * 显示页面的 iframe：sandbox 只给 allow-scripts（不给 allow-same-origin），页面是不透明来源，碰不到 dsh 的登录状态；
 * 页面的 CSP 不让它联网。深浅色跟着 dsh，切换时发消息过去，不用重新加载；页面里的链接交给这里用新窗口打开。
 */
export function PageFrame(props: { readonly id: string; readonly version: number | undefined; readonly latest: number; readonly theme: PageTheme; readonly title: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const theme = useRef(props.theme)
  theme.current = props.theme
  // 地址只跟页面和版本走；深浅色变化用消息通知，免得重新加载丢掉翻到的那一页。
  const src = useMemo(() => pageViewUrl(props.id, { version: props.version, latest: props.latest, theme: theme.current }), [props.id, props.version, props.latest])
  const sendTheme = (): void => {
    frame.current?.contentWindow?.postMessage({ type: 'pod-page-theme', theme: theme.current }, '*')
  }
  useEffect(sendTheme, [props.theme])
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source === null || event.source !== frame.current?.contentWindow) return
      const data = event.data as { readonly type?: unknown; readonly href?: unknown } | null
      if (data?.type !== 'pod-page-link' || typeof data.href !== 'string' || !/^(https?:|mailto:)/i.test(data.href)) return
      window.open(data.href, '_blank', 'noopener,noreferrer')
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  return <iframe ref={frame} className="pod-page-frame" src={src} sandbox="allow-scripts" title={props.title} referrerPolicy="no-referrer" onLoad={sendTheme} />
}
