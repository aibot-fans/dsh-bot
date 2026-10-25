import { useState } from 'react'
import { OWNER, POD, type Bot, type RoomMessage } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { BrowserCard } from '../../components/BrowserCard.tsx'
import { Avatar, Button, IconButton, clock, nameColor } from '../../components/common.tsx'
import { BotName } from '../../components/GroupMark.tsx'
import { Icon } from '../../components/Icon.tsx'
import { Markdown } from '../../components/Markdown.tsx'
import type { Mentions } from '../../components/mentions.tsx'
import { MenuItem, MenuPanel, useMenu } from '../../components/Menu.tsx'
import { TaskCard } from '../../components/TaskCard.tsx'
import { WaitCard } from '../../components/WaitCard.tsx'
import { PageCard, PageChip } from '../pages/PageCard.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { Attachment } from './Attachment.tsx'
import { calledMentions } from './Calls.tsx'
import { RateButtons } from './Rating.tsx'
import { WeeklyCard } from './WeeklyCard.tsx'
import { readXEvent, XEventCard } from './XEventCard.tsx'

export interface MessageProps {
  readonly message: RoomMessage
  readonly bots: ReadonlyMap<string, Bot>
  readonly quoted: RoomMessage | undefined
  readonly onReply: (message: RoomMessage) => void
  readonly onPinned: (message: RoomMessage) => void
  /** 消息里能认出来的 @bot：带图标、可以点。 */
  readonly mentions: Mentions
}

function authorName(author: string, bots: ReadonlyMap<string, Bot>): string {
  if (author === OWNER) return '你'
  if (author === POD) return 'Pod'
  return bots.get(author)?.name ?? '已删除的 bot'
}

/** 开工说明上的操作：谨慎档等你点“开始”；开工以后可以随时停止。 */
function KickoffActions(props: { readonly taskId: string }) {
  const app = useApp()
  const { data: snapshot } = useResource(app.cache, `snapshot:${props.taskId}`, () => api.taskSnapshot(props.taskId))
  if (snapshot === undefined) return null
  const { task } = snapshot
  const act = (work: () => Promise<unknown>): void => {
    work().catch((reason: unknown) => window.alert(errorText(reason)))
  }
  if (task.planPending) {
    return (
      <div className="pod-kickoff-actions">
        <Button small kind="primary" icon="play" onClick={() => act(() => api.approvePlan(task.id))}>
          开始
        </Button>
        <Button small kind="quiet" onClick={() => act(() => api.controlTask(task.id, 'cancel'))}>
          取消
        </Button>
      </div>
    )
  }
  if (task.status !== 'running' && task.status !== 'waiting') return null
  return (
    <div className="pod-kickoff-actions">
      <Button small kind="quiet" icon="stop" onClick={() => act(() => api.controlTask(task.id, 'stop'))}>
        停止
      </Button>
    </div>
  )
}

/** 提到一个群的提示（比如“拉了群「监控播报」”）：群名画成链接，点一下进那个群。 */
function RoomNotice(props: { readonly body: string; readonly roomId: string }) {
  const app = useApp()
  const match = /「([^」]+)」/.exec(props.body)
  const link = (
    <button type="button" className="pod-notice-link" onClick={() => app.openRoom(props.roomId)} title="打开这个群聊">
      {match === null ? props.body : `「${match[1] ?? ''}」`}
    </button>
  )
  if (match === null) return link
  return (
    <>
      {props.body.slice(0, match.index)}
      {link}
      {props.body.slice(match.index + match[0].length)}
    </>
  )
}

function Folded(props: { readonly message: RoomMessage }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="pod-folded">
      <button type="button" className="pod-link" onClick={() => setOpen((value) => !value)}>
        {open ? '收起' : '展开'} · {String(props.message.data.label ?? '讨论原文')}
      </button>
      {open ? <Markdown text={props.message.body} /> : null}
    </div>
  )
}

