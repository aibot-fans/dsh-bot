import { t, type Bot, type RoomSummary } from 'pod-domain'
import { api, type MemberStatus } from '../../api/endpoints.ts'
import { Avatar, useNow } from '../../components/common.tsx'
import { duration } from '../../components/duration.ts'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

const DOTS: Readonly<Record<MemberStatus['state'], 'busy' | 'waiting' | 'blocked' | 'idle'>> = { working: 'busy', waiting: 'waiting', blocked: 'blocked', idle: 'idle' }

function stateText(member: MemberStatus, now: number): string {
  const title = member.title ?? ''
  switch (member.state) {
    case 'idle':
      return t('空闲')
    case 'working':
      return t('在做「{title}」 · {time}', { title, time: duration(now - (member.since ?? now)) })
    case 'waiting':
      return t('等你：「{title}」', { title })
    case 'blocked':
      return t('受阻：「{title}」', { title })
  }
}

/** 群顶的团队状态：每个成员一个头像，标出空闲、在做（任务名和已用时间）、等你、受阻；点开进任务页。 */
export function TeamBar(props: { readonly room: RoomSummary; readonly bots: ReadonlyMap<string, Bot> }) {
  const app = useApp()
  const now = useNow(30_000)
  const { data } = useResource(app.cache, `team:${props.room.id}`, () => api.roomTeam(props.room.id))
  if (data === undefined || data.length === 0) return null
  return (
    <div className="pod-teambar" role="list" aria-label={t('团队状态')}>
      {data.map((member) => {
        const bot = props.bots.get(member.botId)
        const text = stateText(member, now)
        const content = (
          <>
            <Avatar bot={bot} size={22} status={DOTS[member.state]} />
            <span className="pod-teambar-text">
              <span className="pod-teambar-name">{bot?.name ?? member.botId}</span>
              <span className="pod-teambar-state">{text}</span>
            </span>
          </>
        )
        const taskId = member.taskId
        return taskId === null ? (
          <span key={member.botId} role="listitem" className="pod-teambar-member pod-teambar-idle">
            {content}
          </span>
        ) : (
          <button key={member.botId} type="button" role="listitem" className={`pod-teambar-member pod-teambar-${member.state}`} title={text} onClick={() => app.openTask(taskId)}>
            {content}
          </button>
        )
      })}
    </div>
  )
}
