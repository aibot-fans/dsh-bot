import type { DatabaseSync } from 'node:sqlite'
import {
  OWNER,
  PAGE_DOC_MAX_BYTES,
  PAGE_KINDS,
  PAGE_KIND_LABELS,
  PAGE_NOTE_MAX,
  PAGE_TITLE_MAX,
  describeDoc,
  fail,
  newId,
  ok,
  parsePageDoc,
  t,
  truncate,
  type Bot,
  type Page,
  type PageDoc,
  type PageKind,
  type PageSource,
  type PageVersion,
  type PodResult,
  type PodSession,
} from 'pod-domain'
import { appendPageVersion, getPage, getPageVersion, hasPageAsset, insertPage, listPageAssets, listPages, purgeDeletedPages, putPageAsset, transaction, updatePage } from 'pod-store'
import type { BotService } from '../bots/service.ts'
import type { RoomService } from '../chat/rooms.ts'
import type { Auditor } from '../core/audit.ts'
import type { PodBus } from '../core/bus.ts'
import { RECYCLE_DAYS } from '../core/maintenance.ts'
import { assetHashes, resolveImages } from './images.ts'

export interface PageServiceDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly bots: BotService
  readonly rooms: RoomService
  readonly audit: Auditor
  readonly workspaceRoot: string
  readonly now: () => number
  readonly timezone: () => string
  /** 会话产出文件的文件夹：图片的相对路径先在这里找。 */
  readonly folderOf: (session: PodSession) => string
  /** 会话的卡片放进哪个对话：任务会话放进任务的群聊，L1 任务放进发起任务的那个对话。 */
  readonly roomOf: (session: PodSession) => string | null
  /** bot 是成员的对话。 */
  readonly roomsOfBot: (botId: string) => readonly string[]
}

export interface SaveInput {
  /** 有 id 是更新已有页面（整份替换，追加一版），没有是新建。 */
  readonly id: string | undefined
  readonly title: string
  readonly kind: PageKind | undefined
  readonly note: string
  /** 组件数据：subtitle、accent、blocks、slides、screens、device、poster。 */
  readonly content: Readonly<Record<string, unknown>>
}

export interface SaveOutcome {
  readonly page: Page
  readonly created: boolean
  readonly summary: string
}

/** 显示一个页面要的东西。 */
export interface PageSourceData {
  readonly page: Page
  readonly version: PageVersion
  /** 图片哈希 → data: 地址。 */
  readonly assets: ReadonlyMap<string, string>
  /** 页头小字：种类、第几版、什么时候。 */
  readonly meta: string
}

/**
 * 页面：bot 用组件做的报告、看板、跟踪表和设计。存组件数据（不存 HTML），每次保存追加一版，旧版本随时能看能回滚。
 * 保存后在对话里发一张页面卡片；你在页面旁边提的修改要求只交给做页面的 bot，它的回复也归到这个页面下面。
 */
export class PageService {
  /** 投进会话的修改要求（投递 id → 页面 id），会话收到时转成下一项。 */
  private readonly pendingEdits = new Map<string, string>()
  /** 会话这一轮在回哪个页面的修改要求（会话 id → 页面 id），这一轮结束时清掉。 */
  private readonly threads = new Map<string, string>()
  private readonly deps: PageServiceDeps

