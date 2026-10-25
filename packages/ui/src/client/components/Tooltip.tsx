import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** 第一次悬停多久才出提示；刚看过一个提示，紧接着移到下一个按钮上就快一些。 */
const FIRST_DELAY = 450
const WARM_DELAY = 60
const WARM_FOR = 700
const GAP = 8
const EDGE = 8

interface Tip {
  readonly text: string
  readonly target: DOMRect
}

/**
 * 把按钮上的 title 换掉：悬停时浏览器自带的灰框太丑，这里统一画成 Pod 自己的小气泡。
 * 鼠标移到带 title 的元素上时把 title 挪到 data-pod-tip（浏览器就不再弹自带的），
 * 没有可读名字的图标按钮顺手补上 aria-label，读屏照样能读到。按下、滚动、按键或移开都会收起。
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | undefined>(undefined)
  const [place, setPlace] = useState<{ readonly left: number; readonly top: number } | undefined>(undefined)
  const bubble = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let current: HTMLElement | undefined
    let hiddenAt = 0
    const root = (): Element | null => document.querySelector('.pod-app')
    const hide = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      if (current !== undefined) hiddenAt = Date.now()
      current = undefined
      setTip(undefined)
    }
    const adopt = (element: HTMLElement): string => {
      const title = element.getAttribute('title')
      if (title !== null) {
        element.removeAttribute('title')
        element.dataset.podTip = title
        // 补上的 aria-label 记一下，title 变了跟着变。
        const named = element.hasAttribute('aria-labelledby') || (element.textContent ?? '').trim() !== '' || (element.hasAttribute('aria-label') && element.dataset.podTipLabel === undefined)
        if (!named && title.trim() !== '') {
          element.setAttribute('aria-label', title)
          element.dataset.podTipLabel = '1'
        }
      }
      return element.dataset.podTip ?? ''
    }
    const onOver = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return
      const app = root()
      const start = event.target instanceof Element ? event.target : null
      const element = start?.closest<HTMLElement>('[title], [data-pod-tip]') ?? null
      if (element === null || app === null || !app.contains(element) || element.closest('.pod-tip') !== null) {
        if (element === null) hide()
        return
      }
      if (element === current) return
      const text = adopt(element)
      hide()
      if (text === '') return
      current = element
      const delay = Date.now() - hiddenAt < WARM_FOR ? WARM_DELAY : FIRST_DELAY
      timer = setTimeout(() => {
        if (current !== element || !element.isConnected) return
        setTip({ text, target: element.getBoundingClientRect() })
      }, delay)
    }
    const onOut = (event: PointerEvent): void => {
      if (current === undefined) return
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null
      if (next !== null && current.contains(next)) return
      hide()
    }
    // 只是把 title 先挪走，避免鼠标停在元素上时浏览器抢先弹出自带的提示。
    const onMove = (event: PointerEvent): void => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[title]') : null
      if (element !== null && root()?.contains(element) === true) adopt(element)
    }
    document.addEventListener('pointerover', onOver, true)
    document.addEventListener('pointerout', onOut, true)
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('keydown', hide, true)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      hide()
      document.removeEventListener('pointerover', onOver, true)
      document.removeEventListener('pointerout', onOut, true)
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('keydown', hide, true)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // 默认放在元素上方居中；上面放不下就放下方，左右不出窗口。
  useLayoutEffect(() => {
    if (tip === undefined) {
      setPlace(undefined)
      return
    }
    const box = bubble.current?.getBoundingClientRect()
    if (box === undefined) return
    const center = tip.target.left + tip.target.width / 2
    const left = Math.max(EDGE, Math.min(window.innerWidth - box.width - EDGE, center - box.width / 2))
    const above = tip.target.top - GAP - box.height
    const top = above >= EDGE ? above : Math.min(window.innerHeight - box.height - EDGE, tip.target.bottom + GAP)
    setPlace({ left, top })
  }, [tip])

  if (tip === undefined) return null
  return (
    <div ref={bubble} className={`pod-tip${place === undefined ? '' : ' pod-tip-on'}`} role="tooltip" style={place === undefined ? { left: 0, top: 0 } : place}>
      {tip.text}
    </div>
  )
}
