import type { ReactNode } from 'react'
import { OWNER, POD, oneLine, t, type Bot, type RoomMessage } from 'pod-domain'
import { Avatar, nameColor } from '../../components/common.tsx'
import { BubbleTail } from './BubbleTail.tsx'
import { fullTime } from './bubbles.ts'
import { useOpenBot } from './openBot.ts'

/** 引用里最多放这么多字（显示时最多两行）。 */
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

/** bot 的话上面的引用：一个带边框的小框，左边那一列是原话那人的小头像（你的是一个“你”字）。 */
function QuotePill(props: { readonly quoted: RoomMessage; readonly bots: ReadonlyMap<string, Bot> }) {
  const { quoted } = props
  const text = quoteText(quoted)
  return (
    <div className="pod-quote-pill" title={t('{name}：{text}', { name: authorName(quoted.author, props.bots), text })}>
      <span className="pod-quote-who" aria-hidden>
        {quoted.author === OWNER ? <span className="pod-you-avatar">{t('你')}</span> : <Avatar bot={props.bots.get(quoted.author)} size={16} />}
      </span>
      <span className="pod-quote-text">{text}</span>
    </div>
  )
}

/**
 * bot 的一条：几个人说话的对话里，一组话的第一条上面写名字；回的话不在旁边时上面引一小段；
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
      {props.quoted === undefined ? null : <QuotePill quoted={props.quoted} bots={props.bots} />}
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

/** 你的一条：靠右的蓝气泡，一组的最后一条带尾巴；回的话不在旁边时，上面一条左边框的小块引着原话。 */
export function OwnerBubble(props: { readonly message: RoomMessage; readonly bots: ReadonlyMap<string, Bot>; readonly last: boolean; readonly quoted: RoomMessage | undefined; readonly children: ReactNode }) {
  const { quoted } = props
  return (
    <>
      {quoted === undefined ? null : (
        <div className="pod-quote-owner" title={t('{name}：{text}', { name: authorName(quoted.author, props.bots), text: quoteText(quoted) })}>
          {quoteText(quoted)}
        </div>
      )}
      <div className="pod-bubble pod-bubble-owner" title={fullTime(props.message.createdAt)}>
        {props.children}
        {props.last ? <BubbleTail side="right" /> : null}
      </div>
    </>
  )
}