  constructor(deps: PageServiceDeps) {
    this.deps = deps
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  get(id: string): Page | undefined {
    return getPage(this.db, id)
  }

  /** bot 能看到、能改的页面：主管全部；其他 bot 是自己做的，和它所在对话里的。 */
  canSee(bot: Bot, page: Page): boolean {
    if (bot.role === 'lead' || page.botId === bot.id) return true
    return page.roomId !== null && this.deps.roomsOfBot(bot.id).includes(page.roomId)
  }

  visibleTo(bot: Bot): readonly Page[] {
    return listPages(this.db, { deleted: false }).filter((page) => this.canSee(bot, page))
  }

  /** 还在用的对话；归档了的算没有。 */
  private activeRoom(roomId: string | null): string | null {
    if (roomId === null) return null
    const room = this.deps.rooms.get(roomId)
    return room === undefined || room.archivedAt !== null ? null : room.id
  }

  /** bot 保存页面：新建，或按 id 整份更新。内容先校验（错误带位置），图片换成页面自己存的，然后追加一版并发卡片。 */
  async save(session: PodSession, input: SaveInput): Promise<PodResult<SaveOutcome>> {
    const bot = this.deps.bots.get(session.botId)
    if (bot === undefined) return fail('not-found', t('找不到你自己'))
    const existing = input.id === undefined ? undefined : getPage(this.db, input.id)
    if (input.id !== undefined) {
      if (existing === undefined || existing.deletedAt !== null) return fail('not-found', t('没有 id 为 {id} 的页面（也可能已经删了）。新建页面不要写 id', { id: input.id }))
      if (!this.canSee(bot, existing)) return fail('forbidden', t('这个页面不是你做的，也不在你所在的对话里，不能改'))
    }
    const kind = input.kind ?? existing?.kind
    if (kind === undefined) return fail('invalid-input', t('新建页面要写 kind（{PAGE_KINDS}）', { PAGE_KINDS: PAGE_KINDS.join(' / ') }))
    const title = truncate(input.title.trim() || (existing?.title ?? ''), PAGE_TITLE_MAX)
    if (title === '') return fail('invalid-input', t('新建页面要写 title'))
    const parsed = parsePageDoc(kind, input.content)
    if (!parsed.ok) return fail('invalid-input', t('页面内容有问题，改好再保存：\n{errors}', { errors: parsed.errors.join('\n') }))
    const images = await resolveImages(parsed.doc, {
      workspaceRoot: this.deps.workspaceRoot,
      folders: [this.deps.folderOf(session), this.deps.workspaceRoot],
      has: (hash) => existing !== undefined && hasPageAsset(this.db, existing.id, hash),
    })
    if (!images.ok) return fail('invalid-input', t('图片有问题：\n{errors}', { errors: images.errors.join('\n') }))
    const bytes = Buffer.byteLength(JSON.stringify(images.doc))
    if (bytes > PAGE_DOC_MAX_BYTES) return fail('invalid-input', t('页面内容有 {bytes} MB，最多 {PAGE_DOC_MAX_BYTES} MB：拆成几个页面，或者把大表格存成文件', { bytes: (bytes / 1_000_000).toFixed(1), PAGE_DOC_MAX_BYTES: PAGE_DOC_MAX_BYTES / 1_000_000 }))
    const now = this.deps.now()
    const source: PageSource = session.kind === 'routine' ? 'routine' : 'bot'
    const note = truncate(input.note.trim(), PAGE_NOTE_MAX)
    const home = this.activeRoom(existing?.roomId ?? null) ?? this.deps.roomOf(session)
    const page = transaction(this.db, () => {
      const target =
        existing ??
        insertPage(this.db, { id: newId('page'), title, kind, botId: bot.id, roomId: home, sessionId: session.id, now }, { doc: images.doc, note: note === '' ? '第一版' : note, author: bot.id, source })
      if (existing !== undefined) {
        appendPageVersion(this.db, { pageId: existing.id, title, kind, doc: images.doc, note, author: bot.id, source, now })
        if (existing.roomId === null && home !== null) updatePage(this.db, existing.id, { roomId: home })
      }
      for (const asset of images.assets) putPageAsset(this.db, target.id, asset, now)
      return getPage(this.db, target.id) ?? target
    })
    const created = existing === undefined
    const summary = describeDoc(kind, images.doc)
    if (home !== null) {
      this.deps.rooms.post(home, {
        author: bot.id,
        kind: 'page',
        body: created ? t('新建了{PAGE_KIND_LABELS}「{title}」', { PAGE_KIND_LABELS: t(PAGE_KIND_LABELS[kind]), title }) : t('更新了{PAGE_KIND_LABELS}「{title}」，现在是第 {version} 版', { PAGE_KIND_LABELS: t(PAGE_KIND_LABELS[kind]), title, version: page.version }),
        data: { pageId: page.id, version: page.version, kind, title, note, summary, created },
        sessionId: session.id,
      })
    }
    this.deps.bus.emit({ type: 'pages', pageId: page.id })
    this.deps.audit.record('page.save', bot.id, page.id, { version: page.version, source })
    return ok({ page, created, summary })
  }

  /** 取某一版（默认最新）。 */
  version(page: Page, version?: number): PageVersion | undefined {
    return getPageVersion(this.db, page.id, version ?? page.version)
  }

  /** 你改名、回滚：用给定的标题和内容追加一版。 */
  appendByOwner(page: Page, change: { readonly title: string; readonly kind: PageKind; readonly doc: PageDoc; readonly note: string; readonly source: PageSource }): Page {
    const now = this.deps.now()
    const next = transaction(this.db, () => {
      appendPageVersion(this.db, { pageId: page.id, title: change.title, kind: change.kind, doc: change.doc, note: change.note, author: OWNER, source: change.source, now })
      return getPage(this.db, page.id) ?? page
    })
    this.deps.bus.emit({ type: 'pages', pageId: page.id })
    this.deps.audit.record(`page.${change.source}`, OWNER, page.id, { version: next.version })
    return next
  }

  /** 置顶、删除、恢复：不动版本。 */
  patch(page: Page, patch: { readonly pinned?: boolean; readonly deletedAt?: number | null }): Page {
    const next = updatePage(this.db, page.id, patch) ?? page
    this.deps.bus.emit({ type: 'pages', pageId: page.id })
    return next
  }

  /** 显示或导出一个页面要的东西：哪一版、图片、页头小字。 */
  source(id: string, version?: number): PageSourceData | undefined {
    const page = getPage(this.db, id)
    if (page === undefined) return undefined
    const found = getPageVersion(this.db, page.id, version ?? page.version)
    if (found === undefined) return undefined
    const assets = new Map(listPageAssets(this.db, page.id, assetHashes(found.doc)).map((asset) => [asset.hash, `data:${asset.mime};base64,${Buffer.from(asset.data).toString('base64')}`]))
    const latest = found.version === page.version ? '' : t('（最新是第 {version} 版）', { version: page.version })
    const meta = t('第 {version} 版 · {time}{latest}', { version: found.version, time: this.stamp(found.createdAt), latest })
    return { page, version: found, assets, meta }
  }

  /** 按设置里的时区写成“2026-10-24 18:00”。 */
  stamp(time: number): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: this.deps.timezone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time))
    const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? ''
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
  }

  /** 回收站里放满 30 天的页面彻底删掉（连同所有版本和图片）。 */
  purgeExpired(now: number): number {
    const removed = purgeDeletedPages(this.db, now - RECYCLE_DAYS * 86_400_000)
    if (removed > 0) this.deps.bus.emit({ type: 'pages' })
    return removed
  }

  // ---------- 修改对话：把 bot 的回复归到页面下面 ----------

  /** 修改要求投进了会话（投递 id）。 */
  noteEdit(deliveryId: string, pageId: string): void {
    this.pendingEdits.set(deliveryId, pageId)
  }

  /** 会话收到一条消息：是页面的修改要求，这一轮 bot 说的话就归到这个页面下。 */
  onDelivered(session: PodSession, messageId: string): void {
    const pageId = this.pendingEdits.get(messageId)
    if (pageId === undefined) return
    this.pendingEdits.delete(messageId)
    this.threads.set(session.id, pageId)
  }

  /** 会话这一轮在回哪个页面。 */
  threadOf(sessionId: string): string | undefined {
    return this.threads.get(sessionId)
  }

  onTurnEnd(sessionId: string): void {
    this.threads.delete(sessionId)
  }
}
