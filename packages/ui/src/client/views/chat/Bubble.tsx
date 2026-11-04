import type { ReactNode } from 'react'
import { OWNER, POD, oneLine, t, type Bot, type RoomMessage } from 'pod-domain'
import { Avatar, nameColor } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { useApp } from '../../state/app.ts'
import { BubbleTail } from './BubbleTail.tsx'
import { fullTime } from './bubbles.ts'
import { useOpenBot } from './openBot.ts'

/** 引用里最多放这么多字（显示时只有一行）。 */
const QUOTE_CHARS = 160

export function authorName(author: string, bots: ReadonlyMap<string, Bot>): string {
  if (author === OWNER) return t('你')
  if (author === POD) return 'dsh-bot'
  return bots.get(author)?.name ?? t('已删除的 bot')
}

/** 一行的类名：一组话的第一条上面留出空，最后一条下面给尾巴留出空。 */
export function rowClass(base: string, place: { readonly first?: boolean; readonly last?: boolean }): string {
  return `${base}${place.first === false ? '' : ' pod-msg-first'}${place.last === false ? '' : ' pod-msg-last'}`
}

function quoteText(quoted: RoomMessage): string {
  return oneLine(quoted.body).slice(0, QUOTE_CHARS)
}

/**
 * 回的那句话不在旁边、看不出回的是哪句时，气泡上面一行灰色小字：“回复你：……”（只写一行），点一下跳到原话；
 * 回的是任务卡时写“回复任务：任务名”，点一下在右边看任务详情。你点“回复”引的和 bot 回的都这么画，左右跟着气泡。
 */
function ReplyRef(props: { readonly quoted: RoomMessage; readonly bots: ReadonlyMap<string, Bot> }) {
  const app = useApp()
  const { quoted } = props
  const name = authorName(quoted.author, props.bots)
  const text = quoteText(quoted)
  // 回的是任务卡：点了在右边看那个任务的详情。
  const taskId = quoted.kind === 'task-card' && typeof quoted.data.taskId === 'string' ? quoted.data.taskId : undefined
  return (
    <button
      type="button"
      className="pod-reply-ref"
      onClick={() => (taskId === undefined ? app.focusMessage(quoted.roomId, quoted.seq, quoted.id) : app.showTask(taskId))}
      title={taskId === undefined ? t('{name}：{text}', { name, text }) : t('看任务「{title}」的详情', { title: text })}
    >
      <Icon name="reply" size={12} />
      <span className="pod-reply-who">{taskId === undefined ? t('回复{name}：', { name }) : t('回复任务：')}</span>
      <span className="pod-reply-text">{text}</span>
    </button>
  )
}

/**
 * bot 的一条：几个人说话的对话里，一组话的第一条上面写名字；看不出回的是哪句时上面一行小字写出来；
 * 一组的最后一条左边那一列是头像（和气泡底边对齐），灰气泡带尾巴。等你、X 事件这些卡片不套气泡。
 */
export function BotBubble(props: {
  readonly message: RoomMessage
  readonly bots: ReadonlyMap<string, Bot>
  readonly named: boolean
  readonly first: boolean
  readonly last: boolean
  readonly quoted: RoomMessage | undefined
  /** 不套灰气泡、直接放的卡片。 */
  readonly card?: ReactNode
  readonly children?: ReactNode
}) {
  const showBot = useOpenBot()
  const { message } = props
  const bot = props.bots.get(message.author)
  const name = authorName(message.author, props.bots)
  return (
    <>
      {props.named && props.first ? (
        <span className={`pod-msg-label${bot === undefined ? '' : ' pod-bot-name'}`} style={nameColor(bot)}>
          {name}
        </span>
      ) : null}
      {props.quoted === undefined ? null : <ReplyRef quoted={props.quoted} bots={props.bots} />}
      <div className={`pod-bubble-wrap${props.card === undefined ? '' : ' pod-bubble-wrap-card'}`}>
        {props.last ? (
          <button type="button" className="pod-msg-avatar" onClick={() => bot !== undefined && showBot(bot.id)} aria-label={t('{authorName} 的详情', { authorName: name })}>
            <Avatar bot={bot} size={28} />
          </button>
        ) : null}
        {props.card ?? (
          <div className="pod-bubble pod-bubble-bot" title={fullTime(message.createdAt)}>
            {props.children}
            {props.last ? <BubbleTail side="left" /> : null}
          </div>
        )}
      </div>
    </>
  )
}

/** 你的一条：靠右的灰气泡，一组的最后一条带尾巴；回的话不在旁边时，上面一行小字写回的是哪句。 */
export function OwnerBubble(props: { readonly message: RoomMessage; readonly bots: ReadonlyMap<string, Bot>; readonly last: boolean; readonly quoted: RoomMessage | undefined; readonly children: ReactNode }) {
  const { quoted } = props
  return (
    <>
      {quoted === undefined ? null : <ReplyRef quoted={quoted} bots={props.bots} />}
      <div className="pod-bubble pod-bubble-owner" title={fullTime(props.message.createdAt)}>
        {props.children}
        {props.last ? <BubbleTail side="right" /> : null}
      </div>
    </>
  )
}
