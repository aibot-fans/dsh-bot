/**
 * 侧栏的整理：你建的分组、放进分组的 bot 和群聊、归档起来的条目、收起的分组、拖出来的顺序。
 * 只影响侧栏怎么摆，不改 bot 和群聊本身；置顶用房间自己的 pinned，主管总是置顶、排第一。
 */

import type { Bot } from './bots.ts'
import { isTemporaryRoom, type RoomSummary } from './rooms.ts'
import { isRecord } from './text.ts'

export interface SidebarFolder {
  readonly id: string
  readonly name: string
}

export interface SidebarPrefs {
  readonly folders: readonly SidebarFolder[]
  /** 条目（bot:<id> 或 room:<id>）放在哪个分组。 */
  readonly placement: Readonly<Record<string, string>>
  /** 归档起来、不在主列表里显示的条目。 */
  readonly archived: readonly string[]
  /** 收起的分组 id。 */
  readonly collapsed: readonly string[]
  /** 拖动排出来的顺序：每一栏（置顶、Bot、群聊或分组 id）一串条目。没排过的栏按最近使用排。 */
  readonly order: Readonly<Record<string, readonly string[]>>
}

export const EMPTY_SIDEBAR: SidebarPrefs = { folders: [], placement: {}, archived: [], collapsed: [], order: {} }

/** 侧栏里固定的三栏；分组用自己的 id。 */
export const SIDEBAR_PINNED = 'pinned'
export const SIDEBAR_BOTS = 'bots'
export const SIDEBAR_GROUPS = 'groups'
const FIXED_SECTIONS: readonly string[] = [SIDEBAR_PINNED, SIDEBAR_BOTS, SIDEBAR_GROUPS]
export const FOLDER_NAME_MAX = 12
export const FOLDER_COUNT_MAX = 20

const ITEM_KEY = /^(bot|room):[A-Za-z0-9_-]{1,64}$/
const FOLDER_ID = /^[A-Za-z0-9_-]{1,40}$/

export function botKey(id: string): string {
  return `bot:${id}`
}

export function roomKey(id: string): string {
  return `room:${id}`
}

function stringList(value: unknown, keep: (item: string) => boolean): readonly string[] {
  const items = (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === 'string' && keep(item))
  return [...new Set(items)].slice(0, 1000)
}

/** 收到的侧栏整理：不认识的字段丢掉，分组名截断，指向不存在的分组的放置去掉。 */
export function parseSidebarPrefs(input: unknown): SidebarPrefs {
  if (!isRecord(input)) return EMPTY_SIDEBAR
  const named = (Array.isArray(input.folders) ? input.folders : []).filter(isRecord).map((folder) => ({
    id: typeof folder.id === 'string' ? folder.id : '',
    name: typeof folder.name === 'string' ? [...folder.name.trim()].slice(0, FOLDER_NAME_MAX).join('') : '',
  }))
  const folders = named
    .filter((folder, index) => FOLDER_ID.test(folder.id) && folder.name !== '' && named.findIndex((other) => other.id === folder.id) === index)
    .slice(0, FOLDER_COUNT_MAX)
  const ids = new Set(folders.map((folder) => folder.id))
  const placement = isRecord(input.placement)
    ? Object.fromEntries(Object.entries(input.placement).filter(([key, value]) => ITEM_KEY.test(key) && typeof value === 'string' && ids.has(value)))
    : {}
  const order = isRecord(input.order)
    ? Object.fromEntries(
        Object.entries(input.order)
          .filter(([section]) => FIXED_SECTIONS.includes(section) || ids.has(section))
          .map(([section, keys]) => [section, stringList(keys, (item) => ITEM_KEY.test(item))]),
      )
    : {}
  return {
    folders,
    placement: placement as Readonly<Record<string, string>>,
    archived: stringList(input.archived, (item) => ITEM_KEY.test(item)),
    collapsed: stringList(input.collapsed, (item) => ids.has(item)),
    order,
  }
}