/** 时间线里的一条：你的气泡、bot 的发言、一行里程碑、任务卡、页面卡片、需要你处理的卡片、回执或折叠内容。 */
export function MessageItem(props: MessageProps) {
  const app = useApp()
  const { message, bots } = props
  switch (message.kind) {
    case 'notice':
      if (message.data.segment === true) {
        return (
          <div className="pod-divider" role="separator">
            <span>新的对话 · {clock(message.createdAt)}</span>
          </div>
        )
      }
      return (
        <div className="pod-line pod-line-notice">
          <span className="pod-line-text">
            {bots.has(message.author) ? <Avatar bot={bots.get(message.author)} size={16} /> : null}
            {typeof message.data.roomId === 'string' ? <RoomNotice body={message.body} roomId={message.data.roomId} /> : message.body}
          </span>
        </div>
      )
    case 'milestone':
    case 'receipt': {
      const subject = typeof message.data.botId === 'string' ? bots.get(message.data.botId) : bots.get(message.author)
      return (
        <div className={`pod-line pod-line-${message.kind}`}>
          <span className="pod-line-text">
            {subject === undefined ? null : <Avatar bot={subject} size={16} />}
            {message.body}
          </span>
          <time>{clock(message.createdAt)}</time>
        </div>
      )
    }
    case 'task-card':
      return (
        <div className="pod-msg-card">
          <TaskCard taskId={String(message.data.taskId ?? '')} />
          {typeof message.data.roomId === 'string' && message.data.roomId !== message.roomId ? (
            <button type="button" className="pod-link" onClick={() => app.openRoom(message.data.roomId as string)}>
              打开群聊
            </button>
          ) : null}
        </div>
      )
    case 'wait':
      return (
        <div className="pod-msg-card">
          <WaitCard waitId={String(message.data.waitId ?? '')} title={message.body} />
        </div>
      )
    case 'browser':
      return (
        <div className="pod-msg-card">
          <BrowserCard tabId={String(message.data.tabId ?? '')} botId={message.author} fallback={message.body} />
        </div>
      )
    case 'folded':
      return <Folded message={message} />
    case 'weekly':
      return (
        <div className="pod-msg-card">
          <WeeklyCard message={message} />
        </div>
      )
    case 'page':
      return (
        <div className="pod-msg-card">
          <PageCard message={message} />
        </div>
      )
    default:
      break
  }
  const owner = message.author === OWNER
  const bot = owner ? undefined : bots.get(message.author)
  const attachment = typeof message.data.attachment === 'object' && message.data.attachment !== null ? (message.data.attachment as Record<string, unknown>) : undefined
  const quoted = props.quoted
  const pageId = typeof message.data.pageId === 'string' ? message.data.pageId : undefined
  const xEvent = readXEvent(message.data.xEvent)
  const quote =
    quoted === undefined ? null : (
      <div className="pod-quote">
        {quoted.author === OWNER || quoted.author === POD ? authorName(quoted.author, bots) : <BotName bot={bots.get(quoted.author)} size={14} />}：{quoted.body.slice(0, 120)}
      </div>
    )
  if (owner) {
    return (
      <div className="pod-msg pod-msg-owner">
        <div className="pod-bubble">
          {pageId === undefined ? null : <PageChip pageId={pageId} />}
          {quote}
          {attachment !== undefined && message.body.startsWith('上传了文件「') ? null : <Markdown text={message.body} mentions={calledMentions(message, props.mentions, true)} />}
          {attachment === undefined ? null : <Attachment attachment={attachment} />}
          {message.data.via === 'dsh' ? <div className="pod-muted-inline">来自 dsh 会话视图</div> : null}
        </div>
        <MessageActions {...props} owner />
      </div>
    )
  }
  const openBot = (): void => {
    if (bot !== undefined) app.showMember(bot.id)
  }
  return (
    <div className={`pod-msg${message.kind === 'kickoff' ? ' pod-msg-kickoff' : ''}`}>
      <button type="button" className="pod-msg-avatar" onClick={openBot} aria-label={`${authorName(message.author, bots)} 的详情`}>
        <Avatar bot={bot} size={28} />
      </button>
      <div className="pod-msg-main">
        <div className="pod-msg-head">
          <button type="button" className={`pod-msg-author${bot === undefined ? '' : ' pod-bot-name'}`} style={nameColor(bot)} onClick={openBot}>
            {authorName(message.author, bots)}
          </button>
          {message.kind === 'kickoff' ? <span className="pod-badge pod-badge-info">开工说明</span> : null}
          {message.pinned ? <span className="pod-badge pod-badge-muted">已置顶</span> : null}
          {pageId === undefined ? null : <PageChip pageId={pageId} />}
          <time>{clock(message.createdAt)}</time>
        </div>
        {quote}
        {xEvent === undefined ? <Markdown text={message.body} mentions={calledMentions(message, props.mentions, false)} /> : <XEventCard view={xEvent} />}
        {attachment === undefined ? null : <Attachment attachment={attachment} />}
        {message.kind === 'kickoff' && typeof message.data.taskId === 'string' ? <KickoffActions taskId={message.data.taskId} /> : null}
        <MessageActions {...props} owner={false} />
      </div>
    </div>
  )
}

/**
 * 消息的操作：平时不显示，鼠标移到消息上时在右上角浮出一小排按钮，不占地方。
 * bot 的回复有复制、引用、重新回答、赞、踩，置顶和查看过程收在“…”里；你自己的消息有复制、引用和“…”。
 * 没有鼠标的设备上直接显示在消息下面。
 */
function MessageActions(props: MessageProps & { readonly owner: boolean }) {
  const app = useApp()
  const { message } = props
  const menu = useMenu('start')
  const sessionId = message.sessionId
  // X 监控推来的动态不是模型的回答，不能重新回答、也不用打分。
  const reply = message.author !== POD && message.kind === 'text' && !props.owner && message.data.xEvent === undefined
  return (
    <div className={`pod-msg-actions${props.owner ? ' pod-msg-actions-owner' : ''}${menu.open ? ' pod-msg-actions-open' : ''}`} role="toolbar" aria-label="消息操作">
      <IconButton icon="copy" label="复制" onClick={() => void navigator.clipboard?.writeText(message.body)} />
      <IconButton icon="reply" label="引用回复" onClick={() => props.onReply(message)} />
      {reply ? (
        <>
          <IconButton icon="refresh" label="重新回答" onClick={() => void api.regenerate(message.id).catch((reason: unknown) => window.alert(errorText(reason)))} />
          <RateButtons roomId={message.roomId} messageId={message.id} />
        </>
      ) : null}
      <button ref={menu.anchor} type="button" className="pod-icon-button" aria-label="更多" title="更多" aria-expanded={menu.open} onClick={menu.toggle}>
        <Icon name="more" size={15} />
      </button>
      <MenuPanel control={menu} label="这条消息的更多操作">
        <MenuItem
          icon={message.pinned ? 'unpin' : 'pin'}
          label={message.pinned ? '取消置顶' : '置顶这条消息'}
          onClick={() => {
            menu.close()
            void api.pinMessage(message.id, !message.pinned).then(props.onPinned)
          }}
        />
        {sessionId === null ? null : (
          <MenuItem
            icon="open"
            label="在 dsh 里查看过程"
            onClick={() => {
              menu.close()
              app.host.openSession(sessionId)
            }}
          />
        )}
      </MenuPanel>
    </div>
  )
}
