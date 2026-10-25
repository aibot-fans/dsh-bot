import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Icon } from './Icon.tsx'

export interface MenuControl {
  readonly open: boolean
  readonly toggle: () => void
  readonly close: () => void
  readonly anchor: RefObject<HTMLButtonElement>
  readonly panel: RefObject<HTMLDivElement>
  readonly style: CSSProperties
}

/**
 * 贴着按钮弹出的菜单：用 fixed 定位，侧栏的滚动区域裁不掉它；下面放不下就往上翻。
 * 点外面、按 Esc、滚动或改窗口大小都会关上。菜单内容变了（比如切到子菜单）就把 revision 换一个值，重新量位置。
 */
export function useMenu(align: 'start' | 'end' = 'end', revision: unknown = 0): MenuControl {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' })
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const trigger = anchor.current?.getBoundingClientRect()
    const box = panel.current?.getBoundingClientRect()
    if (trigger === undefined || box === undefined) return
    const width = box.width
    const height = box.height
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, align === 'end' ? trigger.right - width : trigger.left))
    const below = trigger.bottom + 4
    const top = below + height > window.innerHeight - 8 ? Math.max(8, trigger.top - height - 4) : below
    setStyle({ position: 'fixed', top, left, visibility: 'visible' })
  }, [open, align, revision])

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
    window.addEventListener('resize', close)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  return {
    open,
    toggle: () => {
      setStyle({ position: 'fixed', visibility: 'hidden' })
      setOpen((value) => !value)
    },
    close: () => setOpen(false),
    anchor,
    panel,
    style,
  }
}

/** 菜单本体：放在触发按钮旁边渲染即可。 */
export function MenuPanel(props: { readonly control: MenuControl; readonly label: string; readonly children: ReactNode; readonly wide?: boolean }) {
  if (!props.control.open) return null
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
