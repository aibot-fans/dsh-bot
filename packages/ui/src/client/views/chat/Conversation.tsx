import { useEffect, useRef } from 'react'
import { t, type Bot } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { Empty } from '../../components/common.tsx'
import { useNarrow } from '../../components/media.ts'
import { useApp, useNav } from '../../state/app.ts'
import { useChatWidth } from '../../state/chatWidth.ts'
import { useResource } from '../../state/resource.ts'
import { ChatBody, useChatBots } from './ChatBody.tsx'
import { ChatHeader } from './ChatHeader.tsx'
import { PinnedBar } from './PinnedBar.tsx'

/**
 * 中间的对话：顶部是对象（有置顶消息时下面一条置顶条），中间是时间线，底部是输入框；群里不放状态条，状态在群详情里；
 * 宽窄按设置里的“聊天区宽度”。默认打开和主管的单聊（主对话）；任务的状态在左侧列表每一行的右边，主对话右边不放任务栏。
 * 进了任务对话，右边默认打开干活的 bot 或任务群的详情（手机上不自动打开）。
 */
export function Conversation() {
  const app = useApp()
  const nav = useNav()
  const width = useChatWidth()
  const narrow = useNarrow()
  const { data: rooms, loading: roomsLoading } = useResource(app.cache, 'rooms', () => api.rooms())
  const { bots, authors, lead } = useChatBots()
  const leadRoom = (rooms ?? []).find((room) => room.kind === 'direct' && room.botId === lead?.id && room.topic === '')
  const room = (rooms ?? []).find((item) => item.id === nav.roomId) ?? leadRoom ?? rooms?.[0]
  const { data: members } = useResource(app.cache, room === undefined ? null : `members:${room.id}`, () => api.roomInfo(room?.id ?? ''))

  // 记住的对话不在了（删了、清过数据）：回到主管的单聊；连主管单聊都没有就开一个。
  // 列表正在重新拉时先等它拉完：刚建的单聊或群聊还不在旧列表里，不能当成“不在了”。
  useEffect(() => {
    if (rooms === undefined || roomsLoading) return
    if (room !== undefined && room.id !== nav.roomId) app.navigate({ roomId: room.id })
    if (room === undefined && lead !== undefined) app.openBot(lead.id)
  }, [app, rooms, roomsLoading, room?.id, nav.roomId, lead?.id])

  // 换进一个任务对话时打开一次详情；右边已经开着别的、或者你在这个对话里把它收起来了，就不再开。
  const entered = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (room === undefined || entered.current === room.id) return
    entered.current = room.id
    if (narrow || room.taskId === null || app.getNav().panel !== null) return
    app.showRoomDetails(room.id)
  }, [app, room?.id, narrow])

  if (room === undefined) {
    return (
      <main className={`pod-convo pod-width-${width}`}>
        <Empty title={t('正在打开和 Super-agent 的对话…')} />
      </main>
    )
  }
  const memberIds = (members?.members ?? []).map((member) => member.botId)
  const memberBots = memberIds.map((id) => bots.get(id)).filter((bot): bot is Bot => bot !== undefined)
  return (
    <main className={`pod-convo pod-width-${width}`}>
      <ChatHeader room={room} bots={bots} memberIds={memberIds} />
      <PinnedBar room={room} bots={authors} />
      <ChatBody room={room} bots={bots} authors={authors} members={memberBots} lead={lead} />
    </main>
  )
}
