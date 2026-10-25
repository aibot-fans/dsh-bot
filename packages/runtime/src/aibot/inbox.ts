import type { DatabaseSync } from 'node:sqlite'
import { POD } from 'pod-domain'
import { readState, writeState } from 'pod-store'
import type { BotService } from '../bots/service.ts'
import type { RoomService } from '../chat/rooms.ts'
import type { NotificationService } from '../notify/service.ts'
import { eventBody, eventNotice, parseEvent, type XEvent } from './events.ts'
import { xBot, xRoom } from './seed.ts'

const STREAM_KEY = 'aibot.stream'
const RECENT_IDS = 500
/** 补拉最多翻 10 页（每页 100 条）。 */
const MAX_PAGES = 10

interface StreamRecord {
  /** 最后一条事件的 detectedAt：补拉从这里开始。 */
  readonly since: string
  /** 最近处理过的事件 id，补拉和实时推送重复时去重。 */
  readonly ids: readonly string[]
}

export interface InboxDeps {
  readonly db: DatabaseSync
  readonly bots: BotService
  readonly rooms: RoomService
  readonly notifications: NotificationService
  readonly now: () => number
  /** 按 since 和 cursor 拉一页漏掉的事件（从新到旧）。 */
  readonly page: (since: string, cursor: string | undefined) => Promise<{ readonly events: readonly unknown[]; readonly next: string | undefined }>
}

/** X 监控事件的去处：按 id 去重，发进「X 监控」群聊、发通知；记下最后一条的时间，断线后从这里补拉。 */
export class XInbox {
  private readonly deps: InboxDeps

  constructor(deps: InboxDeps) {
    this.deps = deps
  }

  private record(): StreamRecord {
    return readState<StreamRecord>(this.deps.db, STREAM_KEY, { since: '', ids: [] })
  }

  /** 连上以后补拉漏掉的：从最后一条的 detectedAt 开始翻页，翻完从旧到新处理。第一次连上不补历史。 */
  async backfill(): Promise<void> {
    const record = this.record()
    if (record.since === '') {
      writeState(this.deps.db, STREAM_KEY, { since: new Date(this.deps.now()).toISOString(), ids: record.ids })
      return
    }
    const pages = async (cursor: string | undefined, found: readonly unknown[], left: number): Promise<readonly unknown[]> => {
      const page = await this.deps.page(record.since, cursor)
      const all = [...found, ...page.events]
      return page.next === undefined || left <= 1 ? all : pages(page.next, all, left - 1)
    }
    const events = await pages(undefined, [], MAX_PAGES)
    this.receive([...events].reverse(), false)
  }

  /** 处理一批事件（已经按从旧到新排好）：按 id 去重，发进「X 监控」群，发通知。 */
  receive(raws: readonly unknown[], live: boolean): void {
    const record = this.record()
    const seen = new Set(record.ids)
    const fresh = raws.map(parseEvent).filter((event): event is XEvent => event !== undefined && !seen.has(event.id))
    const unique = fresh.filter((event, index) => fresh.findIndex((other) => other.id === event.id) === index)
    if (unique.length === 0) return
    const { db, bots, rooms, notifications } = this.deps
    const room = xRoom(db, bots, rooms)
    const author = xBot(db, bots)?.id ?? POD
    for (const event of unique) {
      if (room !== undefined) rooms.post(room.id, { author, kind: 'text', body: eventBody(event.view), data: { xEvent: event.view } })
    }
    const last = unique.reduce((latest, event) => (event.detectedAt > latest ? event.detectedAt : latest), record.since)
    writeState(db, STREAM_KEY, { since: last, ids: [...record.ids, ...unique.map((event) => event.id)].slice(-RECENT_IDS) })
    const first = unique[0]
    if (live && unique.length === 1 && first !== undefined) {
      const notice = eventNotice(first.view)
      notifications.notify({ kind: 'system', title: notice.title, body: notice.body, roomId: room?.id ?? null })
    } else {
      notifications.notify({ kind: 'system', title: `X 监控：${live ? '' : '断线期间'}有 ${unique.length} 条新动态`, body: unique.slice(0, 3).map((event) => event.view.title).join('\n'), roomId: room?.id ?? null })
    }
  }
}
