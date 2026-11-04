import { useEffect } from 'react'
import { t, type Bot, type RoomSummary } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { money, tokens } from '../../components/common.tsx'
import { BotName } from '../../components/GroupMark.tsx'
import { MenuPanel, useMenu } from '../../components/Menu.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'


/** 顶部用量算谁的：单聊算这个 bot 今天做事用的（在哪儿做的都算），群聊和临时对话算这个对话里的。 */
export type UsageScope = { readonly kind: 'bot'; readonly bot: Bot } | { readonly kind: 'room'; readonly room: RoomSummary }

/** 顶部的今日用量：只算这个 bot 或这个群聊；点开看分布，全部的用量在设置里。 */
export function UsageChip(props: { readonly scope: UsageScope; readonly bots: ReadonlyMap<string, Bot> }) {
  const app = useApp()
  const menu = useMenu()
  const { scope } = props
  const key = scope.kind === 'bot' ? `usage:today:bot:${scope.bot.id}` : `usage:today:room:${scope.room.id}`
  const { data: usage, reload } = useResource(app.cache, key, () => api.usage('today', scope.kind === 'bot' ? { botId: scope.bot.id } : { roomId: scope.room.id }))
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  useEffect(() => {
    const timer = setInterval(reload, 60_000)
    return () => clearInterval(timer)
  }, [reload])
  if (usage === undefined) return null
  // 单聊看这个 bot 在哪些对话里用的，群聊看每个成员各用了多少。
  const shares = (scope.kind === 'bot' ? usage.byRoom : usage.byBot.filter((item) => item.id !== null)).slice(0, 6)
  const max = Math.max(...shares.map((item) => item.cost), 0.0001)
  const roomName = (id: string | null): string => {
    if (id === null) return t('不在对话里（任务、自动化）')
    const room = (rooms ?? []).find((item) => item.id === id)
    if (room === undefined) return t('已删除的对话')
    return room.kind === 'direct' ? (room.subject === '' ? t('单聊') : t('单聊「{subject}」', { subject: room.subject })) : t('群聊「{title}」', { title: room.title })
  }
  const subject = scope.kind === 'bot' ? scope.bot.name : t('「{title}」', { title: scope.room.title })
  return (
    <>
      <button
        ref={menu.anchor}
        type="button"
        className="pod-usage-chip"
        aria-expanded={menu.open}
        title={t('{subject}今天的用量', { subject })}
        onClick={() => {
          if (!menu.open) reload()
          menu.toggle()
        }}
      >
        {t('今天 {money} · {tokens} token', { money: money(usage.cost), tokens: tokens(usage.tokens) })}
      </button>
      <MenuPanel control={menu} label={t('{subject}今天的用量', { subject })} wide>
        <div className="pod-usage-popover">
          <div className="pod-usage-subject">{t('{subject}今天的用量', { subject })}</div>
          <div className="pod-usage-total">
            <strong>{money(usage.cost)}</strong>
            <span className="pod-muted-inline">
              {t('{tokens} token · 缓存命中 {round}%', { tokens: tokens(usage.tokens), round: Math.round(usage.cacheHit * 100) })}
            </span>
          </div>
          {shares.length === 0 ? <p className="pod-muted">{t('今天还没有用量')}</p> : null}
          {shares.map((item) => (
            <div key={item.id ?? 'none'} className="pod-usage-row">
              {scope.kind === 'bot' ? <span className="pod-ellipsis pod-usage-place">{roomName(item.id)}</span> : <BotName bot={props.bots.get(item.id ?? '')} fallback={t('已删除的 bot')} size={18} />}
              <span className="pod-usage-bar" aria-hidden>
                <span style={{ width: `${Math.max(4, (item.cost / max) * 100)}%` }} />
              </span>
              <span className="pod-usage-value">{money(item.cost)}</span>
            </div>
          ))}
          <button
            type="button"
            className="pod-link"
            onClick={() => {
              menu.close()
              app.openSettings('usage')
            }}
          >
            {t('查看所有 bot 和群聊的用量')}
          </button>
        </div>
      </MenuPanel>
    </>
  )
}
