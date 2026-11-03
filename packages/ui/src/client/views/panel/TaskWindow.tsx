import { useCallback, useEffect, useRef } from 'react'
import { t, type Bot } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { Empty, IconButton } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { TaskStateIcon } from '../../components/TaskEntry.tsx'
import { useSnapshot } from '../../components/taskParts.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { ChatBody, useChatBots } from '../chat/ChatBody.tsx'
import { OpenBotContext } from '../chat/openBot.ts'

/** 小窗顶上的一个标签页：任务的状态和任务名，旁边一个关掉。 */
function WindowTab(props: { readonly taskId: string; readonly active: boolean }) {
  const app = useApp()
  const { snapshot } = useSnapshot(props.taskId)
  const tab = useRef<HTMLDivElement>(null)
  // 标签页多了横着滚：切到的那个滚进来。
  useEffect(() => {
    if (props.active) tab.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [props.active])
  const title = snapshot?.task.title ?? t('正在读取任务…')
  return (
    <div ref={tab} className={`pod-twin-tab${props.active ? ' pod-twin-tab-on' : ''}`}>
      <button type="button" role="tab" aria-selected={props.active} className="pod-twin-tab-main" title={snapshot?.task.title} onClick={() => app.selectTaskTab(props.taskId)}>
        {snapshot === undefined ? null : <TaskStateIcon snapshot={snapshot} />}
        <span className="pod-twin-tab-title">{title}</span>
      </button>
      <button type="button" className="pod-twin-tab-close" title={t('关掉这个标签页')} aria-label={t('关掉「{title}」', { title })} onClick={() => app.closeTaskTab(props.taskId)}>
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}

/** 小窗里的任务对话：和中间的对话一样能回话、点按钮，没有顶栏和详情；点 bot 的头像放大成全屏再看它。 */
function WindowChat(props: { readonly roomId: string }) {
  const app = useApp()
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const { bots, authors, lead } = useChatBots()
  const { data: members } = useResource(app.cache, `members:${props.roomId}`, () => api.roomInfo(props.roomId))
  const showBot = useCallback(
    (botId: string) => {
      app.openRoom(props.roomId)
      app.showMember(botId)
    },
    [app, props.roomId],
  )
  const room = rooms?.find((item) => item.id === props.roomId)
  if (room === undefined) return <Empty title={rooms === undefined ? t('正在读取…') : t('这个对话已经删除')} />
  const memberBots = (members?.members ?? []).map((member) => bots.get(member.botId)).filter((bot): bot is Bot => bot !== undefined)
  return (
    <OpenBotContext.Provider value={showBot}>
      <div className="pod-convo pod-width-full pod-twin-chat">
        <ChatBody room={room} bots={bots} authors={authors} members={memberBots} lead={lead} />
      </div>
    </OpenBotContext.Provider>
  )
}

/**
 * 右边的任务小窗（照 Comma）：在对话里点任务卡片或记号打开，主对话还在旁边。一个任务一个标签页，标签上是状态和任务名，能关。
 * 小窗里就是任务对话本身，能直接回、点按钮。右上角「打开任务」放大成全屏，旁边是关小窗；小窗里没有详情那一栏。
 */
export function TaskWindow(props: { readonly taskIds: readonly string[]; readonly active: string }) {
  const app = useApp()
  const { snapshot, error } = useSnapshot(props.active)
  const conversation = snapshot?.conversationId ?? null
  return (
    <aside className="pod-panel pod-twin" aria-label={t('任务对话')}>
      <header className="pod-twin-head">
        <div className="pod-twin-tabs" role="tablist" aria-label={t('打开的任务')}>
          {props.taskIds.map((id) => (
            <WindowTab key={id} taskId={id} active={id === props.active} />
          ))}
        </div>
        <IconButton
          icon="fullscreen"
          label={t('打开任务')}
          disabled={conversation === null}
          onClick={() => {
            if (conversation !== null) app.openRoom(conversation)
          }}
        />
        <IconButton icon="close" label={t('关掉小窗')} onClick={() => app.closePanel()} />
      </header>
      {conversation !== null ? (
        <WindowChat key={conversation} roomId={conversation} />
      ) : (
        <Empty title={snapshot === undefined ? (error ?? t('正在读取任务…')) : t('这个任务没有自己的对话')} />
      )}
    </aside>
  )
}
