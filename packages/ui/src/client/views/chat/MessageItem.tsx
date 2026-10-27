import { useState, type ReactNode } from 'react'
import { OWNER, POD, isUploadNote, readRunSummary, t, type Bot, type RoomMessage } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { BrowserCard } from '../../components/BrowserCard.tsx'
import { copyText } from '../../components/clipboard.ts'
import { Avatar, Button, IconButton, Modal, clock, nameColor } from '../../components/common.tsx'
import { BotName } from '../../components/GroupMark.tsx'
import { Icon } from '../../components/Icon.tsx'
import { useLongPress } from '../../components/longPress.ts'
import { Markdown } from '../../components/Markdown.tsx'
import { useTouch } from '../../components/media.ts'
import type { Mentions } from '../../components/mentions.tsx'
import { MenuItem, MenuPanel, useMenu } from '../../components/Menu.tsx'
import { RunSummaryLine } from '../../components/Progress.tsx'
import { TaskCard } from '../../components/TaskCard.tsx'
import { WaitCard } from '../../components/WaitCard.tsx'
import { PageCard, PageChip } from '../pages/PageCard.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { Attachment } from './Attachment.tsx'
import { calledMentions } from './Calls.tsx'
import { MessageSheet, answerable, type SheetView } from './MessageSheet.tsx'
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
  /** 你的消息：同一分钟里后面还有你的消息时，时间留给最后一条。 */
  readonly hideTime?: boolean
}

function authorName(author: string, bots: ReadonlyMap<string, Bot>): string {
  if (author === OWNER) return t('你')
  if (author === POD) return 'dsh-bot'
  return bots.get(author)?.name ?? t('已删除的 bot')
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
          {t('开始')}
        </Button>
        <Button small kind="quiet" onClick={() => act(() => api.controlTask(task.id, 'cancel'))}>
          {t('取消')}
        </Button>
      </div>
    )
  }
  if (task.status !== 'running' && task.status !== 'waiting') return null
  return (
    <div className="pod-kickoff-actions">
      <Button small kind="quiet" icon="stop" onClick={() => act(() => api.controlTask(task.id, 'stop'))}>
        {t('停止')}
      </Button>
    </div>
  )
}

