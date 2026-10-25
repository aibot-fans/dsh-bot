import type { DatabaseSync } from 'node:sqlite'
import { EMPTY_PAGE_DOC, isPageKind, type Page, type PageDoc, type PageKind, type PageSource, type PageVersion, type PageVersionInfo } from 'pod-domain'
import { flag, readJson, writeJson } from './json.ts'

interface PageRow {
  readonly id: string
  readonly title: string
  readonly kind: string
  readonly bot_id: string
  readonly room_id: string | null
  readonly session_id: string | null
  readonly pinned: number
  readonly version: number
  readonly created_at: number
  readonly updated_at: number
  readonly deleted_at: number | null
}

interface VersionRow {
  readonly page_id: string
  readonly version: number
  readonly title: string
  readonly kind: string
  readonly doc?: string
  readonly note: string
  readonly author: string
  readonly source: string
  readonly created_at: number
}

const SOURCES: readonly PageSource[] = ['bot', 'routine', 'user', 'rollback']

function kindOf(value: string): PageKind {
  return isPageKind(value) ? value : 'report'
}

function toPage(row: PageRow): Page {
  return {
    id: row.id,
    title: row.title,
    kind: kindOf(row.kind),
    botId: row.bot_id,
    roomId: row.room_id,
    sessionId: row.session_id,
    pinned: flag(row.pinned),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

function toInfo(row: VersionRow): PageVersionInfo {
  return {
    pageId: row.page_id,
    version: row.version,
    title: row.title,
    kind: kindOf(row.kind),
    note: row.note,
    author: row.author,
    source: (SOURCES as readonly string[]).includes(row.source) ? (row.source as PageSource) : 'bot',
    createdAt: row.created_at,
  }
}

function toVersion(row: VersionRow): PageVersion {
  return { ...toInfo(row), doc: { ...EMPTY_PAGE_DOC, ...readJson<Partial<PageDoc>>(row.doc, {}) } }
}

/** 在用的页面；deleted 为 true 时是回收站里的。 */
export function listPages(db: DatabaseSync, options: { readonly deleted: boolean }): readonly Page[] {
  const sql = options.deleted
    ? 'SELECT * FROM pages WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
    : 'SELECT * FROM pages WHERE deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC'
  return (db.prepare(sql).all() as unknown as readonly PageRow[]).map(toPage)
}

/** 按 id 取页面，回收站里的也取得到。 */
export function getPage(db: DatabaseSync, id: string): Page | undefined {
  const row = db.prepare('SELECT * FROM pages WHERE id = ?').get(id) as PageRow | undefined
  return row === undefined ? undefined : toPage(row)
}

export interface NewPage {
  readonly id: string
  readonly title: string
  readonly kind: PageKind
  readonly botId: string
  readonly roomId: string | null
  readonly sessionId: string | null
  readonly now: number
}

export interface NewPageVersion {
  readonly pageId: string
  readonly title: string
  readonly kind: PageKind
  readonly doc: PageDoc
  readonly note: string
  readonly author: string
  readonly source: PageSource
  readonly now: number
}

/** 新建页面和它的第 1 版。调用方负责包在事务里。 */
export function insertPage(db: DatabaseSync, page: NewPage, first: Omit<NewPageVersion, 'pageId' | 'title' | 'kind' | 'now'>): Page {
  db.prepare(
    'INSERT INTO pages (id, title, kind, bot_id, room_id, session_id, pinned, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)',
  ).run(page.id, page.title, page.kind, page.botId, page.roomId, page.sessionId, page.now, page.now)
  appendPageVersion(db, { ...first, pageId: page.id, title: page.title, kind: page.kind, now: page.now })
  const created = getPage(db, page.id)
  if (created === undefined) throw new Error(`新建页面 ${page.id} 后读不回来`)
  return created
}

/** 追加一版，版本号自动加一，页面的标题、种类和更新时间跟着变。调用方负责包在事务里。 */
export function appendPageVersion(db: DatabaseSync, input: NewPageVersion): number {
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS latest FROM page_versions WHERE page_id = ?').get(input.pageId) as { readonly latest: number }
  const version = row.latest + 1
  db.prepare('INSERT INTO page_versions (page_id, version, title, kind, doc, note, author, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    input.pageId,
    version,
    input.title,
    input.kind,
    writeJson(input.doc),
    input.note,
    input.author,
    input.source,
    input.now,
  )
  db.prepare('UPDATE pages SET title = ?, kind = ?, version = ?, updated_at = ? WHERE id = ?').run(input.title, input.kind, version, input.now, input.pageId)
  return version
}

export function getPageVersion(db: DatabaseSync, pageId: string, version: number): PageVersion | undefined {
  const row = db.prepare('SELECT * FROM page_versions WHERE page_id = ? AND version = ?').get(pageId, version) as VersionRow | undefined
  return row === undefined ? undefined : toVersion(row)
}

/** 版本列表（新的在前），不带页面内容。 */
export function listPageVersions(db: DatabaseSync, pageId: string): readonly PageVersionInfo[] {
  const rows = db
    .prepare('SELECT page_id, version, title, kind, note, author, source, created_at FROM page_versions WHERE page_id = ? ORDER BY version DESC')
    .all(pageId) as unknown as readonly VersionRow[]
  return rows.map(toInfo)
}

export interface PagePatch {
  readonly pinned?: boolean
  readonly roomId?: string | null
  readonly deletedAt?: number | null
}

/** 改置顶、所属对话、删除时间；不动版本。 */
export function updatePage(db: DatabaseSync, id: string, patch: PagePatch): Page | undefined {
  const current = getPage(db, id)
  if (current === undefined) return undefined
  const next = { ...current, ...patch }
  db.prepare('UPDATE pages SET pinned = ?, room_id = ?, deleted_at = ? WHERE id = ?').run(next.pinned ? 1 : 0, next.roomId, next.deletedAt, id)
  return getPage(db, id)
}

/** 回收站里放了很久的页面彻底删掉：页面、所有版本和图片。返回删了几个。 */
export function purgeDeletedPages(db: DatabaseSync, before: number): number {
  const ids = (db.prepare('SELECT id FROM pages WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(before) as unknown as readonly { readonly id: string }[]).map((row) => row.id)
  for (const id of ids) {
    db.prepare('DELETE FROM page_assets WHERE page_id = ?').run(id)
    db.prepare('DELETE FROM page_versions WHERE page_id = ?').run(id)
    db.prepare('DELETE FROM pages WHERE id = ?').run(id)
  }
  return ids.length
}

export interface PageAsset {
  readonly hash: string
  readonly mime: string
  readonly data: Uint8Array
}

/** 存一张图片；同一页面里同样的图片只存一份。 */
export function putPageAsset(db: DatabaseSync, pageId: string, asset: PageAsset, now: number): void {
  db.prepare('INSERT OR IGNORE INTO page_assets (page_id, hash, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').run(pageId, asset.hash, asset.mime, asset.data, now)
}

export function hasPageAsset(db: DatabaseSync, pageId: string, hash: string): boolean {
  return db.prepare('SELECT 1 FROM page_assets WHERE page_id = ? AND hash = ?').get(pageId, hash) !== undefined
}

/** 页面里用到的图片。 */
export function listPageAssets(db: DatabaseSync, pageId: string, hashes: readonly string[]): readonly PageAsset[] {
  if (hashes.length === 0) return []
  const statement = db.prepare('SELECT hash, mime, data FROM page_assets WHERE page_id = ? AND hash = ?')
  return hashes
    .map((hash) => statement.get(pageId, hash) as { readonly hash: string; readonly mime: string; readonly data: Uint8Array } | undefined)
    .filter((row): row is PageAsset => row !== undefined)
}
