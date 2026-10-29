import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** 一行字被 text-overflow 截成省略号了没有：放不下时调用方给它补上 title，悬停能看全。宽度变了重新量。 */
export function useClipped<T extends HTMLElement>(text: string): readonly [RefObject<T>, boolean] {
  const ref = useRef<T>(null)
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const check = (): void => setClipped(element.scrollWidth > element.clientWidth + 1)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])
  return [ref, clipped]
}