/** 把条目放进某个分组；folderId 为 null 时移出分组。放进分组的条目同时取消归档。 */
export function moveSidebarItem(prefs: SidebarPrefs, key: string, folderId: string | null): SidebarPrefs {
  const placement = Object.fromEntries(Object.entries(prefs.placement).filter(([item]) => item !== key))
  return {
    ...prefs,
    placement: folderId === null ? placement : { ...placement, [key]: folderId },
    archived: prefs.archived.filter((item) => item !== key),
  }
}

export function archiveSidebarItem(prefs: SidebarPrefs, key: string, archived: boolean): SidebarPrefs {
  const rest = prefs.archived.filter((item) => item !== key)
  return { ...prefs, archived: archived ? [...rest, key] : rest }
}

/** 新建分组：名字截到 12 个字；分组已经太多时原样返回。 */
export function addSidebarFolder(prefs: SidebarPrefs, id: string, name: string): SidebarPrefs {
  const clean = [...name.trim()].slice(0, FOLDER_NAME_MAX).join('')
  if (clean === '' || prefs.folders.length >= FOLDER_COUNT_MAX || prefs.folders.some((folder) => folder.id === id)) return prefs
  return { ...prefs, folders: [...prefs.folders, { id, name: clean }] }
}

export function renameSidebarFolder(prefs: SidebarPrefs, id: string, name: string): SidebarPrefs {
  const clean = [...name.trim()].slice(0, FOLDER_NAME_MAX).join('')
  if (clean === '') return prefs
  return { ...prefs, folders: prefs.folders.map((folder) => (folder.id === id ? { ...folder, name: clean } : folder)) }
}

/** 删掉分组：里面的条目回到原来的“Bot”和“群聊”里。 */
export function removeSidebarFolder(prefs: SidebarPrefs, id: string): SidebarPrefs {
  return {
    folders: prefs.folders.filter((folder) => folder.id !== id),
    placement: Object.fromEntries(Object.entries(prefs.placement).filter(([, folder]) => folder !== id)),
    archived: prefs.archived,
    collapsed: prefs.collapsed.filter((folder) => folder !== id),
    order: Object.fromEntries(Object.entries(prefs.order).filter(([section]) => section !== id)),
  }
}

/**
 * 拖动排序：把 key 放进 section，排在 before 前面（before 为 null 时放到最后）。
 * shown 是这一栏现在显示的完整顺序；记下放好以后的顺序，别的栏里的同一条去掉。
 */
export function reorderSidebar(prefs: SidebarPrefs, section: string, shown: readonly string[], key: string, before: string | null): SidebarPrefs {
  const rest = shown.filter((item) => item !== key)
  const found = before === null ? -1 : rest.indexOf(before)
  const at = found < 0 ? rest.length : found
  const next = [...rest.slice(0, at), key, ...rest.slice(at)]
  const others = Object.fromEntries(Object.entries(prefs.order).map(([id, keys]) => [id, keys.filter((item) => item !== key)]))
  return { ...prefs, order: { ...others, [section]: next } }
}

export function toggleSidebarFolder(prefs: SidebarPrefs, id: string): SidebarPrefs {
  return { ...prefs, collapsed: prefs.collapsed.includes(id) ? prefs.collapsed.filter((folder) => folder !== id) : [...prefs.collapsed, id] }
}

/** 侧栏的一条：一个 bot（连着它的单聊）或一个群聊。 */
export interface SidebarItem {
  readonly key: string
  readonly kind: 'bot' | 'group'
  readonly bot: Bot | undefined
  /** bot 最近的那段对话（可能还没有）或群聊本身。 */
  readonly room: RoomSummary | undefined
  /** bot 和你的每一段对话（最近的在前）；群聊就是它自己。未读、置顶、忙不忙都按这些算。 */
  readonly rooms: readonly RoomSummary[]
  readonly recentAt: number
  readonly pinned: boolean
}

export interface SidebarSections {
  readonly pinned: readonly SidebarItem[]
  readonly folders: readonly { readonly folder: SidebarFolder; readonly items: readonly SidebarItem[] }[]
  readonly bots: readonly SidebarItem[]
  readonly groups: readonly SidebarItem[]
  readonly archived: readonly SidebarItem[]
}

