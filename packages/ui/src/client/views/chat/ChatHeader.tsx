import { useEffect, useState } from 'react'
import { ROOM_TITLE_MAX, botThreads, isTemporaryRoom, t, type Bot, type RoomSummary } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Avatar, RelativeTime, money, nameColor, tokens } from '../../components/common.tsx'
import { BotName, GroupMark } from '../../components/GroupMark.tsx'
import { Icon } from '../../components/Icon.tsx'
import { useNarrow } from '../../components/media.ts'
import { MenuPanel, useMenu } from '../../components/Menu.tsx'
import { RenameInput } from '../../components/RenameInput.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

/** 顶部用量算谁的：单聊算这个 bot 今天做事用的（在哪儿做的都算），群聊和临时对话算这个对话里的。 */
type UsageScope = { readonly kind: 'bot'; readonly bot: Bot } | { readonly kind: 'room'; readonly room: RoomSummary }

/** 顶部的今日用量：只算这个 bot 或这个群聊；点开看分布，全部的用量在设置里。 */
function UsageChip(props: { readonly scope: UsageScope; readonly bots: ReadonlyMap<string, Bot> }) {
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

/**
 * 新对话（只有单聊有）：开一段空白的新对话，之前的那段原样留在对话记录里，随时能回去接着聊。
 * 新的这段 bot 不带之前的上下文；你提到以前的事，它会自己去翻以前的对话。
 */
function NewChatButton(props: { readonly room: RoomSummary }) {
  const app = useApp()
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const start = (): void => {
    setProblem(undefined)
    api
      .newConversation({ roomId: props.room.id })
      .then((room) => {
        app.cache.invalidate('rooms')
        app.openRoom(room.id)
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  return (
    <>
      {problem === undefined ? null : <span className="pod-form-error">{problem}</span>}
      <button type="button" className="pod-head-button" onClick={start} aria-label={t('新对话')} title={t('新对话：之前的留在对话记录里，随时能回去接着聊')}>
        <Icon name="compose" size={17} />
      </button>
    </>
  )
}

/** 对话记录：和这个 bot 的每一段对话，最近的在前；点一段回去接着聊，也能删掉一段（先进回收站）。 */
function HistoryButton(props: { readonly room: RoomSummary; readonly bot: Bot }) {
  const app = useApp()
  const menu = useMenu()
  const { room, bot } = props
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const threads = botThreads(bot.id, rooms ?? []).filter((thread) => thread.preview !== '' || thread.id === room.id)
  const remove = (thread: RoomSummary): void => {
    const label = thread.subject === '' ? t('这段对话') : t('对话「{subject}」', { subject: thread.subject })
    if (!window.confirm(t('删除{label}？30 天内可以在“设置 → 回收站”里恢复。', { label }))) return
    setProblem(undefined)
    api
      .deleteConversation(thread.id)
      .then(() => {
        app.cache.invalidate('rooms')
        if (thread.id !== room.id) return
        const next = threads.find((item) => item.id !== thread.id)
        if (next === undefined) app.openBot(bot.id)
        else app.openRoom(next.id)
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  return (
    <>
      <button ref={menu.anchor} type="button" className={`pod-head-button${menu.open ? ' pod-head-button-on' : ''}`} aria-expanded={menu.open} aria-label={t('对话记录')} title={t('和{name}的对话记录', { name: bot.name })} onClick={menu.toggle}>
        <Icon name="history" size={17} />
      </button>
      <MenuPanel control={menu} label={t('和{name}的对话记录', { name: bot.name })} wide>
        <div className="pod-history">
          <div className="pod-history-head">{t('和{name}的对话 · {length} 段', { name: bot.name, length: threads.length })}</div>
          {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
          <div className="pod-history-list">
            {threads.map((thread) => (
              <div key={thread.id} className={`pod-history-row${thread.id === room.id ? ' pod-history-row-on' : ''}`}>
                <button
                  type="button"
                  className="pod-history-open"
                  onClick={() => {
                    menu.close()
                    app.openRoom(thread.id)
                  }}
                >
                  <span className="pod-history-subject pod-ellipsis">{thread.subject === '' ? (thread.preview === '' ? t('新对话') : t('（没有文字）')) : thread.subject}</span>
                  <span className="pod-history-meta pod-ellipsis">
                    <RelativeTime time={thread.lastMessageAt ?? thread.createdAt} />
                    {thread.preview === '' ? null : ` · ${thread.preview}`}
                  </span>
                </button>
                {thread.unread > 0 && thread.id !== room.id ? <span className="pod-side-badge">{thread.unread > 99 ? '99+' : thread.unread}</span> : null}
                <button type="button" className="pod-icon-button pod-history-remove" aria-label={t('删除这段对话')} title={t('删除这段对话')} onClick={() => remove(thread)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
          <p className="pod-history-tip">{t('每段对话各自记得自己的上下文；在新的一段里提到以前的事，{name}会自己去翻。', { name: bot.name })}</p>
        </div>
      </MenuPanel>
    </>
  )
}

/**
 * 群聊的标题：左边是成员拼成的群图标（点开群聊详情），点群名直接改名；成员悬停在群图标上看。
 * 手机上群名也是点开详情（容易误触改名），改名在详情里。
 */
function GroupTitle(props: { readonly room: RoomSummary; readonly members: readonly Bot[] }) {
  const app = useApp()
  const narrow = useNarrow()
  const { room, members } = props
  const [renaming, setRenaming] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const names = members.map((member) => member.name).join(t('、'))
  if (narrow) {
    return (
      <button type="button" className="pod-convo-title" onClick={() => app.showGroup(room.id)} aria-label={t('群聊详情：{names}', { names })}>
        <GroupMark members={members} size={30} />
        <strong>{room.title}</strong>
        <Icon name="forward" size={14} />
      </button>
    )
  }
  return (
    <div className="pod-convo-group">
      <button type="button" className="pod-convo-icon" onClick={() => app.showGroup(room.id)} title={t('群聊详情')} aria-label={t('群聊详情：{names}', { names })}>
        <GroupMark members={members} size={32} />
      </button>
      {renaming ? (
        <RenameInput
          value={room.title}
          max={ROOM_TITLE_MAX}
          label={t('群名')}
          className="pod-convo-rename"
          onSave={(title) => {
            setRenaming(false)
            api
              .updateRoom(room.id, { title })
              .then(() => app.cache.invalidate('rooms'))
              .catch((reason: unknown) => setProblem(errorText(reason)))
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <button type="button" className="pod-convo-name" onClick={() => setRenaming(true)} title={t('点一下改群名')}>
          <strong>{room.title}</strong>
        </button>
      )}
      {problem === undefined ? null : <span className="pod-form-error">{problem}</span>}
    </div>
  )
}

/**
 * 对话顶部：左边是 bot 或群（点开详情）；单聊右边是对话记录和新对话，最右是这个 bot 或群聊今天的用量。页面在 bot 和群聊的详情里。
 * 手机上最左边是回到列表，名字后面带个箭头表示点开是详情，用量不显示。
 */
export function ChatHeader(props: { readonly room: RoomSummary; readonly bots: ReadonlyMap<string, Bot>; readonly memberIds: readonly string[] }) {
  const app = useApp()
  const narrow = useNarrow()
  const { room } = props
  const bot = room.botId === null ? undefined : props.bots.get(room.botId)
  const members = (props.memberIds.length > 0 ? props.memberIds : room.memberIds).map((id) => props.bots.get(id)).filter((item): item is Bot => item !== undefined)
  const temporary = isTemporaryRoom(room)
  return (
    <header className="pod-convo-head">
      {narrow ? (
        <button type="button" className="pod-head-button pod-convo-back" onClick={() => app.showList()} aria-label={t('回到列表')} title={t('回到列表')}>
          <Icon name="back" size={20} />
        </button>
      ) : null}
      {room.kind === 'direct' ? (
        <>
          <button type="button" className="pod-convo-title" onClick={() => bot !== undefined && app.showBot(bot.id)} title={t('查看 bot 详情')}>
            <Avatar bot={bot} size={30} />
            <strong className="pod-bot-name" style={nameColor(bot)}>
              {bot?.name ?? room.title}
            </strong>
            {narrow ? <Icon name="forward" size={14} /> : null}
          </button>
          {narrow || temporary || (room.subject === '' && room.topic === '') ? null : <span className="pod-convo-subject pod-ellipsis">{room.subject !== '' ? room.subject : room.topic}</span>}
        </>
      ) : (
        <GroupTitle room={room} members={members} />
      )}
      {temporary ? (
        <span className="pod-badge pod-badge-info" title={t('临时对话不进侧栏、不提取记忆；离开这个对话就删掉')}>
          {narrow ? t('临时') : t('临时对话 · 离开就删')}
        </span>
      ) : room.incognito ? (
        <span className="pod-badge pod-badge-muted">{narrow ? t('无痕') : t('无痕：不提取记忆')}</span>
      ) : null}
      <span className="pod-convo-head-gap" />
      {room.kind !== 'direct' || temporary || bot === undefined ? null : (
        <>
          <HistoryButton room={room} bot={bot} />
          <NewChatButton room={room} />
        </>
      )}
      {narrow ? null : <UsageChip scope={room.kind === 'direct' && !temporary && bot !== undefined ? { kind: 'bot', bot } : { kind: 'room', room }} bots={props.bots} />}
    </header>
  )
}
