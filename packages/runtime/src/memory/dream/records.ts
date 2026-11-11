import type { DatabaseSync } from 'node:sqlite'
import { OWNER, POD, truncate, type Room, type RoomMessage } from 'pod-domain'
import { listMessages, listRooms, readState } from 'pod-store'
import type { DreamRecord, Mark, RecordLine } from './types.ts'

/** 第一次整理只回看最近这么久的对话。 */
const FIRST_LOOKBACK_MS = 30 * 86_400_000
/** 一个聊天室一次最多往后读多少条消息；剩下的下次接着读。 */
const ROOM_BATCH = 400
/** 一份记录最多多少句、多少字：再长就拆成几份。 */
const RECORD_LINES = 60
const RECORD_CHARS = 9000
/** 你的话尽量留全；别人的话只是上下文，截短。 */
const OWNER_TEXT_MAX = 1200
const OTHER_TEXT_MAX = 320

export interface RecordDeps {
  readonly db: DatabaseSync
  readonly now: () => number
  readonly botName: (id: string) => string | undefined
}

/** 这个聊天室读到了第几条消息。 */
export function chatMark(roomId: string): string {
  return `memory.dream.read.${roomId}`
}

function startOf(deps: RecordDeps, room: Room): number {
  const saved = readState<number>(deps.db, chatMark(room.id), -1)
  if (saved >= 0) return saved
  const row = deps.db.prepare('SELECT MIN(seq) AS seq FROM messages WHERE room_id = ? AND created_at >= ?').get(room.id, deps.now() - FIRST_LOOKBACK_MS) as
    | { readonly seq: number | null }
    | undefined
  return row === undefined || row.seq === null ? room.lastSeq : row.seq - 1
}

export function flat(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function chatRecord(deps: RecordDeps, room: Room, messages: readonly RoomMessage[], mark: number): DreamRecord {
  const direct = room.kind === 'direct'
  const lines: readonly RecordLine[] = messages.map((message, index) => {
    const owner = message.author === OWNER
    return {
      at: `m${index + 1}`,
      ref: `message:${message.id}`,
      by: owner ? 'owner' : 'bot',
      name: owner ? '用户' : (deps.botName(message.author) ?? 'bot'),
      botId: owner ? null : message.author,
      text: truncate(flat(message.body), owner ? OWNER_TEXT_MAX : OTHER_TEXT_MAX),
    }
  })
  const first = messages[0]?.seq ?? 0
  const last = messages.at(-1)?.seq ?? 0
  return {
    id: `chat:${room.id}:${first}-${last}`,
    kind: 'chat',
    title: direct ? `和「${deps.botName(room.botId ?? '') ?? 'bot'}」的单聊` : `群「${room.title}」`,
    time: messages.at(-1)?.createdAt ?? deps.now(),
    roomId: direct ? null : room.id,
    botId: direct ? room.botId : null,
    tainted: false,
    lines,
    marks: [{ key: chatMark(room.id), value: mark }],
  }
}

/**
 * 挑对话：上次整理之后你说过话的聊天室，每个从自己的水位往后读。无痕的不读。
 * 只留你的话，和它前面两句、后面一句当上下文；太长的拆成几份。按时间从早到晚，最多 limit 份，剩下的下次读。
 * skipped 是这次看过、没有你的话的那些聊天室：水位照样往前推。
 */
export function chatRecords(deps: RecordDeps, limit: number): { readonly records: readonly DreamRecord[]; readonly skipped: readonly Mark[] } {
  const records: DreamRecord[] = []
  const skipped: Mark[] = []
  for (const room of listRooms(deps.db, { archived: false })) {
    if (room.incognito) continue
    const since = startOf(deps, room)
    if (room.lastSeq <= since) continue
    const page = listMessages(deps.db, room.id, { after: since, limit: ROOM_BATCH })
    const end = page.at(-1)?.seq ?? room.lastSeq
    const spoken = page.filter((message) => message.kind === 'text' && message.author !== POD && message.body.trim() !== '')
    const keep = new Set<number>()
    spoken.forEach((message, index) => {
      if (message.author !== OWNER) return
      for (const near of [index - 2, index - 1, index, index + 1]) if (near >= 0 && near < spoken.length) keep.add(near)
    })
    const kept = spoken.filter((_, index) => keep.has(index))
    if (kept.length === 0) {
      skipped.push({ key: chatMark(room.id), value: end })
      continue
    }
    let chunk: RoomMessage[] = []
    let size = 0
    for (const message of kept) {
      const length = Math.min(message.body.length, message.author === OWNER ? OWNER_TEXT_MAX : OTHER_TEXT_MAX)
      if (chunk.length > 0 && (chunk.length >= RECORD_LINES || size + length > RECORD_CHARS)) {
        records.push(chatRecord(deps, room, chunk, chunk.at(-1)?.seq ?? since))
        chunk = []
        size = 0
      }
      chunk = [...chunk, message]
      size += length
    }
    if (chunk.length > 0) records.push(chatRecord(deps, room, chunk, end))
  }
  const ordered = [...records].sort((left, right) => left.time - right.time)
  return { records: ordered.slice(0, limit), skipped }
}

/** 一份记录排成给模型看的文字：每句前面是编号和说话的人。 */
export function recordText(record: DreamRecord): string {
  return record.lines.map((line) => `[${line.at}] ${line.name}：${line.text}`).join('\n')
}
