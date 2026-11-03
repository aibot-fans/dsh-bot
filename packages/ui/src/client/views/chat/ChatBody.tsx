import { useEffect, useMemo, useState } from 'react'
import type { Bot, RoomMessage, RoomSummary } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { useSnapshot } from '../../components/taskParts.tsx'
import { isPreparing, useApp, useLive } from '../../state/app.ts'
import { readDraft, saveDraftReply } from '../../state/drafts.ts'
import { useResource } from '../../state/resource.ts'
import { Composer } from './Composer.tsx'
import { Timeline } from './Timeline.tsx'

/**
 * 对话里认得的 bot：bots 是现在在的；authors 还认得交付后收起的临时 bot、进了回收站的 bot，
 * 时间线上它们说过的话也要认得出是谁。
 */
export function useChatBots(): {
  readonly botList: readonly Bot[] | undefined
  readonly bots: ReadonlyMap<string, Bot>
  readonly authors: ReadonlyMap<string, Bot>
  readonly lead: Bot | undefined
} {
  const app = useApp()
  const { data: botList } = useResource(app.cache, 'bots', () => api.bots())
  const { data: recycled } = useResource(app.cache, 'recycle', () => api.recycle())
  const bots = useMemo(() => new Map((botList ?? []).map((bot) => [bot.id, bot])), [botList])
  const authors = useMemo(() => new Map([...(recycled?.bots ?? []), ...(botList ?? [])].map((bot) => [bot.id, bot])), [botList, recycled])
  return { botList, bots, authors, lead: botList?.find((bot) => bot.role === 'lead') }
}

export interface ChatBodyProps {
  readonly room: RoomSummary
  readonly bots: ReadonlyMap<string, Bot>
  readonly authors: ReadonlyMap<string, Bot>
  /** 群成员，@ 的候选。 */
  readonly members: readonly Bot[]
  /** Super-agent：普通群里话先给它。 */
  readonly lead: Bot | undefined
}

/** 话先给谁，输入框的提示写它的名字：单聊里是那个 bot，任务群里是负责的 bot，别的群里是 Super-agent。 */
function useResponder(room: RoomSummary, bots: ReadonlyMap<string, Bot>, lead: Bot | undefined): Bot | undefined {
  const taskGroup = room.kind !== 'direct' && room.taskId !== null
  const { snapshot } = useSnapshot(taskGroup ? (room.taskId ?? '') : '')
  if (room.kind === 'direct') return bots.get(room.botId ?? '')
  const owner = taskGroup ? bots.get(snapshot?.task.ownerBotId ?? '') : undefined
  return owner ?? lead
}

/**
 * 时间线加输入框：中间的对话和右边的任务小窗共用。任务对话里有 bot 在干活时，输入框上面多一行「正在处理」。
 * 引用的消息跟着这个对话的草稿走：换对话、刷新页面回来还在，发出去才清掉。进对话那一刻的已读位置决定显示不显示未读摘要。
 */
export function ChatBody(props: ChatBodyProps) {
  const app = useApp()
  const { room } = props
  const live = useLive(room.id)
  const [reply, setReply] = useState<{ readonly roomId: string; readonly message: RoomMessage | undefined } | undefined>(undefined)
  const replyTo = reply?.roomId === room.id ? reply.message : readDraft(room.id).reply
  const chooseReply = (message: RoomMessage | undefined): void => {
    setReply({ roomId: room.id, message })
    saveDraftReply(room.id, message)
  }
  const responder = useResponder(room, props.bots, props.lead)
  const [readAtOpen, setReadAtOpen] = useState<{ readonly roomId: string; readonly seq: number } | undefined>(undefined)
  /** 你按下发送的时间：时间线据此回到最新。 */
  const [sentAt, setSentAt] = useState(0)
  useEffect(() => {
    if (readAtOpen?.roomId !== room.id) setReadAtOpen({ roomId: room.id, seq: room.readSeq })
  }, [room.id])
  return (
    <>
      <Timeline room={room} bots={props.authors} members={props.members} onReply={chooseReply} readSeqAtOpen={readAtOpen?.roomId === room.id ? readAtOpen.seq : room.readSeq} followAt={sentAt} />
      <Composer
        key={room.id}
        room={room}
        responder={responder}
        members={props.members}
        replyTo={replyTo}
        onClearReply={() => chooseReply(undefined)}
        onSubmit={() => setSentAt(Date.now())}
        onSent={() => app.cache.invalidate('rooms')}
        bots={props.bots}
        replying={live.statuses.some((status) => !isPreparing(status.sessionId))}
      />
    </>
  )
}
