import { useEffect, useMemo, useRef, useState } from 'react'
import type { Bot, RoomMessage } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { Empty } from '../../components/common.tsx'
import { useApp, useLive, useNav } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { ChatHeader } from './ChatHeader.tsx'
import { Composer } from './Composer.tsx'
import { Timeline } from './Timeline.tsx'

/** 中间的对话：顶部是对象和用量，中间是时间线，底部是输入框。默认打开和主管的单聊。 */
export function Conversation() {
  const app = useApp()
  const nav = useNav()
  const { data: rooms, loading: roomsLoading } = useResource(app.cache, 'rooms', () => api.rooms())
  const { data: botList } = useResource(app.cache, 'bots', () => api.bots())
  const bots = useMemo(() => new Map((botList ?? []).map((bot) => [bot.id, bot])), [botList])
  const lead = (botList ?? []).find((bot) => bot.role === 'lead')
  const leadRoom = (rooms ?? []).find((room) => room.kind === 'direct' && room.botId === lead?.id && room.topic === '')
  const room = (rooms ?? []).find((item) => item.id === nav.roomId) ?? leadRoom ?? rooms?.[0]
  const { data: members } = useResource(app.cache, room === undefined ? null : `members:${room.id}`, () => api.roomInfo(room?.id ?? ''))
  const live = useLive(room?.id ?? null)
  const [replyTo, setReplyTo] = useState<RoomMessage | undefined>(undefined)
  const [readAtOpen, setReadAtOpen] = useState<{ readonly roomId: string; readonly seq: number } | undefined>(undefined)

  // 记住的对话不在了（删了、清过数据）：回到主管的单聊；连主管单聊都没有就开一个。
  // 列表正在重新拉时先等它拉完：刚建的单聊或群聊还不在旧列表里，不能当成“不在了”。
  useEffect(() => {
    if (rooms === undefined || roomsLoading) return
    if (room !== undefined && room.id !== nav.roomId) app.navigate({ roomId: room.id })
    if (room === undefined && lead !== undefined) app.openBot(lead.id)
  }, [app, rooms, roomsLoading, room?.id, nav.roomId, lead?.id])
  // 打开页面时清掉上次没正常离开的临时对话。
  const swept = useRef(false)
  useEffect(() => {
    if (rooms === undefined || swept.current) return
    swept.current = true
    app.sweepTemporary(rooms)
  }, [app, rooms])
  useEffect(() => {
    setReplyTo(undefined)
    if (room !== undefined && readAtOpen?.roomId !== room.id) setReadAtOpen({ roomId: room.id, seq: room.readSeq })
  }, [room?.id])

  if (room === undefined) {
    return (
      <main className="pod-convo">
        <Empty title="正在打开和主管的对话…" />
      </main>
    )
  }
  const memberIds = (members?.members ?? []).map((member) => member.botId)
  const memberBots = memberIds.map((id) => bots.get(id)).filter((bot): bot is Bot => bot !== undefined)
  const responder = room.kind === 'direct' ? bots.get(room.botId ?? '') : lead
  return (
    <main className="pod-convo">
      <ChatHeader room={room} bots={bots} memberIds={memberIds} />
      <Timeline room={room} bots={bots} members={memberBots} onReply={setReplyTo} readSeqAtOpen={readAtOpen?.roomId === room.id ? readAtOpen.seq : room.readSeq} />
      <Composer
        room={room}
        responder={responder}
        members={memberBots}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(undefined)}
        onSent={() => app.cache.invalidate('rooms')}
        bots={bots}
        replying={live.statuses.length > 0}
      />
    </main>
  )
}
