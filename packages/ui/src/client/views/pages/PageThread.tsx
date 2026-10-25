import { useEffect, useRef, useState } from 'react'
import { MESSAGE_MAX, OWNER, type Bot, type Page, type RoomMessage } from 'pod-domain'
import { errorText } from '../../api/http.ts'
import { pageApi } from '../../api/pages.ts'
import { Avatar, Button, clock } from '../../components/common.tsx'
import { Markdown } from '../../components/Markdown.tsx'
import { useApp, useLive } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

function ThreadItem(props: { readonly message: RoomMessage; readonly bots: ReadonlyMap<string, Bot> }) {
  const { message } = props
  if (message.author === OWNER && message.kind === 'text') {
    return (
      <div className="pod-thread-owner">
        <div className="pod-bubble">{message.body}</div>
      </div>
    )
  }
  if (message.kind === 'page' || message.kind === 'milestone') {
    const note = typeof message.data.note === 'string' && message.data.note !== '' && message.data.note !== '第一版' ? `：${message.data.note}` : ''
    return (
      <div className="pod-thread-line">
        <span>{message.kind === 'page' ? `存成了第 ${String(message.data.version ?? '')} 版${note}` : message.body}</span>
        <time>{clock(message.createdAt)}</time>
      </div>
    )
  }
  const bot = props.bots.get(message.author)
  return (
    <div className="pod-thread-bot">
      <Avatar bot={bot} size={22} />
      <div className="pod-thread-bot-main">
        <Markdown text={message.body} />
      </div>
    </div>
  )
}

/**
 * 页面旁边的修改对话：只显示带这个页面 id 的消息，是对话里关于这个页面的一条线。
 * 你的要求以你的名义发进页面所在的对话，只交给做页面的 bot；它存了新版，左边的页面自动刷新。
 */
export function PageThread(props: { readonly page: Page; readonly bots: ReadonlyMap<string, Bot>; readonly disabled: boolean }) {
  const app = useApp()
  const { page } = props
  const key = `page-thread:${page.id}`
  const { data: messages, error } = useResource(app.cache, key, () => pageApi.thread(page.id))
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const end = useRef<HTMLDivElement>(null)
  const list = messages ?? []
  const roomId = [...list].reverse().find((message) => message.author === OWNER)?.roomId ?? page.roomId
  const live = useLive(roomId)
  const maker = props.bots.get(page.botId)
  const handler = maker !== undefined && maker.archivedAt === null ? maker : [...props.bots.values()].find((bot) => bot.role === 'lead')
  const working = live.statuses.some((status) => status.botId === handler?.id)
  const stream = live.streams.find((item) => item.botId === handler?.id)

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [list.length, stream?.text.length, working])

  const send = (): void => {
    const clean = text.trim()
    if (clean === '' || busy) return
    setBusy(true)
    setProblem(undefined)
    pageApi
      .edit(page.id, clean)
      .then((message) => {
        setText('')
        app.cache.update<readonly RoomMessage[]>(key, (current) => [...(current ?? []), message])
        app.cache.invalidate('rooms')
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="pod-thread">
      <div className="pod-thread-list">
        {error === undefined ? null : <p className="pod-form-error">{error}</p>}
        {messages !== undefined && list.length === 0 ? (
          <div className="pod-thread-empty">
            <strong>想怎么改，直接说</strong>
            <span>比如“折线图换成柱状图”“标题短一点”“加一页总结”。{handler?.name ?? 'bot'}会读当前内容，改好存成新的一版，旧版本随时能恢复。</span>
          </div>
        ) : null}
        {list.map((message) => (
          <ThreadItem key={message.id} message={message} bots={props.bots} />
        ))}
        {working ? (
          <div className="pod-thread-bot pod-thread-live">
            <Avatar bot={handler} size={22} />
            <div className="pod-thread-bot-main">{stream === undefined || stream.text === '' ? <span className="pod-muted-inline">{handler?.name ?? 'bot'}正在改…</span> : <Markdown text={stream.text} />}</div>
          </div>
        ) : null}
        <div ref={end} />
      </div>
      <div className="pod-thread-compose">
        {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
        <textarea
          className="pod-textarea"
          rows={3}
          value={text}
          maxLength={MESSAGE_MAX}
          disabled={props.disabled}
          placeholder={props.disabled ? '页面在回收站里，恢复后才能改' : `告诉${handler?.name ?? 'bot'}想怎么改（回车发送，Shift+回车换行）`}
          aria-label="修改要求"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
        />
        <div className="pod-row">
          <span className="pod-hint pod-grow">只发给{handler?.name ?? '做页面的 bot'}，群里其他成员不会被打扰</span>
          <Button small kind="primary" icon="send" disabled={props.disabled || busy || text.trim() === ''} onClick={send}>
            发送
          </Button>
        </div>
      </div>
    </div>
  )
}
