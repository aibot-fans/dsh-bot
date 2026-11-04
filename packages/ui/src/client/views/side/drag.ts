import { useState, type DragEvent } from 'react'
import { SIDEBAR_BOTS, SIDEBAR_GROUPS, SIDEBAR_PINNED, moveSidebarItem, t, type SidebarItem, type SidebarSections } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { useApp } from '../../state/app.ts'
import type { SidebarStore } from './prefs.ts'

/** 一行上的拖放：整行可拖（主管除外），拖到别的栏的行上就是放进那一栏。 */
export interface RowDrag {
  readonly draggable: boolean
  readonly onDragStart: (event: DragEvent) => void
  readonly onDragOver: (event: DragEvent) => void
  readonly onDrop: (event: DragEvent) => void
  readonly onDragEnd: () => void
}

/** 栏标题上的拖放：放进这一栏（空的分组只能这样放进去）。 */
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

/** Bot 栏只收 bot，群聊栏只收群聊；置顶和分组什么都收。 */
function accepts(section: string, item: SidebarItem): boolean {
  if (section === SIDEBAR_BOTS) return item.kind === 'bot'
  if (section === SIDEBAR_GROUPS) return item.kind === 'group'
  return true
}

/**
 * 侧栏拖动：拖进置顶是置顶，拖出置顶是取消置顶；拖进分组是放进分组，拖回 Bot 或群聊是移出分组。
 * 每一栏都按最新消息排，同一栏里拖不改顺序；主管固定在最上面，不能拖。拖到别的栏时那一栏的标题亮起来。
 */
export function useSideDrag(sections: SidebarSections, store: SidebarStore, onError: (message: string) => void): SideDrag {
  const app = useApp()
  const [dragging, setDragging] = useState<{ readonly item: SidebarItem; readonly from: string } | undefined>(undefined)
  const [over, setOver] = useState<string | undefined>(undefined)

  const reset = (): void => {
    setDragging(undefined)
    setOver(undefined)
  }

  const setPinned = (item: SidebarItem, pinned: boolean): Promise<unknown> => {
    const target = item.room !== undefined ? Promise.resolve(item.room) : item.bot === undefined ? Promise.reject(new Error(t('找不到这个对话'))) : api.openDirect(item.bot.id)
    return target.then((room) => api.updateRoom(room.id, { pinned })).then(() => app.cache.invalidate('rooms'))
  }

  /** 能不能放进这一栏：要是别的栏，而且收这种（Bot 栏只收 bot，群聊栏只收群聊）。 */
  const droppable = (section: string): boolean => dragging !== undefined && dragging.from !== section && accepts(section, dragging.item)

  const drop = (section: string): void => {
    const source = dragging
    reset()
    if (source === undefined || source.from === section || !accepts(section, source.item)) return
    const { item, from } = source
    const folder = section === SIDEBAR_PINNED ? undefined : section === SIDEBAR_BOTS || section === SIDEBAR_GROUPS ? null : section
    if (folder !== undefined) store.save((prefs) => moveSidebarItem(prefs, item.key, folder))
    const pin = section === SIDEBAR_PINNED ? true : from === SIDEBAR_PINNED ? false : undefined
    if (pin !== undefined) setPinned(item, pin).catch((reason: unknown) => onError(errorText(reason)))
  }

  const enter = (section: string, event: DragEvent): void => {
    if (!droppable(section)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (over !== section) setOver(section)
  }

  const row = (section: string, item: SidebarItem): RowDrag => ({
    draggable: !isLead(item),
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', item.key)
      setDragging({ item, from: section })
    },
    onDragOver: (event) => enter(section, event),
    onDrop: (event) => {
      event.preventDefault()
      drop(section)
    },
    onDragEnd: reset,
  })

  const head = (section: string): HeadDrag => ({
    onDragOver: (event) => enter(section, event),
    onDrop: (event) => {
      event.preventDefault()
      drop(section)
    },
    active: dragging !== undefined && over === section,
  })

  return { row, head }
}
