import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { isTemporaryRoom, type Bot, type Room, type RoomMessage } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Avatar, nameColor } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { Markdown } from '../../components/Markdown.tsx'
import { buildMentions, type Mentions } from '../../components/mentions.tsx'
import { ProgressBlock } from '../../components/Progress.tsx'
import { useApp, useLive, useNav, usePodEvent, type LiveStatus, type LiveStream } from '../../state/app.ts'
import { arrange } from './arrange.ts'
import { MessageItem } from './MessageItem.tsx'

const PAGE = 50

/** 未读超过这么多条时，未读位置显示一段摘要。 */
const UNREAD_SUMMARY_THRESHOLD = 20

/** 离底部超过这么多像素时，右下角出现“回到最新”。 */
const JUMP_DISTANCE = 240

function merge(current: readonly RoomMessage[], incoming: readonly RoomMessage[]): readonly RoomMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].filter((message) => message.deletedAt === null).sort((left, right) => left.seq - right.seq)
}

/** 离开后回来的摘要：直接取自里程碑和卡片，不调用模型。 */
function UnreadSummary(props: { readonly messages: readonly RoomMessage[]; readonly onJump: () => void; readonly onDismiss: () => void }) {
  const milestones = props.messages.filter((message) => message.kind === 'milestone').slice(-4)
  const waits = props.messages.filter((message) => message.kind === 'wait').length
  return (
    <div className="pod-unread-summary">
      <strong>你离开期间有 {props.messages.length} 条新消息</strong>
      {milestones.length === 0 ? null : (
        <ul>
          {milestones.map((message) => (
            <li key={message.id}>{message.body}</li>
          ))}
        </ul>
      )}
      {waits === 0 ? null : <div>需要你处理：{waits} 件</div>}
      <div className="pod-row">
        <button type="button" className="pod-link" onClick={props.onJump}>
          跳到第一条未读
        </button>
        <button type="button" className="pod-link" onClick={props.onDismiss}>
          全部标为已读
        </button>
      </div>
    </div>
  )
}

