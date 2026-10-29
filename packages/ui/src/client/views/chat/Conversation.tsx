import { useEffect, useMemo, useState } from 'react'
import { t, type Bot, type RoomMessage } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { Empty } from '../../components/common.tsx'
import { isPreparing, useApp, useLive, useNav } from '../../state/app.ts'
import { readDraft, saveDraftReply } from '../../state/drafts.ts'
import { useResource } from '../../state/resource.ts'
import { ChatHeader } from './ChatHeader.tsx'
import { Composer } from './Composer.tsx'
import { PinnedBar } from './PinnedBar.tsx'
import { Timeline } from './Timeline.tsx'

/** 中间的对话：顶部是对象和用量（有置顶消息时下面一条置顶条），中间是时间线，底部是输入框。默认打开和主管的单聊。 */
export function Conversation() {
  const app = useApp()
  const nav = useNav()
  const { data: rooms, loading: roomsLoading } = useResource(app.cache, 'rooms', () => api.rooms())
  const { data: botList } = useResource(app.cache, 'bots', () => api.bots())
  const bots = useMemo(() => new Map((botList ?? []).map((bot) => [bot.id, bot])), [botList])
  // 时间线上的名字和头像：交付后收起的临时 bot、进了回收站的 bot，说过的话也要认得出是谁。
  const { data: recycled } = useResource(app.cache, 'recycle', () => api.recycle())
  const authors = useMemo(() => new Map([...(recycled?.bots ?? []), ...(botList ?? [])].map((bot) => [bot.id, bot])), [botList, recycled])
  const lead = (botList ?? []).find((bot) => bot.role === 'lead')
  const leadRoom = (rooms ?? []).find((room) => room.kind === 'direct' && room.botId === lead?.id && room.topic === '')
  const room = (rooms ?? []).find((item) => item.id === nav.roomId) ?? leadRoom ?? rooms?.[0]
  const { data: members } = useResource(app.cache, room === undefined ? null : `members:${room.id}`, () => api.roomInfo(room?.id ?? ''))
  const live = useLive(room?.id ?? null)
  // 引用的消息跟着这个对话的草稿走：换对话、刷新页面回来还在，发出去才清掉。
  const [reply, setReply] = useState<{ readonly roomId: string; readonly message: RoomMessage | undefined } | undefined>(undefined)
  const replyTo = room === undefined ? undefined : reply?.roomId === room.id ? reply.message : readDraft(room.id).reply
  const chooseReply = (message: RoomMessage | undefined): void => {
    if (room === undefined) return
    setReply({ roomId: room.id, message })
    saveDraftReply(room.id, message)
  }
  const [readAtOpen, setReadAtOpen] = useState<{ readonly roomId: string; readonly seq: number } | undefined>(undefined)
  /** 你按下发送的时间：时间线据此回到最新。 */
  const [sentAt, setSentAt] = useState(0)

  // 记住的对话不在了（删了、清过数据）：回到主管的单聊；连主管单聊都没有就开一个。
  // 列表正在重新拉时先等它拉完：刚建的单聊或群聊还不在旧列表里，不能当成“不在了”。
  useEffect(() => {
    if (rooms === undefined || roomsLoading) return
    if (room !== undefined && room.id !== nav.roomId) app.navigate({ roomId: room.id })
    if (room === undefined && lead !== undefined) app.openBot(lead.id)
  }, [app, rooms, roomsLoading, room?.id, nav.roomId, lead?.id])
  useEffect(() => {
    if (room !== undefined && readAtOpen?.roomId !== room.id) setReadAtOpen({ roomId: room.id, seq: room.readSeq })
  }, [room?.id])

  if (room === undefined) {
    return (
      <main className="pod-convo">
        <Empty title={t('正在打开和主管的对话…')} />
      </main>
    )
  }
  const memberIds = (members?.members ?? []).map((member) => member.botId)
  const memberBots = memberIds.map((id) => bots.get(id)).filter((bot): bot is Bot => bot !== undefined)
  const responder = room.kind === 'direct' ? bots.get(room.botId ?? '') : lead
  return (
    <main className="pod-convo">
      <ChatHeader room={room} bots={bots} memberIds={memberIds} />
      <PinnedBar room={room} bots={authors} />
      <Timeline room={room} bots={authors} members={memberBots} onReply={chooseReply} readSeqAtOpen={readAtOpen?.roomId === room.id ? readAtOpen.seq : room.readSeq} followAt={sentAt} />
      <Composer
        key={room.id}
        room={room}
        responder={responder}
        members={memberBots}
        replyTo={replyTo}
        onClearReply={() => chooseReply(undefined)}
        onSubmit={() => setSentAt(Date.now())}
        onSent={() => app.cache.invalidate('rooms')}
        bots={bots}
        replying={live.statuses.some((status) => !isPreparing(status.sessionId))}
      />
    </main>
  )
}
