import type { RoomSummary, TaskSnapshot } from 'pod-domain'
import { bucketOf, isMoving } from '../../components/TaskEntry.tsx'

/** 侧栏一行右边的状态：等你（红点）、没做成（红叉）、在做（转圈）、做完了还没点开看（绿勾）。 */
export type SideStatus = 'waiting' | 'failed' | 'working' | 'done'

/** 同时有几件时，越靠前越要紧：等你的优先，其次没做成的，再其次在做的，最后是做完没看的。 */
const URGENCY: readonly SideStatus[] = ['waiting', 'failed', 'working', 'done']

export function mostUrgent(statuses: readonly SideStatus[]): SideStatus | null {
  return URGENCY.find((status) => statuses.includes(status)) ?? null
}

/** 一个任务给它那段对话带来的状态；做完的只在那段对话里还有没看的消息时算，点开看过就没了。 */
function taskStatus(snapshot: TaskSnapshot, unseen: boolean): SideStatus | null {
  switch (snapshot.stage) {
    case 'waiting':
    case 'review':
    case 'blocked':
    case 'undelivered':
      return 'waiting'
    case 'failed':
      return 'failed'
    default:
      if (isMoving(snapshot)) return 'working'
      return unseen && bucketOf(snapshot) === 'done' ? 'done' : null
  }
}

/**
 * 每段对话最要紧的状态（没有状态的不在表里）。任务算在它自己的对话上（另开的单聊、任务群），在原来的对话里干的算在那里；
 * 那段对话里有等你处理的事算等你，有任务在跑、bot 正在回话算在做。正开着的那段没有没看的消息。
 */
export function roomStatuses(rooms: readonly RoomSummary[], snapshots: readonly TaskSnapshot[], live: ReadonlySet<string>, openRoomId: string | null): ReadonlyMap<string, SideStatus> {
  const unseen = new Set(rooms.filter((room) => room.unread > 0 && room.id !== openRoomId).map((room) => room.id))
  const fromRooms = rooms.flatMap((room): (readonly [string, SideStatus])[] => [
    ...(room.waits > 0 ? [[room.id, 'waiting'] as const] : []),
    ...((room.running ?? 0) > 0 || room.busy || live.has(room.id) ? [[room.id, 'working'] as const] : []),
  ])
  const fromTasks = snapshots.flatMap((snapshot): (readonly [string, SideStatus])[] => {
    const roomId = snapshot.conversationId ?? snapshot.task.roomId
    const status = roomId === null ? null : taskStatus(snapshot, unseen.has(roomId))
    return roomId === null || status === null ? [] : [[roomId, status]]
  })
  const pairs = [...fromRooms, ...fromTasks]
  const ids = [...new Set(pairs.map(([roomId]) => roomId))]
  return new Map(
    ids.flatMap((roomId) => {
      const status = mostUrgent(pairs.filter(([id]) => id === roomId).map(([, value]) => value))
      return status === null ? [] : [[roomId, status] as const]
    }),
  )
}
