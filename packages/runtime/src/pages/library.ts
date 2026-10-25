import type { DatabaseSync } from 'node:sqlite'
import { MESSAGE_MAX, PAGE_KIND_LABELS, PAGE_TITLE_MAX, charLength, fail, ok, readBool, readId, readInt, readString, truncate, type Bot, type Page, type PageVersionInfo, type PodResult, type Room, type RoomMessage } from 'pod-domain'
import { listPageMessages, listPageVersions, listPages } from 'pod-store'
import type { BotService } from '../bots/service.ts'
import type { RoomService } from '../chat/rooms.ts'
import type { PageService } from './service.ts'

export interface PageLibraryDeps {
  readonly db: DatabaseSync
  readonly pages: PageService
  readonly bots: BotService
  readonly rooms: RoomService
  readonly now: () => number
}

/** 页面库给界面用的操作：列表、回收站、版本、置顶、改名、删除恢复、回滚，以及页面旁边的修改对话。 */
export class PageLibrary {
  private readonly deps: PageLibraryDeps

  constructor(deps: PageLibraryDeps) {
    this.deps = deps
  }

  private page(input: unknown): PodResult<Page> {
    const id = readId(input, 'id')
    if (id === undefined) return fail('invalid-input', '缺少页面 id')
    const page = this.deps.pages.get(id)
    return page === undefined ? fail('not-found', '找不到这个页面') : ok(page)
  }

  private live(input: unknown): PodResult<Page> {
    const found = this.page(input)
    if (found.ok && found.value.deletedAt !== null) return fail('conflict', '页面在回收站里，先恢复')
    return found
  }

  /** 在用的页面（置顶的在前，然后按更新时间）；q 按标题和种类筛。 */
  list(input: unknown): PodResult<{ readonly pages: readonly Page[] }> {
    const query = readString(input, 'q').toLowerCase()
    const pages = listPages(this.deps.db, { deleted: false })
    return ok({ pages: query === '' ? pages : pages.filter((page) => page.title.toLowerCase().includes(query) || PAGE_KIND_LABELS[page.kind].includes(query)) })
  }

  trash(): PodResult<{ readonly pages: readonly Page[] }> {
    return ok({ pages: listPages(this.deps.db, { deleted: true }) })
  }

  /** 页面和它的版本列表（新的在前）。 */
  detail(input: unknown): PodResult<{ readonly page: Page; readonly versions: readonly PageVersionInfo[] }> {
    const found = this.page(input)
    if (!found.ok) return found
    return ok({ page: found.value, versions: listPageVersions(this.deps.db, found.value.id) })
  }

  pin(input: unknown): PodResult<Page> {
    const found = this.live(input)
    if (!found.ok) return found
    return ok(this.deps.pages.patch(found.value, { pinned: readBool(input, 'pinned') ?? !found.value.pinned }))
  }

  /** 改名也存成一版，版本列表里看得到。 */
  rename(input: unknown): PodResult<Page> {
    const found = this.live(input)
    if (!found.ok) return found
    const page = found.value
    const title = truncate(readString(input, 'title'), PAGE_TITLE_MAX)
    if (title === '') return fail('invalid-input', '标题不能为空')
    if (title === page.title) return ok(page)
    const current = this.deps.pages.version(page)
    if (current === undefined) return fail('not-found', '找不到页面内容')
    return ok(this.deps.pages.appendByOwner(page, { title, kind: page.kind, doc: current.doc, note: `改名：${page.title} → ${title}`, source: 'user' }))
  }

  /** 删除只是放进回收站，30 天后彻底删掉。 */
  remove(input: unknown): PodResult<Page> {
    const found = this.live(input)
    if (!found.ok) return found
    return ok(this.deps.pages.patch(found.value, { deletedAt: this.deps.now() }))
  }

  restore(input: unknown): PodResult<Page> {
    const found = this.page(input)
    if (!found.ok) return found
    return ok(this.deps.pages.patch(found.value, { deletedAt: null }))
  }

  /** 回滚：把那一版的内容存成新的一版，中间的版本都还在。 */
  rollback(input: unknown): PodResult<Page> {
    const found = this.live(input)
    if (!found.ok) return found
    const page = found.value
    const version = readInt(input, 'version')
    if (version === undefined) return fail('invalid-input', '要写明回到第几版')
    if (version === page.version) return fail('invalid-input', '现在就是这一版')
    const target = this.deps.pages.version(page, version)
    if (target === undefined) return fail('not-found', `没有第 ${version} 版`)
    const next = this.deps.pages.appendByOwner(page, { title: target.title, kind: target.kind, doc: target.doc, note: `回到第 ${version} 版`, source: 'rollback' })
    this.deps.rooms.milestone(next.roomId, `你把${PAGE_KIND_LABELS[next.kind]}「${next.title}」回滚到第 ${version} 版的内容，存成了第 ${next.version} 版`, { pageId: next.id })
    return ok(next)
  }

  /** 页面的修改对话：带这个页面 id 的最近 100 条消息（你的要求、bot 的回复、更新卡片），按时间先后。 */
  thread(input: unknown): PodResult<{ readonly messages: readonly RoomMessage[] }> {
    const found = this.page(input)
    if (!found.ok) return found
    return ok({ messages: listPageMessages(this.deps.db, found.value.id, 100) })
  }

  /** 修改要求发到哪：页面所在的对话还在、做页面的 bot 还在里面就用它，否则用这个 bot 的单聊。 */
  private roomFor(page: Page, bot: Bot): PodResult<Room> {
    const room = page.roomId === null ? undefined : this.deps.rooms.get(page.roomId)
    if (room !== undefined && room.archivedAt === null) {
      const member = room.kind === 'direct' ? room.botId === bot.id : this.deps.rooms.members(room.id).some((item) => item.botId === bot.id)
      if (member) return ok(room)
    }
    return this.deps.rooms.openDirect({ botId: bot.id })
  }

  /** 你在页面旁边提修改要求：写进对话（带上页面 id），只交给做页面的 bot（它不在了交给主管）。 */
  async edit(input: unknown): Promise<PodResult<RoomMessage>> {
    const found = this.live(input)
    if (!found.ok) return found
    const page = found.value
    const text = readString(input, 'text')
    if (text === '') return fail('invalid-input', '要写明想怎么改')
    if (charLength(text) > MESSAGE_MAX) return fail('invalid-input', `一次最多 ${MESSAGE_MAX} 个字`)
    const bot = this.deps.bots.activeBot(page.botId) ?? this.deps.bots.lead()
    const room = this.roomFor(page, bot)
    if (!room.ok) return room
    const instruction = [
      `[页面修改] 用户在${PAGE_KIND_LABELS[page.kind]}「${page.title}」旁边提了修改要求（页面 id：${page.id}，现在是第 ${page.version} 版）：`,
      text,
      '',
      '先用 get_page 读当前内容，按要求改好后用 save_page 带上这个 id 整份保存，note 写这次改了什么；保存后用一两句话告诉用户改了哪里。要求不清楚就先问。',
    ].join('\n')
    const sent = await this.deps.rooms.sendAbout(room.value, bot, { body: text, text: instruction, data: { pageId: page.id } })
    if (!sent.ok) return sent
    this.deps.pages.noteEdit(sent.value.deliveryId, page.id)
    return ok(sent.value.message)
  }
}
