import { useState } from 'react'
import { BOT_NAME_MAX, ROOM_TITLE_MAX, addSidebarFolder, archiveSidebarItem, inputLimit, moveSidebarItem, t, type Bot, type SidebarItem } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { useClipped } from '../../components/clipped.ts'
import { Avatar, Badge, listTime, nameColor } from '../../components/common.tsx'
import { GroupMark } from '../../components/GroupMark.tsx'
import { useLongPress } from '../../components/longPress.ts'
import { useNarrow } from '../../components/media.ts'
import { MenuDivider, MenuItem, MenuPanel, useMenu } from '../../components/Menu.tsx'
import { RenameInput } from '../../components/RenameInput.tsx'
import { useApp, useNav } from '../../state/app.ts'
import type { RowDrag } from './drag.ts'
import { folderId, type SidebarStore } from './prefs.ts'

export interface SideItemProps {
  readonly item: SidebarItem
  readonly members: readonly Bot[]
  readonly busy: boolean
  readonly collapsed: boolean
  readonly store: SidebarStore
  readonly onError: (message: string) => void
  /** 拖动排序；不给就不能拖。 */
  readonly drag?: RowDrag
}

/** 未读条数的红色角标：超过 99 写 99+。 */
function UnreadBadge(props: { readonly count: number }) {
  return (
    <span className="pod-side-badge" aria-label={t('{count} 条未读', { count: props.count })}>
      {props.count > 99 ? '99+' : props.count}
    </span>
  )
}

type MenuView = 'main' | 'move' | 'new-folder'

/** 手机列表上名字下面那一行：最近一条消息；单聊里去掉开头 bot 自己的名字，还没聊过就写一句。 */
function previewOf(item: SidebarItem, members: readonly Bot[]): string {
  const text = item.room?.preview ?? ''
  if (item.bot !== undefined) {
    const own = t('{name}：', { name: item.bot.name })
    return text === '' ? t('还没有聊过') : text.startsWith(own) ? text.slice(own.length) : text
  }
  return text === '' ? members.map((bot) => bot.name).join(t('、')) : text
}

/**
 * 侧栏的一行：点开对话，拖动排顺序；右键（触屏上长按）在那个位置弹出菜单：置顶、改名、移到分组、归档、删除。
 * 主管固定置顶，菜单里没有置顶、移到分组和归档。手机上是两行：名字和时间，下面是最近一条消息和未读。
 */
