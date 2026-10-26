import { useEffect, useState, type ReactNode } from 'react'
import {
  SIDEBAR_BOTS,
  SIDEBAR_GROUPS,
  SIDEBAR_PINNED,
  removeSidebarFolder,
  renameSidebarFolder,
  sidebarSections,
  toggleSidebarFolder,
  type Bot,
  type SidebarFolder,
  type SidebarItem,
} from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import type { StreamState } from '../../api/events.ts'
import { errorText } from '../../api/http.ts'
import { Icon } from '../../components/Icon.tsx'
import { MenuItem, MenuPanel, useMenu } from '../../components/Menu.tsx'
import { useNarrow, useTouch } from '../../components/media.ts'
import { RenameInput } from '../../components/RenameInput.tsx'
import { useApp, useLiveRooms, useNav } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { useSideDrag, type HeadDrag } from './drag.ts'
import { useSidebarPrefs, type SidebarStore } from './prefs.ts'
import { SideItem } from './SideItem.tsx'

/** Bot 和群聊默认各显示几条，其余点“更多”。 */
const SHOWN = 5

function useStreamState(): StreamState {
  const app = useApp()
  const [state, setState] = useState<StreamState>(app.events.state)
  useEffect(() => app.events.onState(setState), [app])
  return state
}

/** 一栏的标题：名字、右边的按钮。侧栏收起时只留一条分隔线。拖到标题上就放到这一栏最前面。 */
function SectionHead(props: { readonly title: string; readonly collapsed: boolean; readonly action?: ReactNode; readonly drop?: HeadDrag }) {
  if (props.collapsed) return <span className="pod-side-divider" />
  return (
    <div className={`pod-side-section${props.drop?.active === true ? ' pod-side-drop-head' : ''}`} onDragOver={props.drop?.onDragOver} onDrop={props.drop?.onDrop}>
      <span>{props.title}</span>
      {props.action}
    </div>
  )
}

/** 你建的分组：点标题收起或展开；“…”里改名、删除（删分组不删里面的东西）。 */
function FolderHead(props: { readonly folder: SidebarFolder; readonly count: number; readonly folded: boolean; readonly store: SidebarStore; readonly drop: HeadDrag }) {
  const { folder, store } = props
  const menu = useMenu()
  const [renaming, setRenaming] = useState(false)
  if (renaming) {
    return (
      <div className="pod-side-section pod-side-folder">
        <RenameInput
          value={folder.name}
          max={12}
          label={`给分组「${folder.name}」改名`}
          onSave={(name) => {
            setRenaming(false)
            store.save((prefs) => renameSidebarFolder(prefs, folder.id, name))
          }}
          onCancel={() => setRenaming(false)}
        />
      </div>
    )
  }
  return (
    <div className={`pod-side-section pod-side-folder${props.drop.active ? ' pod-side-drop-head' : ''}`} onDragOver={props.drop.onDragOver} onDrop={props.drop.onDrop}>
      <button type="button" className="pod-side-folder-toggle" aria-expanded={!props.folded} onClick={() => store.save((prefs) => toggleSidebarFolder(prefs, folder.id))}>
        <Icon name={props.folded ? 'forward' : 'expand'} size={12} />
        <Icon name="folder" size={14} />
        <span className="pod-ellipsis">{folder.name}</span>
        <span className="pod-side-count">{props.count}</span>
      </button>
      <button ref={menu.anchor} type="button" className="pod-icon-button" aria-label={`分组「${folder.name}」的操作`} aria-expanded={menu.open} onClick={menu.toggle}>
        <Icon name="more" size={14} />
      </button>
      <MenuPanel control={menu} label={`分组「${folder.name}」的操作`}>
        <MenuItem
          icon="edit"
          label="改名"
          onClick={() => {
            menu.close()
            setRenaming(true)
          }}
        />
        <MenuItem
          icon="trash"
          label="删除分组"
          hint="里面的不会删"
          danger
          onClick={() => {
            menu.close()
            if (window.confirm(`删除分组「${folder.name}」？里面的 bot 和群聊会回到原来的列表，不会被删除。`)) store.save((prefs) => removeSidebarFolder(prefs, folder.id))
          }}
        />
      </MenuPanel>
    </div>
  )
}

/** 列表太长时只显示前几条；正在看的那条总是显示。 */
function limit(items: readonly SidebarItem[], expanded: boolean, roomId: string | null): { readonly shown: readonly SidebarItem[]; readonly hidden: number } {
  if (expanded || items.length <= SHOWN) return { shown: items, hidden: 0 }
  const head = items.slice(0, SHOWN)
  const current = items.find((item) => item.room !== undefined && item.room.id === roomId)
  const shown = current !== undefined && !head.includes(current) ? [...head, current] : head
  return { shown, hidden: items.length - shown.length }
}

/**
 * 左侧栏：顶部是搜索、新对话、临时对话，最右边是收起按钮；下面是置顶（主管总在第一个）、你建的分组、Bot、群聊，
 * Bot 和群聊默认各显示 5 条，拖动可以排顺序；归档的不在侧栏里，在设置的“归档”里看；最底下是设置。
 * 手机上它就是列表页：占满整屏、不能收起、全部显示；触屏上不能拖，排顺序用菜单里的置顶和移到分组。
 */
