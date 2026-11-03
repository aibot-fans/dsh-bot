import { useState, type ReactNode } from 'react'
import { OWNER, POD, isUploadNote, readRunSummary, t, type Bot, type RoomMessage } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { copyText } from '../../components/clipboard.ts'
import { Avatar, Button, IconButton, Modal, clock, nameColor } from '../../components/common.tsx'
import { BotName } from '../../components/GroupMark.tsx'
import { Icon } from '../../components/Icon.tsx'
import { useLongPress } from '../../components/longPress.ts'
import { FoldText } from '../../components/FoldText.tsx'
import { Markdown } from '../../components/Markdown.tsx'
import { useTouch } from '../../components/media.ts'
import type { Mentions } from '../../components/mentions.tsx'
import { MenuItem, MenuPanel, useMenu } from '../../components/Menu.tsx'
import { RunSummaryLine } from '../../components/Progress.tsx'
import { TaskDecision, decidedText } from '../../components/TaskDecision.tsx'
import { GroupChip, TaskChip } from '../../components/TaskEntry.tsx'
import { useSnapshot } from '../../components/taskParts.tsx'
import { WaitCard } from '../../components/WaitCard.tsx'
import { PageCard, PageChip } from '../pages/PageCard.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { Attachment } from './Attachment.tsx'
import { calledMentions } from './Calls.tsx'
import { MessageRoutes } from './MessageRoutes.tsx'
import { MessageSheet, answerable, regenerable, type SheetView } from './MessageSheet.tsx'
import { useOpenBot } from './openBot.ts'
import { RateButtons } from './Rating.tsx'
import { TaskCardItem } from './TaskCardItem.tsx'
import { readTurnError, TurnErrorLine } from './TurnErrorLine.tsx'
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
  /** 任务群：子任务的任务卡显示成组长派活的那句话。 */
  readonly quiet?: boolean
  /** 这是任务要你定的最近那句话（交上来等验收、受阻、没做成）：后面带两个按钮。 */
  readonly decision?: boolean
}

function authorName(author: string, bots: ReadonlyMap<string, Bot>): string {
  if (author === OWNER) return t('你')
  if (author === POD) return 'dsh-bot'
  return bots.get(author)?.name ?? t('已删除的 bot')
}

/** 组长开场：谨慎档等你点“开始”或“先不”；开工以后就是一句普通的话，停下、改要求都在群里说。 */
function KickoffActions(props: { readonly taskId: string }) {
  const app = useApp()
  const { data: snapshot } = useResource(app.cache, `snapshot:${props.taskId}`, () => api.taskSnapshot(props.taskId))
  if (snapshot === undefined || !snapshot.task.planPending) return null
  const { task } = snapshot
  const act = (work: () => Promise<unknown>): void => {
    work().catch((reason: unknown) => window.alert(errorText(reason)))
  }
  return (
    <div className="pod-kickoff-actions">
      <Button small kind="primary" icon="play" onClick={() => act(() => api.approvePlan(task.id))}>
        {t('开始')}
      </Button>
      <Button small kind="quiet" onClick={() => act(() => api.controlTask(task.id, 'cancel'))}>
        {t('先不')}
      </Button>
    </div>
  )
}

