import type { DatabaseSync } from 'node:sqlite'
import { POD, t, type Task } from 'pod-domain'
import { isStanding, taskConversationOf } from 'pod-store'
import type { RoomService } from '../chat/rooms.ts'
import { isTicket } from '../engine/index.ts'

/** 主对话里那一行灰字说的几种状态。 */
export type StatusLine = 'done' | 'waiting' | 'failed' | 'stopped' | 'paused' | 'resumed' | 'dismissed'

const WORDS: Readonly<Record<StatusLine, string>> = {
  done: '「{title}」做完了',
  waiting: '「{title}」在等你',
  failed: '「{title}」没做成',
  stopped: '「{title}」停了',
  paused: '「{title}」暂停了',
  resumed: '「{title}」接着做了',
  dismissed: '「{title}」不用做了',
}

/** 只有你能让它停、让它等：这两种和之后的接着做，不管你在哪说的都写。 */
const YOURS: ReadonlySet<StatusLine | undefined> = new Set<StatusLine | undefined>(['stopped', 'paused'])

/** 按阶段该写哪一行；排队、在做算接着做（前面写过别的才写），等到点、等新消息不写。 */
function lineOf(task: Task): StatusLine | undefined {
  switch (task.ticketStage) {
    case 'ended':
      return task.endReason === 'stopped' ? 'stopped' : task.endReason === 'dismissed' ? 'dismissed' : 'done'
    case 'review':
      return 'done'
    case 'waiting':
    case 'blocked':
      return 'waiting'
    case 'failed':
      return 'failed'
    case 'paused':
      return 'paused'
    case 'queued':
    case 'running':
      return 'resumed'
    default:
      return undefined
  }
}

export interface StatusLinesDeps {
  readonly db: DatabaseSync
  readonly rooms: RoomService
}

/**
 * 状态那一行由系统照实写，Super-agent 不用自己报：交给别的 bot、在自己的对话里干的任务，
 * 做完、等你、没做成、停了、暂停、接着做，在派活的聊天室写一行灰字；和上一行一样就不写。
 * 你在任务对话里接着说的那段，做完、等你、没做成只留在那段对话里（和叫醒前台一样）；停、暂停和之后的接着做都写。
 * 常开任务每次到点不写。
 */
export class StatusLines {
  private readonly deps: StatusLinesDeps

  constructor(deps: StatusLinesDeps) {
    this.deps = deps
  }

  staged(task: Task): void {
    if (!isTicket(task) || task.parentId !== null || task.roomId === null) return
    const conversation = taskConversationOf(this.deps.db, task.id)?.id
    if (conversation === undefined || conversation === task.roomId || isStanding(this.deps.db, task.id)) return
    const line = lineOf(task)
    if (line === undefined) return
    const last = this.last(task.roomId, task.id)
    if (line === last || (line === 'resumed' && last === undefined)) return
    const fromHere = task.replyTo.at(-1)?.roomId !== conversation
    if (!fromHere && !YOURS.has(line) && !(line === 'resumed' && YOURS.has(last))) return
    const room = this.deps.rooms.get(task.roomId)
    if (room === undefined || room.archivedAt !== null) return
    this.deps.rooms.post(room.id, { author: POD, kind: 'notice', body: t(WORDS[line], { title: task.title }), data: { taskId: task.id, statusLine: line } })
  }

  /** 这个任务在这个聊天室最近写的那一行。 */
  private last(roomId: string, taskId: string): StatusLine | undefined {
    const row = this.deps.db
      .prepare(
        "SELECT json_extract(data, '$.statusLine') AS line FROM messages WHERE room_id = ? AND kind = 'notice' AND json_extract(data, '$.taskId') = ? AND json_extract(data, '$.statusLine') IS NOT NULL AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1",
      )
      .get(roomId, taskId) as { readonly line: string } | undefined
    return row === undefined ? undefined : (row.line as StatusLine)
  }
}
