import { useState, type ReactNode } from 'react'
import { OWNER, isUploadNote, t, type Bot, type RoomMessage } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { copyText } from '../../components/clipboard.ts'
import { Avatar, Button, IconButton, Modal } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { useLongPress } from '../../components/longPress.ts'
import { FoldText } from '../../components/FoldText.tsx'
import { Markdown } from '../../components/Markdown.tsx'
import { useTouch } from '../../components/media.ts'
import type { Mentions } from '../../components/mentions.tsx'
import { MenuItem, MenuPanel, useMenu } from '../../components/Menu.tsx'
import { decidedText } from '../../components/TaskDecision.tsx'
import { GroupChip, TaskChip } from '../../components/TaskEntry.tsx'
import { buildTaskLinks, namedIn, taskRefs } from '../../components/taskLinks.tsx'
import { useSnapshot } from '../../components/taskParts.tsx'
import { timeText } from '../../components/time.ts'
import { WaitCard } from '../../components/WaitCard.tsx'
import { PageCard, PageChip } from '../pages/PageCard.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { Attachment } from './Attachment.tsx'
import { BotBubble, OwnerBubble, rowClass } from './Bubble.tsx'
import { calledMentions } from './Calls.tsx'
import { MessageSheet, answerable, regenerable, type SheetView } from './MessageSheet.tsx'
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
  /** 任务群：子任务的任务卡显示成组长派活的那句话。 */
  readonly quiet?: boolean
  /** 这句话说到了任务：气泡开头挂任务记号。 */
  readonly chip?: boolean
  /** 几个人说话的对话：一组话的第一条上面写名字。 */
  readonly named?: boolean
  /** 一组话的第一条和最后一条：名字写在第一条上面，尾巴和头像只给最后一条。 */
  readonly first?: boolean
  readonly last?: boolean
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
  const { message, bots } = props
  switch (message.kind) {
    case 'notice': {
      if (message.data.segment === true) {
        return (
          <div className="pod-divider" role="separator">
            <span>{t('新的对话 · {time}', { time: timeText(message.createdAt) })}</span>
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
  const attachment = typeof message.data.attachment === 'object' && message.data.attachment !== null ? (message.data.attachment as Record<string, unknown>) : undefined
  const pageId = typeof message.data.pageId === 'string' ? message.data.pageId : undefined
  const xEvent = readXEvent(message.data.xEvent)
  const decided = decidedText(message.data.decided)
  const pinned = message.pinned ? <span className="pod-badge pod-badge-muted pod-msg-pinned">{t('已置顶')}</span> : null
  if (owner) {
    return (
      <MessageFrame {...props} owner className={rowClass('pod-msg pod-msg-owner', props)}>
        <OwnerBubble message={message} bots={bots} last={props.last !== false} quoted={props.quoted}>
          {pageId === undefined ? null : <PageChip pageId={pageId} />}
          {attachment !== undefined && isUploadNote(message.body, String(attachment.name ?? '')) ? null : <Markdown text={message.body} mentions={calledMentions(message, props.mentions, true)} />}
          {attachment === undefined ? null : <Attachment attachment={attachment} />}
          {message.data.via === 'dsh' ? <div className="pod-muted-inline">{t('来自 dsh 会话视图')}</div> : null}
        </OwnerBubble>
        {pinned}
      </MessageFrame>
    )
  }
  // 等你：发问的 bot 问的事画成卡片（问题、批准、登录）；X 上的事件是一张卡片。这两种不套灰气泡。
  const card = message.kind === 'wait' ? <WaitCard message={message} /> : xEvent === undefined ? undefined : <XEventCard view={xEvent} />
  // 说到任务的话：句子里提到标题的地方画成任务链接，没提到标题的放在气泡开头。
  const refs = props.chip === true ? taskRefs(message) : []
  const links = buildTaskLinks(
    refs.filter((ref) => namedIn(message.body, ref)),
    (taskId, key) => <TaskChip key={key} taskId={taskId} roomId={message.roomId} inline />,
  )
  return (
    <MessageFrame {...props} owner={false} className={rowClass('pod-msg pod-msg-bot', props)}>
      <BotBubble message={message} bots={bots} named={props.named === true} first={props.first !== false} last={props.last !== false} quoted={props.quoted} card={card}>
        {/* 说到任务的话（开任务时的那句、交来的回答、转告）没提到标题的：气泡开头是那个任务的记号，点一下在右边小窗打开任务对话。 */}
        {refs
          .filter((ref) => !namedIn(message.body, ref))
          .map((ref) => (
            <span key={ref.id} className="pod-bubble-chip">
              <TaskChip taskId={ref.id} roomId={message.roomId} />
            </span>
          ))}
        {pageId === undefined ? null : <PageChip pageId={pageId} />}
        <Markdown text={message.body} mentions={calledMentions(message, props.mentions, false)} links={links} />
        {attachment === undefined ? null : <Attachment attachment={attachment} />}
      </BotBubble>
      {/* Super-agent 转告任务在问的事：那件事的卡片（问题、批准、登录）挂在这句下面，在这里点就是答复。 */}
      {message.kind !== 'wait' && typeof message.data.waitId === 'string' ? (
        <div className="pod-msg-under">
          <WaitCard message={message} />
        </div>
      ) : null}
      {pinned}
      {/* 以前在这句话后面点过的“收下”“重试”这些，留一行小字。 */}
      {decided === undefined ? null : <div className="pod-ask-done">{decided}</div>}
      {message.kind === 'kickoff' && typeof message.data.taskId === 'string' ? <KickoffActions taskId={message.data.taskId} /> : null}
    </MessageFrame>
  )
}

/** 任务群里的派活：组长 @ 成员，说要做什么（子任务的标题，说明长的先折起来）；不再单独画一行子任务。 */
function SubtaskAsk(props: MessageProps & { readonly taskId: string }) {
  const { message, bots } = props
  const { snapshot } = useSnapshot(props.taskId)
  const ownerId = snapshot?.task.ownerBotId ?? null
  const owner = ownerId === null ? undefined : bots.get(ownerId)
  const name = owner?.name ?? snapshot?.ownerName ?? null
  const brief = snapshot === undefined || snapshot.task.brief === snapshot.task.title ? '' : snapshot.task.brief
  return (
    <MessageFrame {...props} owner={false} className={rowClass('pod-msg pod-msg-bot', props)}>
      <BotBubble message={message} bots={bots} named={props.named === true} first={props.first !== false} last={props.last !== false} quoted={props.quoted}>
        <Markdown text={name === null ? message.body : `@${name} ${message.body}`} mentions={props.mentions} />
        {brief === '' ? null : (
          <div className="pod-subtask-brief">
            <FoldText text={brief} limit={160} />
          </div>
        )}
      </BotBubble>
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
 * bot 的回复有复制、引用、重新回答、赞、踩，置顶收在“…”里；你自己的消息有复制、引用和“…”。
 * 触屏上不用它，长按弹出 MessageSheet。
 */
function MessageActions(props: MessageProps & { readonly owner: boolean }) {
  const { message } = props
  const menu = useMenu('start')
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
      </MenuPanel>
    </div>
  )
}