/** 提到一个群的提示（比如“拉了群「监控播报」”）：群名换成进群的入口，点一下进那个群。 */
function RoomNotice(props: { readonly body: string; readonly roomId: string }) {
  const match = /「([^」]+)」|“([^”]+)”/.exec(props.body)
  if (match === null) return <GroupChip roomId={props.roomId} title={props.body} />
  return (
    <>
      {props.body.slice(0, match.index)}
      <GroupChip roomId={props.roomId} title={match[1] ?? match[2] ?? match[0]} />
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

/** 时间线里的一条：你的气泡、bot 的发言、一行提示、任务记号、页面卡片、等你处理的那句话或折叠内容。 */
export function MessageItem(props: MessageProps) {
  const app = useApp()
  const showBot = useOpenBot()
  // 这一轮的步骤（用时、几步）平时不显示，从消息的“更多”里展开。
  const [stepsOpen, setStepsOpen] = useState(false)
  const { message, bots } = props
  switch (message.kind) {
    case 'notice': {
      if (message.data.segment === true) {
        return (
          <div className="pod-divider" role="separator">
            <span>{t('新的对话 · {clock}', { clock: clock(message.createdAt) })}</span>
          </div>
        )
      }
      const failure = readTurnError(message.data.turnError)
      if (failure !== undefined) return <TurnErrorLine message={message} error={failure} />
      return (
        <div className="pod-line pod-line-notice">
          <span className="pod-line-text">
            {bots.has(message.author) ? <Avatar bot={bots.get(message.author)} size={16} /> : null}
            {typeof message.data.roomId === 'string' ? <RoomNotice body={message.body} roomId={message.data.roomId} /> : message.body}
          </span>
        </div>
      )
    }
    case 'task-card':
      // 任务群里的子任务就是组长 @ 成员说要做什么的一句话，成员的结果回在它下面。
      if (props.quiet === true && typeof message.data.parentId === 'string') return <SubtaskAsk {...props} taskId={String(message.data.taskId ?? '')} />
      // 别处是派活那句话下面的任务卡片；也能引用回复：回复它的话直接送进这个任务。
      return (
        <MessageFrame {...props} owner={false} className="pod-msg-card pod-msg-card-task">
          <TaskCardItem taskId={String(message.data.taskId ?? '')} roomId={message.roomId} />
        </MessageFrame>
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
  const decided = decidedText(message.data.decided)
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
        {message.pinned ? <span className="pod-badge pod-badge-muted pod-msg-pinned">{t('已置顶')}</span> : null}
        {props.hideTime === true ? null : <time className="pod-msg-time">{clock(message.createdAt)}</time>}
      </MessageFrame>
    )
  }
  const openBot = (): void => {
    if (bot !== undefined) showBot(bot.id)
  }
  const steps = run === undefined ? undefined : { open: stepsOpen, toggle: () => setStepsOpen((value) => !value) }
  return (
    <MessageFrame {...props} owner={false} steps={steps} className="pod-msg">
      <button type="button" className="pod-msg-avatar" onClick={openBot} aria-label={t('{authorName} 的详情', { authorName: authorName(message.author, bots) })}>
        <Avatar bot={bot} size={28} />
      </button>
      <div className="pod-msg-main">
        <div className="pod-msg-head">
          <button type="button" className={`pod-msg-author${bot === undefined ? '' : ' pod-bot-name'}`} style={nameColor(bot)} onClick={openBot}>
            {authorName(message.author, bots)}
          </button>
          {message.pinned ? <span className="pod-badge pod-badge-muted">{t('已置顶')}</span> : null}
          {pageId === undefined ? null : <PageChip pageId={pageId} />}
          <time>{clock(message.createdAt)}</time>
        </div>
        {quote}
        {/* 等你：发问的 bot 说的那句话，后面带按钮。 */}
        {message.kind === 'wait' ? (
          <WaitCard message={message} />
        ) : xEvent === undefined ? (
          <Markdown text={message.body} mentions={calledMentions(message, props.mentions, false)} />
        ) : (
          <XEventCard view={xEvent} />
        )}
        {attachment === undefined ? null : <Attachment attachment={attachment} />}
        {/* Super-agent 转告任务的问题、结论，转给任务后的确认：话下面挂那个任务的记号，点一下在右边小窗打开任务对话。 */}
        {(message.data.purpose === 'relay' || message.data.purpose === 'confirm') && typeof message.data.taskId === 'string' ? (
          <div className="pod-msg-chips">
            <TaskChip taskId={message.data.taskId} roomId={message.roomId} />
          </div>
        ) : null}
        {decided !== undefined ? (
          <div className="pod-ask-done">{decided}</div>
        ) : props.decision === true && typeof message.data.taskId === 'string' ? (
          <TaskDecision
            taskId={message.data.taskId}
            onRevise={() => {
              props.onReply(message)
              app.focusComposer(message.roomId)
            }}
          />
        ) : null}
        {run === undefined || !stepsOpen ? null : <RunSummaryLine run={run} />}
        {message.kind === 'kickoff' && typeof message.data.taskId === 'string' ? <KickoffActions taskId={message.data.taskId} /> : null}
      </div>
    </MessageFrame>
  )
}

/** 任务群里的派活：组长 @ 成员，说要做什么（子任务的标题，说明长的先折起来）；不再单独画一行子任务。 */
function SubtaskAsk(props: MessageProps & { readonly taskId: string }) {
  const showBot = useOpenBot()
  const { message, bots } = props
  const { snapshot } = useSnapshot(props.taskId)
  const lead = bots.get(message.author)
  const ownerId = snapshot?.task.ownerBotId ?? null
  const owner = ownerId === null ? undefined : bots.get(ownerId)
  const name = owner?.name ?? snapshot?.ownerName ?? null
  const brief = snapshot === undefined || snapshot.task.brief === snapshot.task.title ? '' : snapshot.task.brief
  const openBot = (): void => {
    if (lead !== undefined) showBot(lead.id)
  }
  return (
    <MessageFrame {...props} owner={false} className="pod-msg">
      <button type="button" className="pod-msg-avatar" onClick={openBot} aria-label={t('{authorName} 的详情', { authorName: authorName(message.author, bots) })}>
        <Avatar bot={lead} size={28} />
      </button>
      <div className="pod-msg-main">
        <div className="pod-msg-head">
          <button type="button" className={`pod-msg-author${lead === undefined ? '' : ' pod-bot-name'}`} style={nameColor(lead)} onClick={openBot}>
            {authorName(message.author, bots)}
          </button>
          <time>{clock(message.createdAt)}</time>
        </div>
        <Markdown text={name === null ? message.body : `@${name} ${message.body}`} mentions={props.mentions} />
        {brief === '' ? null : (
          <div className="pod-subtask-brief">
            <FoldText text={brief} limit={160} />
          </div>
        )}
      </div>
    </MessageFrame>
  )
}

/** 这一轮记下的执行过程：从“更多”里展开或收起。 */
interface Steps {
  readonly open: boolean
  readonly toggle: () => void
}

/**
 * 你的或 bot 的一条消息的外框。有鼠标时操作是悬停浮出的一小排按钮；
 * 触屏上没有悬停，长按弹出操作面板（手机上从底下升起），按着的那条垫一层底色。
 */
function MessageFrame(props: MessageProps & { readonly owner: boolean; readonly className: string; readonly children: ReactNode; readonly steps?: Steps }) {
  const touch = useTouch()
  const [view, setView] = useState<SheetView>('main')
  const [selecting, setSelecting] = useState(false)
  // 你的消息：鼠标停上去时才去取它的去向。
  const [hovered, setHovered] = useState(false)
  const routable = (props.owner || props.message.data.xEvent !== undefined) && !touch
  const menu = useMenu('start', view)
  const press = useLongPress((x, y) => {
    setView('main')
    menu.openAt(x, y)
  }, touch)
  return (
    <div
      className={`${props.className}${touch && menu.open ? ' pod-msg-pressed' : ''}`}
      {...press}
      onMouseEnter={routable ? () => setHovered(true) : undefined}
      onMouseLeave={routable ? () => setHovered(false) : undefined}
    >
      {props.children}
      {routable && hovered ? <MessageRoutes messageId={props.message.id} bots={props.bots} /> : null}
      {touch ? (
        <MessageSheet control={menu} view={view} onView={setView} message={props.message} owner={props.owner} onReply={props.onReply} onPinned={props.onPinned} onSelect={() => setSelecting(true)} steps={props.steps} />
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
 * bot 的回复有复制、引用、重新回答、赞、踩，置顶、这一轮的步骤和查看过程收在“…”里；你自己的消息有复制、引用和“…”。
 * 触屏上不用它，长按弹出 MessageSheet。
 */
function MessageActions(props: MessageProps & { readonly owner: boolean; readonly steps?: Steps }) {
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
          {regenerable(message, props.owner) ? (
            <IconButton icon="refresh" label={t('重新回答')} onClick={() => void api.regenerate(message.id).catch((reason: unknown) => window.alert(errorText(reason)))} />
          ) : null}
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
        {props.steps === undefined ? null : (
          <MenuItem
            icon="history"
            label={props.steps.open ? t('收起这一轮的步骤') : t('这一轮的步骤')}
            onClick={() => {
              menu.close()
              props.steps?.toggle()
            }}
          />
        )}
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