export function Sidebar() {
  const app = useApp()
  const nav = useNav()
  const narrow = useNarrow()
  const touch = useTouch()
  const live = useLiveRooms()
  const stream = useStreamState()
  const store = useSidebarPrefs()
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [more, setMore] = useState<{ readonly bots: boolean; readonly groups: boolean }>({ bots: false, groups: false })
  const collapsed = nav.sidebarCollapsed && !narrow
  const sections = sidebarSections(bots ?? [], rooms ?? [], store.prefs)
  const drag = useSideDrag(sections, store, setProblem)
  const byId = new Map((bots ?? []).map((bot) => [bot.id, bot]))
  const lead = (bots ?? []).find((bot) => bot.role === 'lead')

  /** 新对话：和主管开一段空白的新对话，之前的在对话记录里。和别的 bot 开新对话在对话顶部。 */
  const startNew = (): void => {
    if (lead === undefined) return
    setProblem(undefined)
    api
      .newConversation({ botId: lead.id })
      .then((room) => {
        app.cache.invalidate('rooms')
        app.openRoom(room.id)
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }

  const row =
    (section: string) =>
    (item: SidebarItem): ReactNode => {
      const members = item.kind === 'group' ? (item.room?.memberIds ?? []).map((id) => byId.get(id)).filter((bot): bot is Bot => bot !== undefined) : []
      const busy = item.rooms.some((thread) => live.has(thread.id) || thread.busy)
      return <SideItem key={item.key} item={item} members={members} busy={busy} collapsed={collapsed} store={store} onError={setProblem} drag={touch ? undefined : drag.row(section, item)} />
    }
  const moreButton = (hidden: number, expanded: boolean, toggle: () => void): ReactNode =>
    collapsed || (hidden === 0 && !expanded) ? null : (
      <button type="button" className="pod-side-toggle" onClick={toggle}>
        {expanded ? '收起' : `更多（${hidden}）`}
      </button>
    )
  const botList = limit(sections.bots, more.bots || narrow, nav.roomId)
  const groupList = limit(sections.groups, more.groups || narrow, nav.roomId)

  return (
    <nav className={`pod-side${collapsed ? ' pod-side-collapsed' : ''}`} aria-label="Bot 和群聊">
      <div className="pod-side-top">
        {collapsed ? null : (
          <span className="pod-side-brand">
            dsh-bot
            <span className={`pod-conn pod-conn-${stream}`} title={stream === 'open' ? '实时连接正常' : '正在重连…'} />
          </span>
        )}
        <button type="button" className="pod-round" aria-label="搜索" title="搜索" onClick={() => app.openSearch('')}>
          <Icon name="search" size={18} />
        </button>
        <button type="button" className="pod-round" aria-label="和主管开新对话" title="和主管开新对话（和别的 bot 开新对话：在对话顶部点同样的按钮）" onClick={startNew}>
          <Icon name="compose" size={18} />
        </button>
        <button type="button" className="pod-round" aria-label="临时对话：不进列表、不写记忆" title="临时对话：不进列表、不写记忆，离开就删" onClick={() => lead !== undefined && app.startTemporary(lead.id)}>
          <Icon name="incognito" size={18} />
        </button>
        {narrow ? null : (
          <button type="button" className="pod-icon-button pod-side-fold" aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => app.navigate({ sidebarCollapsed: !collapsed })}>
            <Icon name="sidebar" size={18} />
          </button>
        )}
      </div>
      {problem === undefined ? null : (
        <p className="pod-form-error pod-side-error" role="alert" onClick={() => setProblem(undefined)}>
          {problem}
        </p>
      )}
      <div className="pod-side-scroll">
        {sections.pinned.length === 0 ? null : (
          <>
            <SectionHead title="置顶" collapsed={collapsed} drop={drag.head(SIDEBAR_PINNED)} />
            {sections.pinned.map(row(SIDEBAR_PINNED))}
          </>
        )}
        {sections.folders.map(({ folder, items }) => {
          const folded = store.prefs.collapsed.includes(folder.id)
          return (
            <div key={folder.id} className="pod-side-group">
              {collapsed ? <span className="pod-side-divider" /> : <FolderHead folder={folder} count={items.length} folded={folded} store={store} drop={drag.head(folder.id)} />}
              {folded && !collapsed ? null : items.map(row(folder.id))}
              {!folded && !collapsed && items.length === 0 ? <p className="pod-side-empty">{touch ? '空的。长按 bot 或群聊，选“移到分组”。' : '空的。把 bot 或群聊拖到分组名上，或者右键它选“移到分组”。'}</p> : null}
            </div>
          )
        })}
        <SectionHead
          title="Bot"
          collapsed={collapsed}
          drop={drag.head(SIDEBAR_BOTS)}
          action={
            <button type="button" className="pod-icon-button" aria-label="新建 bot" title="新建 bot" onClick={() => app.openDrawer({ kind: 'new-bot' })}>
              <Icon name="plus" size={14} />
            </button>
          }
        />
        {botList.shown.map(row(SIDEBAR_BOTS))}
        {moreButton(botList.hidden, more.bots, () => setMore({ ...more, bots: !more.bots }))}
        <SectionHead
          title="群聊"
          collapsed={collapsed}
          drop={drag.head(SIDEBAR_GROUPS)}
          action={
            <button type="button" className="pod-icon-button" aria-label="新建群聊" title="新建群聊" onClick={() => app.openDrawer({ kind: 'new-group' })}>
              <Icon name="plus" size={14} />
            </button>
          }
        />
        {sections.groups.length === 0 && !collapsed ? <p className="pod-side-empty">主管组队干活时会自动建群，也可以点 + 自己拉群。</p> : null}
        {groupList.shown.map(row(SIDEBAR_GROUPS))}
        {moreButton(groupList.hidden, more.groups, () => setMore({ ...more, groups: !more.groups }))}
      </div>
      <div className="pod-side-bottom">
        <button type="button" className="pod-side-row" onClick={() => app.openSettings('general')} title={collapsed ? '设置' : undefined}>
          <Icon name="settings" size={18} />
          {collapsed ? null : <span className="pod-side-row-title">设置</span>}
        </button>
      </div>
    </nav>
  )
}
