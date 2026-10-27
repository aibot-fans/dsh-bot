import { useState } from 'react'
import { PAGE_KIND_LABELS, t } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { pageApi } from '../../api/pages.ts'
import { Avatar, Button, RelativeTime } from '../../components/common.tsx'
import { GroupMark } from '../../components/GroupMark.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { KindIcon } from '../pages/kinds.tsx'

/** 回收站：删除的 bot、群聊、单聊里删掉的对话、页面和归档的团队，30 天内可以恢复。 */
export function RecycleBin() {
  const app = useApp()
  const { data } = useResource(app.cache, 'recycle', () => api.recycle())
  const { data: archived } = useResource(app.cache, 'rooms:archived', () => api.rooms(true))
  const { data: everyone } = useResource(app.cache, 'bots', () => api.bots())
  const { data: trashed } = useResource(app.cache, 'pages:trash', () => pageApi.trash())
  const byId = new Map([...(everyone ?? []), ...(data?.bots ?? [])].map((bot) => [bot.id, bot]))
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const bots = data?.bots ?? []
  const teams = data?.teams ?? []
  const rooms = (archived ?? []).filter((room) => room.kind !== 'direct')
  // 单聊里删掉的一段对话；bot 自己也删了的跟着 bot 一起恢复，这里不单列。
  const chats = (archived ?? []).filter((room) => room.kind === 'direct' && room.botId !== null && byId.get(room.botId)?.archivedAt === null)
  const pages = trashed ?? []
  const run = (work: Promise<unknown>): void => {
    setProblem(undefined)
    work
      .then(() => {
        app.cache.invalidate('recycle')
        app.cache.invalidate('rooms')
        app.cache.invalidate('bots')
        app.cache.invalidate('pages')
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  if (bots.length === 0 && teams.length === 0 && rooms.length === 0 && chats.length === 0 && pages.length === 0) return <p className="pod-muted">{t('回收站是空的。删除的 bot、群聊、对话和页面会先放在这里，30 天内可以恢复。')}</p>
  return (
    <div className="pod-stack-tight">
      <p className="pod-hint">{t('删除的 bot、群聊、对话和页面先放在这里，30 天内都能恢复。')}</p>
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
      {bots.map((bot) => (
        <div key={bot.id} className="pod-recycle-row">
          <Avatar bot={bot} size={24} />
          <span className="pod-ellipsis">{bot.name}</span>
          <span className="pod-muted-inline">
            {t('删除于')} <RelativeTime time={bot.archivedAt} />
          </span>
          <Button small icon="restore" onClick={() => run(api.restoreBot(bot.id))}>
            {t('恢复')}
          </Button>
        </div>
      ))}
      {rooms.map((room) => (
        <div key={room.id} className="pod-recycle-row">
          <GroupMark members={room.memberIds.flatMap((id) => byId.get(id) ?? [])} size={24} />
          <span className="pod-ellipsis">{room.title}</span>
          <span className="pod-muted-inline">
            {t('删除于')} <RelativeTime time={room.archivedAt} />
          </span>
          <Button
            small
            icon="restore"
            onClick={() => {
              run(api.updateRoom(room.id, { archived: false }))
              app.cache.invalidate('rooms:archived')
            }}
          >
            {t('恢复')}
          </Button>
        </div>
      ))}
      {chats.map((room) => {
        const bot = byId.get(room.botId ?? '')
        return (
          <div key={room.id} className="pod-recycle-row">
            <Avatar bot={bot} size={24} />
            <span className="pod-ellipsis">
              {t('和{value}的对话{value2}', { value: bot?.name ?? 'bot', value2: room.subject === '' ? '' : t('「{subject}」', { subject: room.subject }) })}
            </span>
            <span className="pod-muted-inline">
              {t('删除于')} <RelativeTime time={room.archivedAt} />
            </span>
            <Button
              small
              icon="restore"
              onClick={() => {
                run(api.updateRoom(room.id, { archived: false }))
                app.cache.invalidate('rooms:archived')
              }}
            >
              {t('恢复')}
            </Button>
          </div>
        )
      })}
      {pages.map((page) => (
        <div key={page.id} className="pod-recycle-row">
          <KindIcon kind={page.kind} size={24} />
          <span className="pod-ellipsis">
            {t('{kind}「{title}」', { kind: t(PAGE_KIND_LABELS[page.kind]), title: page.title })}
          </span>
          <span className="pod-muted-inline">
            {t('删除于')} <RelativeTime time={page.deletedAt} />
          </span>
          <Button small icon="restore" onClick={() => run(pageApi.restore(page.id))}>
            {t('恢复')}
          </Button>
        </div>
      ))}
      {teams.map((team) => (
        <div key={team.id} className="pod-recycle-row">
          <span className="pod-ellipsis">{t('团队：{name}', { name: team.name })}</span>
          <span className="pod-muted-inline">
            {t('归档于')} <RelativeTime time={team.archivedAt} />
          </span>
          <Button small icon="restore" onClick={() => run(api.restoreTeam(team.id))}>
            {t('恢复')}
          </Button>
        </div>
      ))}
    </div>
  )
}