export function SideItem(props: SideItemProps) {
  const app = useApp()
  const nav = useNav()
  const narrow = useNarrow()
  const { item, store } = props
  const [view, setView] = useState<MenuView>('main')
  const [folderName, setFolderName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const menu = useMenu('end', view)
  const room = item.room
  const bot = item.bot
  const title = bot?.name ?? room?.title ?? ''
  // 长群名在侧栏里放不下时是省略号，悬停看全名。
  const [titleRef, clipped] = useClipped<HTMLSpanElement>(title)
  // bot 和你可以有好几段对话：在其中哪一段都算“正在看”，未读和等你处理的按每一段加起来。
  const active = item.rooms.some((thread) => thread.id === nav.roomId)
  const archived = store.prefs.archived.includes(item.key)
  const placed = store.prefs.placement[item.key]
  const lead = bot?.role === 'lead'
  const unread = item.rooms.reduce((sum, thread) => sum + (thread.id === nav.roomId ? 0 : thread.unread), 0)
  const waits = item.rooms.reduce((sum, thread) => sum + thread.waits, 0)
  const drag = renaming ? undefined : props.drag

  const run = (work: Promise<unknown>, after?: () => void): void => {
    work
      .then(() => {
        app.cache.invalidate('rooms')
        app.cache.invalidate('bots')
        after?.()
      })
      .catch((reason: unknown) => props.onError(errorText(reason)))
  }
  const close = (): void => {
    menu.close()
    setView('main')
  }
  const open = (): void => {
    if (renaming) return
    if (room !== undefined) app.openRoom(room.id)
    else if (bot !== undefined) app.openBot(bot.id)
  }
  const togglePin = (): void => {
    close()
    const targets = item.rooms.length > 0 ? Promise.resolve(item.rooms) : bot === undefined ? Promise.reject(new Error(t('找不到这个对话'))) : api.openDirect(bot.id).then((found) => [found])
    run(targets.then((found) => Promise.all(found.map((thread) => api.updateRoom(thread.id, { pinned: !item.pinned })))))
  }
  const rename = (value: string): void => {
    setRenaming(false)
    if (bot !== undefined) run(api.updateBot(bot.id, { name: value }))
    else if (room !== undefined) run(api.updateRoom(room.id, { title: value }))
  }
  const leaveIfOpen = (): void => {
    if (active) app.navigate({ roomId: null, panel: null })
  }
  const remove = (): void => {
    close()
    if (bot !== undefined) {
      if (window.confirm(t('删除「{name}」？它的设定、记忆和聊天记录先放进回收站，30 天内可以在“设置 → 回收站”里恢复。', { name: bot.name }))) run(api.archiveBot(bot.id), leaveIfOpen)
    } else if (room !== undefined && window.confirm(t('删除群聊「{title}」？30 天内可以在“设置 → 回收站”里恢复。', { title: room.title }))) {
      run(api.updateRoom(room.id, { archived: true }), leaveIfOpen)
    }
  }
  const clearChat = (): void => {
    close()
    if (item.rooms.length > 0 && window.confirm(t('删除和「{title}」的全部聊天记录（{length} 段对话）？消息会全部删掉，{title} 本身和它的记忆保留。', { title, length: item.rooms.length }))) {
      run(Promise.all(item.rooms.map((thread) => api.clearRoom(thread.id))))
    }
  }
  const createFolder = (): void => {
    const name = folderName.trim()
    if (name === '') return
    const id = folderId()
    store.save((prefs) => moveSidebarItem(addSidebarFolder(prefs, id, name), item.key, id))
    setFolderName('')
    close()
  }

  const menuable = !props.collapsed && !renaming
  const press = useLongPress((x, y) => menu.openAt(x, y), menuable)
  const iconSize = narrow ? 44 : props.collapsed ? 28 : 24
  const icon = item.kind === 'bot' ? <Avatar bot={bot} size={iconSize} /> : <GroupMark members={props.members} size={iconSize} />
  const flag = waits > 0 && !props.collapsed ? <Badge tone="warn">{t('需要你')}</Badge> : unread > 0 ? <UnreadBadge count={unread} /> : null
  const busy = props.busy ? <span className="pod-side-busy" role="img" aria-label={t('正在工作')} /> : null
  const lastAt = item.room?.lastMessageAt ?? null
  return (
    <div
      className={`pod-side-item${active ? ' pod-side-item-active' : ''}${menu.open ? ' pod-side-item-menu' : ''}${drag?.mark === undefined ? '' : ` pod-side-drop-${drag.mark}`}`}
      draggable={drag?.draggable === true}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onDragEnd}
      {...press}
      onContextMenu={(event) => {
        if (!menuable) return
        event.preventDefault()
        // 键盘（菜单键、Shift+F10）打开时没有鼠标位置：贴着这一行的左下角。
        const box = event.currentTarget.getBoundingClientRect()
        const keyboard = event.clientX === 0 && event.clientY === 0
        menu.openAt(keyboard ? box.left + 12 : event.clientX, keyboard ? box.bottom : event.clientY)
      }}
    >
      {renaming && !props.collapsed ? (
        <div className="pod-side-row">
          {icon}
          <RenameInput value={title} max={bot === undefined ? ROOM_TITLE_MAX : inputLimit(BOT_NAME_MAX)} label={t('给「{title}」改名', { title })} onSave={rename} onCancel={() => setRenaming(false)} />
        </div>
      ) : narrow ? (
        <button type="button" className="pod-side-row pod-side-row-tall" onClick={open} aria-current={active ? 'true' : undefined}>
          {icon}
          <span className="pod-side-row-body">
            <span className="pod-side-row-line">
              <span className={`pod-side-row-title${bot === undefined ? '' : ' pod-bot-name'}`} style={nameColor(bot)}>
                {title}
              </span>
              {busy}
              {lastAt === null ? null : <time className="pod-side-row-time">{listTime(lastAt, Date.now())}</time>}
            </span>
            <span className="pod-side-row-line">
              <span className="pod-side-row-preview">{previewOf(item, props.members)}</span>
              {flag}
            </span>
          </span>
        </button>
      ) : (
        <button type="button" className="pod-side-row" onClick={open} title={props.collapsed ? title : undefined} aria-current={active ? 'true' : undefined}>
          {icon}
          {props.collapsed ? null : (
            <span ref={titleRef} className={`pod-side-row-title${bot === undefined ? '' : ' pod-bot-name'}`} style={nameColor(bot)} title={clipped ? title : undefined}>
              {title}
            </span>
          )}
          {flag}
          {busy}
        </button>
      )}
      <MenuPanel control={menu} label={t('「{title}」的操作', { title })}>
        {view === 'main' ? (
          <>
            {lead ? null : <MenuItem icon={item.pinned ? 'unpin' : 'pin'} label={item.pinned ? t('取消置顶') : t('置顶')} onClick={togglePin} />}
            <MenuItem
              icon="edit"
              label={t('改名')}
              onClick={() => {
                close()
                setRenaming(true)
              }}
            />
            {lead ? null : <MenuItem icon="move" label={t('移到分组')} hint={placed === undefined ? undefined : store.prefs.folders.find((folder) => folder.id === placed)?.name} onClick={() => setView('move')} />}
            {lead ? null : (
              <MenuItem
                icon="archive"
                label={archived ? t('取消归档') : t('归档')}
                hint={archived ? undefined : t('不在侧栏显示，在设置的“归档”里找回')}
                onClick={() => {
                  close()
                  store.save((prefs) => archiveSidebarItem(prefs, item.key, !archived))
                }}
              />
            )}
            <MenuDivider />
            {bot !== undefined && room !== undefined ? <MenuItem icon="trash" label={t('删除聊天记录')} danger onClick={clearChat} /> : null}
            {bot?.role === 'lead' ? null : <MenuItem icon="trash" label={bot === undefined ? t('删除群聊') : t('删除这个 bot')} danger onClick={remove} />}
          </>
        ) : null}
        {view === 'move' ? (
          <>
            <MenuItem icon="back" label={t('返回')} onClick={() => setView('main')} />
            <MenuDivider />
            {store.prefs.folders.map((folder) => (
              <MenuItem
                key={folder.id}
                icon="folder"
                label={folder.name}
                checked={placed === folder.id}
                onClick={() => {
                  close()
                  store.save((prefs) => moveSidebarItem(prefs, item.key, folder.id))
                }}
              />
            ))}
            <MenuItem icon="plus" label={t('新建分组…')} onClick={() => setView('new-folder')} />
            {placed === undefined ? null : (
              <MenuItem
                icon="close"
                label={t('移出分组')}
                onClick={() => {
                  close()
                  store.save((prefs) => moveSidebarItem(prefs, item.key, null))
                }}
              />
            )}
          </>
        ) : null}
        {view === 'new-folder' ? (
          <div className="pod-menu-form">
            <input
              className="pod-input"
              autoFocus
              value={folderName}
              maxLength={12}
              placeholder={t('分组名，例如：量化')}
              aria-label={t('新分组的名字')}
              onChange={(event) => setFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) createFolder()
              }}
            />
            <button type="button" className="pod-button pod-button-primary pod-button-small" disabled={folderName.trim() === ''} onClick={createFolder}>
              {t('建好并移进去')}
            </button>
          </div>
        ) : null}
      </MenuPanel>
    </div>
  )
}
