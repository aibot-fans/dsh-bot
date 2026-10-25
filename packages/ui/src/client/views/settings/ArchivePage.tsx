import { archiveSidebarItem, sidebarSections, type Bot, type SidebarItem } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { Avatar, Button } from '../../components/common.tsx'
import { GroupMark } from '../../components/GroupMark.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { useSidebarPrefs } from '../side/prefs.ts'

/** 归档：收起来、不在侧栏显示的 bot 和群聊。还能照常打开和聊天，取消归档就回到侧栏。 */
export function ArchivePage() {
  const app = useApp()
  const store = useSidebarPrefs()
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const byId = new Map((bots ?? []).map((bot) => [bot.id, bot]))
  const archived = sidebarSections(bots ?? [], rooms ?? [], store.prefs).archived
  const open = (item: SidebarItem): void => {
    app.navigate({ settings: null })
    if (item.room !== undefined) app.openRoom(item.room.id)
    else if (item.bot !== undefined) app.openBot(item.bot.id)
  }
  if (archived.length === 0) return <p className="pod-muted">没有归档的 bot 或群聊。在侧栏条目的“…”里选“归档”，它就收到这里，不占侧栏。</p>
  return (
    <div className="pod-stack-tight">
      <p className="pod-hint">归档的 bot 和群聊不在侧栏显示，记录都在，照常能打开和聊天；取消归档就回到侧栏。</p>
      {archived.map((item) => {
        const members = (item.room?.memberIds ?? []).map((id) => byId.get(id)).filter((bot): bot is Bot => bot !== undefined)
        const title = item.bot?.name ?? item.room?.title ?? ''
        return (
          <div key={item.key} className="pod-recycle-row">
            {item.kind === 'bot' ? <Avatar bot={item.bot} size={24} /> : <GroupMark members={members} size={24} />}
            <span className="pod-ellipsis">{title}</span>
            {(item.room?.unread ?? 0) > 0 ? <span className="pod-side-badge">{item.room?.unread}</span> : null}
            <Button small kind="quiet" onClick={() => open(item)}>
              打开
            </Button>
            <Button small icon="restore" onClick={() => store.save((prefs) => archiveSidebarItem(prefs, item.key, false))}>
              取消归档
            </Button>
          </div>
        )
      })}
    </div>
  )
}