/** 提到一个群的提示（比如“拉了群「监控播报」”）：群名画成链接，点一下进那个群。 */
function RoomNotice(props: { readonly body: string; readonly roomId: string }) {
  const app = useApp()
  const match = /「[^」]+」|“[^”]+”/.exec(props.body)
  const link = (
    <button type="button" className="pod-notice-link" onClick={() => app.openRoom(props.roomId)} title={t('打开这个群聊')}>
      {match === null ? props.body : match[0]}
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
        {open ? t('收起') : t('展开')} · {String(props.message.data.label ?? t('讨论原文'))}
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
            <span>{t('新的对话 · {clock}', { clock: clock(message.createdAt) })}</span>
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
              {t('打开群聊')}
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
  // 这一轮跑完记下的执行过程：用时、几步，点开看每一步。
  const run = readRunSummary(message.data.run)
  const quote =
    quoted === undefined ? null : (
      <div className="pod-quote">
        {quoted.author === OWNER || quoted.author === POD ? authorName(quoted.author, bots) : <BotName bot={bots.get(quoted.author)} size={14} />}{t('：{body}', { body: quoted.body.slice(0, 120) })}
      </div>
    )
  if (owner) {
    return (
      <MessageFrame {...props} owner className="pod-msg pod-msg-owner">
        <div className="pod-bubble">
          {pageId === undefined ? null : <PageChip pageId={pageId} />}
          {quote}
          {attachment !== undefined && isUploadNote(message.body, String(attachment.name ?? '')) ? null : <Markdown text={message.body} mentions={calledMentions(message, props.mentions, true)} />}
          {attachment === undefined ? null : <Attachment attachment={attachment} />}
          {message.data.via === 'dsh' ? <div className="pod-muted-inline">{t('来自 dsh 会话视图')}</div> : null}
        </div>
        {props.hideTime === true ? null : <time className="pod-msg-time">{clock(message.createdAt)}</time>}
      </MessageFrame>
    )
  }
  const openBot = (): void => {
    if (bot !== undefined) app.showMember(bot.id)
  }
  return (
    <MessageFrame {...props} owner={false} className={`pod-msg${message.kind === 'kickoff' ? ' pod-msg-kickoff' : ''}`}>
      <button type="button" className="pod-msg-avatar" onClick={openBot} aria-label={t('{authorName} 的详情', { authorName: authorName(message.author, bots) })}>
        <Avatar bot={bot} size={28} />
      </button>
      <div className="pod-msg-main">
        <div className="pod-msg-head">
          <button type="button" className={`pod-msg-author${bot === undefined ? '' : ' pod-bot-name'}`} style={nameColor(bot)} onClick={openBot}>
            {authorName(message.author, bots)}
          </button>
          {message.kind === 'kickoff' ? <span className="pod-badge pod-badge-info">{t('开工说明')}</span> : null}
          {message.pinned ? <span className="pod-badge pod-badge-muted">{t('已置顶')}</span> : null}
          {pageId === undefined ? null : <PageChip pageId={pageId} />}
          <time>{clock(message.createdAt)}</time>
        </div>
        {quote}
        {xEvent === undefined ? <Markdown text={message.body} mentions={calledMentions(message, props.mentions, false)} /> : <XEventCard view={xEvent} />}
        {attachment === undefined ? null : <Attachment attachment={attachment} />}
        {run === undefined ? null : <RunSummaryLine run={run} />}
        {message.kind === 'kickoff' && typeof message.data.taskId === 'string' ? <KickoffActions taskId={message.data.taskId} /> : null}
      </div>
    </MessageFrame>
  )
}

/**
 * 你的或 bot 的一条消息的外框。有鼠标时操作是悬停浮出的一小排按钮；
 * 触屏上没有悬停，长按弹出操作面板（手机上从底下升起），按着的那条垫一层底色。
 */
function MessageFrame(props: MessageProps & { readonly owner: boolean; readonly className: string; readonly children: ReactNode }) {
  const touch = useTouch()
  const [view, setView] = useState<SheetView>('main')
  const [selecting, setSelecting] = useState(false)
  const menu = useMenu('start', view)
  const press = useLongPress((x, y) => {
    setView('main')
    menu.openAt(x, y)
  }, touch)
  return (
    <div className={`${props.className}${touch && menu.open ? ' pod-msg-pressed' : ''}`} {...press}>
      {props.children}
      {touch ? (
        <MessageSheet control={menu} view={view} onView={setView} message={props.message} owner={props.owner} onReply={props.onReply} onPinned={props.onPinned} onSelect={() => setSelecting(true)} />
      ) : (
        <MessageActions {...props} />
      )}
      {selecting ? (
        <Modal title={t('选择文字')} onClose={() => setSelecting(false)}>
          <div className="pod-select-text">{props.message.body}</div>
        </Modal>
      ) : null}
    </div>
  )
}

/**
 * 消息的操作：平时不显示，鼠标移到消息上时在右上角浮出一小排按钮，不占地方。
 * bot 的回复有复制、引用、重新回答、赞、踩，置顶和查看过程收在“…”里；你自己的消息有复制、引用和“…”。
 * 触屏上不用它，长按弹出 MessageSheet。
 */
function MessageActions(props: MessageProps & { readonly owner: boolean }) {
  const app = useApp()
  const { message } = props
  const menu = useMenu('start')
  const sessionId = message.sessionId
  const reply = answerable(message, props.owner)
  return (
    <div className={`pod-msg-actions${props.owner ? ' pod-msg-actions-owner' : ''}${menu.open ? ' pod-msg-actions-open' : ''}`} role="toolbar" aria-label={t('消息操作')}>
      <IconButton icon="copy" label={t('复制')} onClick={() => void copyText(message.body)} />
      <IconButton icon="reply" label={t('引用回复')} onClick={() => props.onReply(message)} />
      {reply ? (
        <>
          <IconButton icon="refresh" label={t('重新回答')} onClick={() => void api.regenerate(message.id).catch((reason: unknown) => window.alert(errorText(reason)))} />
          <RateButtons roomId={message.roomId} messageId={message.id} />
        </>
      ) : null}
      <button ref={menu.anchor} type="button" className="pod-icon-button" aria-label={t('更多')} title={t('更多')} aria-expanded={menu.open} onClick={menu.toggle}>
        <Icon name="more" size={15} />
      </button>
      <MenuPanel control={menu} label={t('这条消息的更多操作')}>
        <MenuItem
          icon={message.pinned ? 'unpin' : 'pin'}
          label={message.pinned ? t('取消置顶') : t('置顶这条消息')}
          onClick={() => {
            menu.close()
            void api.pinMessage(message.id, !message.pinned).then(props.onPinned)
          }}
        />
        {sessionId === null ? null : (
          <MenuItem
            icon="open"
            label={t('在 dsh 里查看过程')}
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
