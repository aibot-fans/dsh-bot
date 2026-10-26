import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Icon } from './Icon.tsx'
import { useNarrow } from './media.ts'

export interface MenuControl {
  readonly open: boolean
  readonly toggle: () => void
  /** 在某一点打开（右键、长按）：菜单的左上角贴着这个点，放不下就往左、往上翻。 */
  readonly openAt: (x: number, y: number) => void
  readonly close: () => void
  readonly anchor: RefObject<HTMLButtonElement>
  readonly panel: RefObject<HTMLDivElement>
  readonly style: CSSProperties
}

interface Point {
  readonly x: number
  readonly y: number
}

/**
 * 贴着按钮（或右键、长按的那一点）弹出的菜单：用 fixed 定位，侧栏的滚动区域裁不掉它；下面放不下就往上翻。
 * 点外面、按 Esc、滚动或改窗口大小都会关上。菜单内容变了（比如切到子菜单）就把 revision 换一个值，重新量位置。
 * 手机上是从底下升起的面板（MenuPanel 负责画），不跟着滚动和改窗口大小关：弹键盘、收地址栏都会触发这两个事件。
 */
export function useMenu(align: 'start' | 'end' = 'end', revision: unknown = 0): MenuControl {
  const narrow = useNarrow()
  const [open, setOpen] = useState(false)
  const [point, setPoint] = useState<Point | undefined>(undefined)
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' })
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const trigger = point === undefined ? anchor.current?.getBoundingClientRect() : { left: point.x, right: point.x, top: point.y, bottom: point.y }
    const box = panel.current?.getBoundingClientRect()
    if (trigger === undefined || box === undefined) return
    const width = box.width
    const height = box.height
    const start = point === undefined && align === 'end' ? trigger.right - width : trigger.left
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, start))
    const below = trigger.bottom + (point === undefined ? 4 : 2)
    const top = below + height > window.innerHeight - 8 ? Math.max(8, trigger.top - height - (point === undefined ? 4 : 2)) : below
    setStyle({ position: 'fixed', top, left, visibility: 'visible' })
  }, [open, align, revision, point])

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (panel.current?.contains(target) === true || anchor.current?.contains(target) === true) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onScroll = (event: Event): void => {
      if (panel.current?.contains(event.target as Node) === true) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    if (!narrow) {
      window.addEventListener('resize', close)
      window.addEventListener('scroll', onScroll, true)
    }
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, narrow])

  return {
    open,
    toggle: () => {
      setPoint(undefined)
      setStyle({ position: 'fixed', visibility: 'hidden' })
      setOpen((value) => !value)
    },
    openAt: (x, y) => {
      setPoint({ x, y })
      setStyle({ position: 'fixed', visibility: 'hidden' })
      setOpen(true)
    },
    close: () => setOpen(false),
    anchor,
    panel,
    style,
  }
}

/**
 * 菜单本体：放在触发按钮旁边渲染即可。
 * 手机上画成从底下升起的面板：上面一行小字是 label（wide 的菜单自己带标题，不重复），下面一个“取消”，点暗处也关上。
 */
export function MenuPanel(props: { readonly control: MenuControl; readonly label: string; readonly children: ReactNode; readonly wide?: boolean }) {
  const narrow = useNarrow()
  if (!props.control.open) return null
  if (narrow) {
    return (
      <div
        ref={props.control.panel}
        className="pod-sheet-backdrop"
        onClick={(event) => {
          event.stopPropagation()
          props.control.close()
        }}
      >
        <div className={`pod-sheet${props.wide === true ? ' pod-sheet-wide' : ''}`} role="menu" aria-label={props.label} onClick={(event) => event.stopPropagation()}>
          {props.wide === true ? null : <div className="pod-sheet-title">{props.label}</div>}
          <div className="pod-sheet-body">{props.children}</div>
          <button type="button" className="pod-sheet-cancel" onClick={props.control.close}>
            取消
          </button>
        </div>
      </div>
    )
  }
  return (
    <div ref={props.control.panel} className={`pod-menu${props.wide === true ? ' pod-menu-wide' : ''}`} role="menu" aria-label={props.label} style={props.control.style} onClick={(event) => event.stopPropagation()}>
      {props.children}
    </div>
  )
}

export function MenuItem(props: { readonly icon?: string; readonly label: string; readonly onClick: () => void; readonly danger?: boolean; readonly checked?: boolean; readonly hint?: string }) {
  return (
    <button type="button" className={`pod-menu-item${props.danger === true ? ' pod-menu-danger' : ''}`} role={props.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={props.checked} onClick={props.onClick}>
      <span className="pod-menu-icon">{props.checked === true ? <Icon name="check" size={15} /> : props.icon === undefined ? null : <Icon name={props.icon} size={15} />}</span>
      <span className="pod-menu-text">{props.label}</span>
      {props.hint === undefined ? null : <span className="pod-menu-hint">{props.hint}</span>}
    </button>
  )
}

export function MenuDivider() {
  return <div className="pod-menu-divider" role="separator" />
}