function startOfDay(time: number): number {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** 日期分隔线上的字：今天、昨天，再早的写几月几日周几（跨年带年份）。 */
function dayLabel(time: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(time)) / 86_400_000)
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  const date = new Date(time)
  const year = date.getFullYear() === new Date(now).getFullYear() ? '' : `${date.getFullYear()}年`
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 周${'日一二三四五六'[date.getDay()] ?? ''}`
}

/** 还没有消息时：介绍一下这是谁（或群里有谁），告诉你怎么开始。 */
function Intro(props: { readonly room: Room; readonly bots: ReadonlyMap<string, Bot>; readonly members: readonly Bot[] }) {
  const { room } = props
  if (room.kind === 'direct') {
    const bot = room.botId === null ? undefined : props.bots.get(room.botId)
    const temporary = isTemporaryRoom(room)
    return (
      <div className="pod-intro">
        <Avatar bot={bot} size={56} />
        <strong>{bot?.name ?? room.title}</strong>
        {bot === undefined || bot.title === '' || bot.title === bot.name ? null : <span className="pod-muted">{bot.title}</span>}
        {bot === undefined || bot.card.duties === '' ? null : <p>{bot.card.duties}</p>}
        <span className="pod-muted-inline">{temporary ? '这是临时对话：不进侧栏、不写记忆，离开就删掉。' : '在下面说点什么，开始和它对话。'}</span>
      </div>
    )
  }
  return (
    <div className="pod-intro">
      <div className="pod-intro-members">
        {props.members.map((member) => (
          <span key={member.id} className="pod-intro-member">
            <Avatar bot={member} size={40} />
            <span>{member.name}</span>
          </span>
        ))}
      </div>
      <strong>{room.title}</strong>
      <span className="pod-muted-inline">
        在下面说点什么；输入 @ 可以直接点名成员，{room.taskId === null && room.teamId === null ? '没点名时按分工交给对口的成员来接。' : '没点名时组长来接。'}
      </span>
    </div>
  )
}

/** bot 正在回答：有文字就显示正在输入的文字，还没有文字就显示它在做什么。 */
/** 「让它汇报」发出去的话：说完接着做，不是让它停下。 */
const REPORT_ASK = '汇报一下进展：现在做到哪了、遇到了什么问题、接下来打算怎么做。说完接着做。'

function LiveReply(props: {
  readonly bot: Bot | undefined
  readonly stream: LiveStream | undefined
  readonly status: LiveStatus | undefined
  readonly onOpenBot: () => void
  readonly mentions: Mentions
  readonly onReport: () => void
  readonly onStop: () => void
}) {
  const label = props.status === undefined ? '' : props.status.label
  return (
    <div className="pod-msg pod-msg-live" aria-live="polite">
      <button type="button" className="pod-msg-avatar" onClick={props.onOpenBot} aria-label={`${props.bot?.name ?? 'bot'} 的详情`}>
        <Avatar bot={props.bot} size={28} />
      </button>
      <div className="pod-msg-main">
        <div className="pod-msg-head">
          <button type="button" className={`pod-msg-author${props.bot === undefined ? '' : ' pod-bot-name'}`} style={nameColor(props.bot)} onClick={props.onOpenBot}>
            {props.bot?.name ?? 'bot'}
          </button>
        </div>
        {props.stream === undefined ? null : <Markdown text={props.stream.text} mentions={props.mentions} />}
        <ProgressBlock progress={props.status?.progress ?? null} label={label} streaming={props.stream !== undefined} onReport={props.onReport} onStop={props.onStop} />
      </div>
    </div>
  )
}

export interface TimelineProps {
  readonly room: Room
  readonly bots: ReadonlyMap<string, Bot>
  /** 群成员：空的群显示介绍时用。 */
  readonly members: readonly Bot[]
  readonly onReply: (message: RoomMessage) => void
  /** 进对话那一刻的已读位置，用来决定显示不显示未读摘要。 */
  readonly readSeqAtOpen: number
  /** 你刚发出一条消息的时间：一变就回到最新，之后跟着新消息往下走。 */
  readonly followAt: number
}

/**
 * 时间线：一次加载 50 条，往上滚加载更早的，往下滚到头时补上更新的；新消息按 id 合并进来（卡片原地更新也是同一条）。
 * 在底部附近时新消息自动滚到底；你发出消息时不管翻到哪都回到最新。往上翻远了右下角出现圆形的“回到最新”，角上是这期间来的新消息条数。
 * bot 在回答时显示它正在做什么和正在输入的文字。以前在同一个对话里“开新对话”留下的分隔线照常显示。
 * 同一段回复里先显示文字，页面、任务卡这些卡片和状态行放在下面（见 arrange）；bot 还在回答时，正在输入的文字也排在这段的卡片上面。
 */
export function Timeline(props: TimelineProps) {
  const { room } = props
  const [messages, setMessages] = useState<readonly RoomMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [summaryDismissed, setSummaryDismissed] = useState(false)
  /** 往上翻远了：显示“回到最新”；记下翻走那一刻最后一条的 seq，用来数这期间的新消息。 */
  const [awayFrom, setAwayFrom] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const loadingNewer = useRef(false)
  const live = useLive(room.id)
  const app = useApp()
  const nav = useNav()
  const focus = nav.focus?.roomId === room.id ? nav.focus : null

  const reloadAll = useCallback(() => {
    api
      .messages(room.id, { limit: PAGE })
      .then((page) => {
        setMessages(page.messages)
        setHasMore(page.messages.length >= PAGE)
        setLoaded(true)
      })
      .catch((reason: unknown) => setError(errorText(reason)))
  }, [room.id])

  const refreshLatest = useCallback(() => {
    api
      .messages(room.id, { limit: PAGE })
      .then((page) => {
        setMessages((current) => merge(current, page.messages))
        setLoaded(true)
      })
      .catch((reason: unknown) => setError(errorText(reason)))
  }, [room.id])

  useEffect(() => {
    if (focus === null) return
    // 从搜索结果跳过来：加载目标消息前后的内容，滚到它并高亮。
    nearBottom.current = false
    api
      .messagesAround(room.id, focus.seq)
      .then((page) => {
        setMessages((current) => merge(current, page.messages))
        setLoaded(true)
        requestAnimationFrame(() => document.getElementById(`pod-msg-${focus.messageId}`)?.scrollIntoView({ block: 'center' }))
        setTimeout(() => app.navigate({ focus: null }), 4000)
      })
      .catch((reason: unknown) => setError(errorText(reason)))
  }, [room.id, focus?.messageId])

  useEffect(() => {
    setMessages([])
    setLoaded(false)
    setHasMore(true)
    setSummaryDismissed(false)
    setAwayFrom(null)
    setError(undefined)
    nearBottom.current = true
    if (nav.focus?.roomId === room.id) return
    reloadAll()
  }, [room.id])

  usePodEvent(
    (event) => {
      if (event.type === 'message' && event.roomId === room.id) refreshLatest()
      // 清空记录后整页重新拉，删掉的消息不会留在页面上。
      if (event.type === 'room' && event.roomId === room.id) reloadAll()
      if (event.type === 'resync') reloadAll()
    },
    [room.id, refreshLatest, reloadAll],
  )

  const loadOlder = (): void => {
    const first = messages[0]
    if (first === undefined || !hasMore) return
    const element = scroller.current
    const before = element === null ? 0 : element.scrollHeight - element.scrollTop
    api
      .messages(room.id, { before: first.seq, limit: PAGE })
      .then((page) => {
        setHasMore(page.messages.length >= PAGE)
        setMessages((current) => merge(current, page.messages))
        requestAnimationFrame(() => {
          if (element !== null) element.scrollTop = element.scrollHeight - before
        })
      })
      .catch((reason: unknown) => setError(errorText(reason)))
  }

  const last = messages.at(-1)
  const streamText = live.streams.map((stream) => stream.text.length).join(',')
  useLayoutEffect(() => {
    const element = scroller.current
    if (element !== null && nearBottom.current) element.scrollTop = element.scrollHeight
  }, [messages.length, last?.id, last?.version, streamText, live.statuses.length])

  useEffect(() => {
    if (last === undefined || last.seq <= room.readSeq) return
    const timer = setTimeout(() => void api.markRead(room.id, last.seq).catch(() => {}), 600)
    return () => clearTimeout(timer)
  }, [room.id, room.readSeq, last?.seq])

  /** 从搜索跳到旧消息后，下面可能还有没加载的新消息：滚到底时补上。 */
  const behind = last !== undefined && room.lastSeq > last.seq

  const loadNewer = (): void => {
    if (last === undefined || loadingNewer.current) return
    loadingNewer.current = true
    api
      .messages(room.id, { after: last.seq, limit: PAGE })
      .then((page) => setMessages((current) => merge(current, page.messages)))
      .catch((reason: unknown) => setError(errorText(reason)))
      .finally(() => {
        loadingNewer.current = false
      })
  }

  const onScroll = (): void => {
    const element = scroller.current
    if (element === null) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    nearBottom.current = distance < 80
    const away = distance > JUMP_DISTANCE
    if (away && awayFrom === null) setAwayFrom(last?.seq ?? 0)
    if (!away && awayFrom !== null) setAwayFrom(null)
    if (element.scrollTop < 40 && loaded) loadOlder()
    if (nearBottom.current && behind) loadNewer()
  }

  /** 回到最新：先把最新的一页合并进来（从搜索跳过来时可能还没加载），再滚到底。 */
  const jumpToLatest = (behavior: ScrollBehavior = 'smooth'): void => {
    nearBottom.current = true
    setAwayFrom(null)
    if (behind) refreshLatest()
    const element = scroller.current
    if (element !== null) element.scrollTo({ top: element.scrollHeight, behavior })
  }

  // 你发了消息：直接跳到最新，你的消息和 bot 的回答出现时都贴着底部。
  useEffect(() => {
    if (props.followAt > 0) jumpToLatest('auto')
  }, [props.followAt])

  const mentions = useMemo(
    () => buildMentions([...props.bots.values()].filter((bot) => bot.archivedAt === null).map((bot) => ({ name: bot.name, bot, onOpen: () => app.showMember(bot.id) }))),
    [props.bots, app],
  )
  const now = Date.now()
  const byId = new Map(messages.map((message) => [message.id, message]))
  const unread = messages.filter((message) => message.seq > props.readSeqAtOpen && message.author !== 'owner')
  const showSummary = !summaryDismissed && unread.length > UNREAD_SUMMARY_THRESHOLD
  const firstUnread = unread[0]
  // 每个正在回答的会话一段：有打字流的按打字流，只有状态的显示“正在……”。
  const replies = [...new Set([...live.statuses.map((status) => status.sessionId), ...live.streams.map((stream) => stream.sessionId)])].map((sessionId) => {
    const stream = live.streams.find((item) => item.sessionId === sessionId)
    const status = live.statuses.find((item) => item.sessionId === sessionId)
    return { sessionId, stream, status, botId: stream?.botId ?? status?.botId ?? '' }
  })
  const blocks = arrange(messages)
  const ordered = blocks.flatMap((block) => [...block.texts, ...block.cards])
  // 最后一段回复的 bot 还在说：正在输入的文字排在这段的卡片上面，说完不跳位置。
  const tail = blocks.at(-1)
  const inline = tail?.author === undefined || tail.cards.length === 0 ? undefined : replies.find((reply) => reply.botId === tail.author)
  const inlineBefore = inline === undefined ? undefined : tail?.cards[0]?.id
  // 让它汇报：在群里要 @ 到它，不然会按分工交给别的成员。
  const report = (botId: string): void => {
    const name = props.bots.get(botId)?.name
    const text = room.kind === 'direct' || name === undefined ? REPORT_ASK : `@${name} ${REPORT_ASK}`
    api.send(room.id, text).catch((reason: unknown) => setError(errorText(reason)))
  }
  const stopReply = (): void => {
    api.stopReply(room.id).catch((reason: unknown) => setError(errorText(reason)))
  }
  const liveReply = (reply: (typeof replies)[number]) => (
    <LiveReply
      key={reply.sessionId}
      bot={props.bots.get(reply.botId)}
      stream={reply.stream}
      status={reply.status}
      onOpenBot={() => app.showMember(reply.botId)}
      mentions={mentions}
      onReport={() => report(reply.botId)}
      onStop={stopReply}
    />
  )

  const arrived = awayFrom === null ? 0 : messages.filter((message) => message.seq > awayFrom && message.author !== 'owner').length + (behind ? room.lastSeq - (last?.seq ?? 0) : 0)
  return (
    <div className="pod-timeline-wrap">
      <div className="pod-timeline" ref={scroller} onScroll={onScroll}>
        <div className="pod-timeline-inner">
          {error === undefined ? null : <p className="pod-form-error">{error}</p>}
          {loaded && messages.length === 0 && replies.length === 0 ? <Intro room={room} bots={props.bots} members={props.members} /> : null}
          {hasMore && loaded && messages.length >= PAGE ? (
            <button type="button" className="pod-link pod-load-older" onClick={loadOlder}>
              加载更早的消息
            </button>
          ) : null}
          {ordered.map((message, index) => {
            const previous = ordered[index - 1]
            const newDay = previous === undefined || startOfDay(previous.createdAt) !== startOfDay(message.createdAt)
            return (
              <Fragment key={message.id}>
                {inline !== undefined && message.id === inlineBefore ? liveReply(inline) : null}
                {newDay ? (
                  <div className="pod-day" role="separator">
                    <span>{dayLabel(message.createdAt, now)}</span>
                  </div>
                ) : null}
                <div id={`pod-msg-${message.id}`} className={focus?.messageId === message.id ? 'pod-focused' : undefined}>
                  {showSummary && firstUnread?.id === message.id ? (
                    <UnreadSummary
                      messages={unread}
                      onJump={() => document.getElementById(`pod-msg-${firstUnread.id}`)?.scrollIntoView({ block: 'start' })}
                      onDismiss={() => setSummaryDismissed(true)}
                    />
                  ) : null}
                  <MessageItem
                    message={message}
                    bots={props.bots}
                    quoted={message.replyTo === null ? undefined : byId.get(message.replyTo)}
                    onReply={props.onReply}
                    onPinned={(updated) => setMessages((current) => merge(current, [updated]))}
                    mentions={mentions}
                  />
                </div>
              </Fragment>
            )
          })}
          {replies.filter((reply) => reply !== inline).map(liveReply)}
        </div>
      </div>
      {awayFrom === null && !(behind && !nearBottom.current) ? null : (
        <button type="button" className="pod-jump-latest" onClick={() => jumpToLatest()} aria-label={arrived > 0 ? `回到最新，有 ${arrived} 条新消息` : '回到最新'} title="回到最新">
          <Icon name="arrow-down" size={18} />
          {arrived > 0 ? <span className="pod-jump-count">{arrived > 99 ? '99+' : arrived}</span> : null}
        </button>
      )}
    </div>
  )
}
