import { useState } from 'react'
import { ROOM_TITLE_MAX, botThreads, isTemporaryRoom, t, type Bot, type RoomSummary } from 'pod-domain'
import { computerApi } from '../../api/computer.ts'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Avatar, RelativeTime, nameColor } from '../../components/common.tsx'
import { GroupMark } from '../../components/GroupMark.tsx'
import { Icon } from '../../components/Icon.tsx'
import { useNarrow } from '../../components/media.ts'
import { MenuPanel, useMenu } from '../../components/Menu.tsx'
import { RenameInput } from '../../components/RenameInput.tsx'
import { useApp, useNav } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { DetailsToggle, TaskStatusPill } from './TaskHead.tsx'

/**
 * 新对话。单聊开一段空白的新对话，之前的那段原样留在对话记录里，随时能回去接着聊；
 * 群聊还是这个群，时间线上加一条分隔线，之前的聊天留在上面。
 * 新的这段 bot 不带之前的上下文；你提到以前的事，它会自己去翻以前的对话。
 */
function NewChatButton(props: { readonly room: RoomSummary }) {
  const app = useApp()
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const tip = props.room.kind === 'direct' ? t('新对话：之前的留在对话记录里，随时能回去接着聊') : t('新对话：群里的 bot 从这里重新开始，之前的聊天还在上面')
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
      <button type="button" className="pod-head-button" onClick={start} aria-label={t('新对话')} title={tip}>
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
 * 群聊的标题：左边是成员拼成的群图标（点开群聊详情），点群名直接改名；成员悬停在群图标上看，任务群在群名下面写出来。
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
        {room.taskId === null ? (
          <strong>{room.title}</strong>
        ) : (
          <span className="pod-convo-titles">
            <strong className="pod-ellipsis">{room.title}</strong>
            <span className="pod-convo-sub pod-ellipsis">{names}</span>
          </span>
        )}
        <Icon name="forward" size={14} />
      </button>
    )
  }
  const name = renaming ? (
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
  )
  return (
    <div className="pod-convo-group">
      <button type="button" className="pod-convo-icon" onClick={() => app.showGroup(room.id)} title={t('群聊详情')} aria-label={t('群聊详情：{names}', { names })}>
        <GroupMark members={members} size={32} />
      </button>
      {room.taskId === null ? (
        name
      ) : (
        <span className="pod-convo-titles">
          {name}
          <span className="pod-convo-sub pod-ellipsis">{names}</span>
        </span>
      )}
      {problem === undefined ? null : <span className="pod-form-error">{problem}</span>}
    </div>
  )
}

/**
 * 浏览器：这个对话里有 bot 开着网页时才出现（单聊算这个 bot 的，群聊算这个群的；bot 空闲 10 分钟网页就关了），带个点。
 * 点开右侧看画面，这个对话的网页排前面；再点一下关上。自己开网页在设置或者详情的浏览器里。
 */
function BrowserButton(props: { readonly room: RoomSummary; readonly botId: string | null }) {
  const app = useApp()
  const nav = useNav()
  const { data } = useResource(app.cache, 'browser', () => api.browser())
  const open = nav.panel?.kind === 'browser' && nav.panel.roomId === props.room.id
  const busy = (data?.tabs ?? []).some((tab) => tab.owner.kind === 'bot' && (tab.roomId === props.room.id || (props.botId !== null && tab.botId === props.botId)))
  if (!busy && !open) return null
  return (
    <button
      type="button"
      className={`pod-head-button${open ? ' pod-head-button-on' : ''}${busy ? ' pod-head-button-busy' : ''}`}
      aria-pressed={open}
      aria-label={busy ? t('浏览器（有 bot 在用）') : t('浏览器')}
      title={busy ? t('浏览器（有 bot 在用）') : t('浏览器')}
      onClick={() => (open ? app.closePanel() : app.openBrowserTab(null, props.botId, props.room.id))}
    >
      <Icon name="browser" size={17} />
    </button>
  )
}

/** 电脑：有 bot 在用这台电脑时才出现，带个点；点开右侧看它用的应用窗口的实时画面，再点一下关上。 */
function ComputerButton() {
  const app = useApp()
  const nav = useNav()
  const { data: status } = useResource(app.cache, 'computer', () => computerApi.status())
  const open = nav.panel?.kind === 'computer'
  const busy = status?.user != null
  if (!busy && !open) return null
  return (
    <button
      type="button"
      className={`pod-head-button${open ? ' pod-head-button-on' : ''}${busy ? ' pod-head-button-busy' : ''}`}
      aria-pressed={open}
      aria-label={busy ? t('电脑（有 bot 在用）') : t('电脑')}
      title={busy ? t('电脑（有 bot 在用）') : t('电脑')}
      onClick={() => (open ? app.closePanel() : app.openComputer())}
    >
      <Icon name="computer" size={17} />
    </button>
  )
}

/**
 * 对话顶部：左边是 bot 或群（点开详情）；右边单聊有对话记录和新对话，不挂任务的群聊有新对话；bot 在用浏览器、电脑时才多一个按钮。
 * 任务对话左边是任务名，下面写和谁的单聊或者群成员；右边多一个收起、打开详情的按钮，详情收起来时旁边留着任务状态。
 * 用量在设置里，页面在 bot 和群聊的详情里。手机上最左边是回到列表，名字后面带个箭头表示点开是详情。
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
      {room.kind === 'direct' && room.taskId !== null ? (
        <button type="button" className="pod-convo-title" onClick={() => bot !== undefined && app.showBot(bot.id)} title={t('查看详情')}>
          <Avatar bot={bot} size={30} />
          <span className="pod-convo-titles">
            <strong className="pod-ellipsis">{room.subject !== '' ? room.subject : room.title}</strong>
            <span className="pod-convo-sub pod-ellipsis">{t('和{name}的单聊', { name: bot?.name ?? room.title })}</span>
          </span>
          {narrow ? <Icon name="forward" size={14} /> : null}
        </button>
      ) : room.kind === 'direct' ? (
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
      <BrowserButton room={room} botId={bot?.id ?? null} />
      <ComputerButton />
      {room.kind !== 'direct' || temporary || bot === undefined ? null : (
        <>
          <HistoryButton room={room} bot={bot} />
          <NewChatButton room={room} />
        </>
      )}
      {room.kind !== 'direct' && room.taskId === null ? <NewChatButton room={room} /> : null}
      {room.taskId === null ? null : <TaskStatusPill room={room} taskId={room.taskId} />}
      {room.taskId === null || narrow ? null : <DetailsToggle room={room} />}
    </header>
  )
}
