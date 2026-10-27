import { useState, type DragEvent } from 'react'
import { SIDEBAR_BOTS, SIDEBAR_GROUPS, SIDEBAR_PINNED, moveSidebarItem, reorderSidebar, t, type SidebarItem, type SidebarPrefs, type SidebarSections } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { useApp } from '../../state/app.ts'
import type { SidebarStore } from './prefs.ts'

/** 拖到哪一栏、排在哪一条前面；before 为 null 时放到这一栏最后。 */
interface DropTarget {
  readonly section: string
  readonly before: string | null
}

/** 一行上的拖放：整行可拖（主管除外），拖到别的行上方或下方。 */
export interface RowDrag {
  readonly draggable: boolean
  readonly onDragStart: (event: DragEvent) => void
  readonly onDragOver: (event: DragEvent) => void
  readonly onDrop: (event: DragEvent) => void
  readonly onDragEnd: () => void
  /** 正拖到这一行时，提示线画在上面还是下面。 */
  readonly mark: 'before' | 'after' | undefined
}

/** 栏标题上的拖放：放到这一栏最前面（空的分组只能这样放进去）。 */
export interface HeadDrag {
  readonly onDragOver: (event: DragEvent) => void
  readonly onDrop: (event: DragEvent) => void
  readonly active: boolean
}

export interface SideDrag {
  readonly row: (section: string, item: SidebarItem) => RowDrag
  readonly head: (section: string) => HeadDrag
}

const isLead = (item: SidebarItem): boolean => item.bot?.role === 'lead'

/** 这一栏现在显示的完整顺序（不含固定在最前面的主管）。 */
function keysOf(sections: SidebarSections, section: string): readonly string[] {
  if (section === SIDEBAR_PINNED) return sections.pinned.filter((item) => !isLead(item)).map((item) => item.key)
  if (section === SIDEBAR_BOTS) return sections.bots.map((item) => item.key)
  if (section === SIDEBAR_GROUPS) return sections.groups.map((item) => item.key)
  return sections.folders.find((entry) => entry.folder.id === section)?.items.map((item) => item.key) ?? []
}

/** Bot 栏只收 bot，群聊栏只收群聊；置顶和分组什么都收。 */
function accepts(section: string, item: SidebarItem): boolean {
  if (section === SIDEBAR_BOTS) return item.kind === 'bot'
  if (section === SIDEBAR_GROUPS) return item.kind === 'group'
  return true
}

/**
 * 侧栏拖动排序：同一栏里拖是换顺序；拖进置顶是置顶，拖出置顶是取消置顶；
 * 拖进分组是放进分组，拖回 Bot 或群聊是移出分组。主管固定在最上面，不能拖。
 */
export function useSideDrag(sections: SidebarSections, store: SidebarStore, onError: (message: string) => void): SideDrag {
  const app = useApp()
  const [dragging, setDragging] = useState<{ readonly item: SidebarItem; readonly from: string } | undefined>(undefined)
  const [over, setOver] = useState<(DropTarget & { readonly key: string | null; readonly after: boolean }) | undefined>(undefined)

  const reset = (): void => {
    setDragging(undefined)
    setOver(undefined)
  }

  const setPinned = (item: SidebarItem, pinned: boolean): Promise<unknown> => {
    const target = item.room !== undefined ? Promise.resolve(item.room) : item.bot === undefined ? Promise.reject(new Error(t('找不到这个对话'))) : api.openDirect(item.bot.id)
    return target.then((room) => api.updateRoom(room.id, { pinned })).then(() => app.cache.invalidate('rooms'))
  }

  const drop = (target: DropTarget): void => {
    const source = dragging
    reset()
    if (source === undefined || !accepts(target.section, source.item)) return
    const { item, from } = source
    // 放回自己原来的位置：什么都不用改。
    if (target.before === item.key) return
    const order = (prefs: SidebarPrefs): SidebarPrefs => reorderSidebar(prefs, target.section, keysOf(sections, target.section), item.key, target.before)
    if (from === target.section) {
      store.save(order)
      return
    }
    const folder = target.section === SIDEBAR_PINNED ? undefined : target.section === SIDEBAR_BOTS || target.section === SIDEBAR_GROUPS ? null : target.section
    store.save((prefs) => order(folder === undefined ? prefs : moveSidebarItem(prefs, item.key, folder)))
    const pin = target.section === SIDEBAR_PINNED ? true : from === SIDEBAR_PINNED ? false : undefined
    if (pin !== undefined) setPinned(item, pin).catch((reason: unknown) => onError(errorText(reason)))
  }

  const row = (section: string, item: SidebarItem): RowDrag => ({
    draggable: !isLead(item),
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', item.key)
      setDragging({ item, from: section })
    },
    onDragOver: (event) => {
      if (dragging === undefined || !accepts(section, dragging.item)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const box = event.currentTarget.getBoundingClientRect()
      // 主管上面放不了东西：拖到主管身上按放在它下面算。
      const after = isLead(item) || event.clientY > box.top + box.height / 2
      if (over?.key !== item.key || over.after !== after) setOver({ section, before: null, key: item.key, after })
    },
    onDrop: (event) => {
      event.preventDefault()
      if (over === undefined) return reset()
      const keys = keysOf(sections, section)
      const index = isLead(item) ? -1 : keys.indexOf(item.key)
      drop({ section, before: over.after ? (keys[index + 1] ?? null) : item.key })
    },
    onDragEnd: reset,
    mark: over?.key === item.key && dragging?.item.key !== item.key ? (over.after ? 'after' : 'before') : undefined,
  })

  const head = (section: string): HeadDrag => ({
    onDragOver: (event) => {
      if (dragging === undefined || !accepts(section, dragging.item)) return
      event.preventDefault()
      if (over?.section !== section || over.key !== null) setOver({ section, before: null, key: null, after: false })
    },
    onDrop: (event) => {
      event.preventDefault()
      drop({ section, before: keysOf(sections, section)[0] ?? null })
    },
    active: dragging !== undefined && over?.section === section && over.key === null,
  })

  return { row, head }
}
