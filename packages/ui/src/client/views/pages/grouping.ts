import { PAGE_KIND_LABELS, t, type Bot, type Page, type PageKind, type RoomSummary } from 'pod-domain'

/** 页面库里的一组：群聊里做的归到那个群，其余（单聊、任务里做的）归到做它的 bot。 */
export interface PageGroup {
  readonly key: string
  readonly label: string
  readonly room: RoomSummary | undefined
  readonly bot: Bot | undefined
  readonly pages: readonly Page[]
}

export interface PageFilter {
  readonly query: string
  readonly kind: PageKind | 'all'
}

const newest = (left: Page, right: Page): number => right.updatedAt - left.updatedAt

export function matches(page: Page, filter: PageFilter): boolean {
  if (filter.kind !== 'all' && page.kind !== filter.kind) return false
  const query = filter.query.trim().toLowerCase()
  return query === '' || page.title.toLowerCase().includes(query) || t(PAGE_KIND_LABELS[page.kind]).includes(query)
}

function groupKey(page: Page, rooms: ReadonlyMap<string, RoomSummary>): string {
  const room = page.roomId === null ? undefined : rooms.get(page.roomId)
  return room !== undefined && room.kind !== 'direct' ? `room:${room.id}` : `bot:${page.botId}`
}

/** 当前对话对应的那一组：群聊是这个群，单聊是这个 bot。 */
export function currentGroupKey(room: RoomSummary | undefined): string | undefined {
  if (room === undefined) return undefined
  if (room.kind !== 'direct') return `room:${room.id}`
  return room.botId === null ? undefined : `bot:${room.botId}`
}

/**
 * 置顶的单独放在最前；其余按组排，组里按更新时间。组的顺序：当前对话那一组在前，其余按最近更新。
 */
export function groupPages(
  pages: readonly Page[],
  rooms: readonly RoomSummary[],
  bots: ReadonlyMap<string, Bot>,
  current: string | undefined,
): { readonly pinned: readonly Page[]; readonly groups: readonly PageGroup[] } {
  const roomMap = new Map(rooms.map((room) => [room.id, room]))
  const pinned = pages.filter((page) => page.pinned).sort(newest)
  const buckets = new Map<string, readonly Page[]>()
  for (const page of pages.filter((item) => !item.pinned)) {
    const key = groupKey(page, roomMap)
    buckets.set(key, [...(buckets.get(key) ?? []), page])
  }
  const groups = [...buckets.entries()].map(([key, members]): PageGroup => {
    const sorted = [...members].sort(newest)
    const room = key.startsWith('room:') ? roomMap.get(key.slice(5)) : undefined
    const bot = key.startsWith('bot:') ? bots.get(key.slice(4)) : undefined
    const label = room !== undefined ? room.title : (bot?.name ?? t('已删除的 bot'))
    return { key, label, room, bot, pages: sorted }
  })
  const rank = (group: PageGroup): number => (group.key === current ? Number.POSITIVE_INFINITY : (group.pages[0]?.updatedAt ?? 0))
  return { pinned, groups: [...groups].sort((left, right) => rank(right) - rank(left)) }
}