function byRecent(left: SidebarItem, right: SidebarItem): number {
  return right.recentAt - left.recentAt
}

/** 一栏的顺序：没拖过的（新来的）在前、按最近使用排，拖过的按你排的顺序跟在后面。 */
function arrange(items: readonly SidebarItem[], order: readonly string[] | undefined): readonly SidebarItem[] {
  if (order === undefined || order.length === 0) return [...items].sort(byRecent)
  const rank = new Map(order.map((key, index) => [key, index]))
  const fresh = items.filter((item) => !rank.has(item.key)).sort(byRecent)
  const placed = items.filter((item) => rank.has(item.key)).sort((left, right) => (rank.get(left.key) ?? 0) - (rank.get(right.key) ?? 0))
  return [...fresh, ...placed]
}

/** 你和一个 bot 的每一段对话（单聊），最近的在前；临时对话和删掉的不算。 */
export function botThreads(botId: string, rooms: readonly RoomSummary[]): readonly RoomSummary[] {
  return rooms
    .filter((room) => room.kind === 'direct' && room.botId === botId && room.archivedAt === null && !isTemporaryRoom(room))
    .sort((left, right) => (right.lastMessageAt ?? right.createdAt) - (left.lastMessageAt ?? left.createdAt))
}

/** bot 最近的那段对话：点侧栏里的 bot 回到这里。 */
export function primaryRoom(botId: string, rooms: readonly RoomSummary[]): RoomSummary | undefined {
  return botThreads(botId, rooms)[0]
}

/**
 * 侧栏分区：归档的单独一栏（侧栏里不显示，在设置里看）；置顶的在最上面，主管总在置顶的第一个，
 * 不能取消置顶、归档或放进分组；放进分组的进分组；其余按 bot 和群聊分开。
 * 每一栏按你拖出来的顺序，没拖过的按最近使用排，不显示时间。
 */
export function sidebarSections(bots: readonly Bot[], rooms: readonly RoomSummary[], prefs: SidebarPrefs): SidebarSections {
  const botItems: readonly SidebarItem[] = bots
    .filter((bot) => bot.archivedAt === null)
    .map((bot): SidebarItem => {
      const threads = botThreads(bot.id, rooms)
      const room = threads[0]
      const pinned = bot.role === 'lead' || threads.some((thread) => thread.pinned)
      return { key: botKey(bot.id), kind: 'bot', bot, room, rooms: threads, recentAt: room?.lastMessageAt ?? room?.createdAt ?? bot.createdAt, pinned }
    })
  const groupItems: readonly SidebarItem[] = rooms
    .filter((room) => room.kind !== 'direct' && room.archivedAt === null)
    .map((room): SidebarItem => ({ key: roomKey(room.id), kind: 'group', bot: undefined, room, rooms: [room], recentAt: room.lastMessageAt ?? room.createdAt, pinned: room.pinned }))
  const isLead = (item: SidebarItem): boolean => item.bot?.role === 'lead'
  const archived = new Set(prefs.archived)
  const all = [...botItems, ...groupItems]
  const open = all.filter((item) => isLead(item) || !archived.has(item.key))
  const loose = open.filter((item) => !item.pinned && prefs.placement[item.key] === undefined)
  const pinned = open.filter((item) => item.pinned)
  return {
    pinned: [...pinned.filter(isLead), ...arrange(pinned.filter((item) => !isLead(item)), prefs.order[SIDEBAR_PINNED])],
    folders: prefs.folders.map((folder) => ({ folder, items: arrange(open.filter((item) => !item.pinned && prefs.placement[item.key] === folder.id), prefs.order[folder.id]) })),
    bots: arrange(loose.filter((item) => item.kind === 'bot'), prefs.order[SIDEBAR_BOTS]),
    groups: arrange(loose.filter((item) => item.kind === 'group'), prefs.order[SIDEBAR_GROUPS]),
    archived: all.filter((item) => !isLead(item) && archived.has(item.key)).sort(byRecent),
  }
}
