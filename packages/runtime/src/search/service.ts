import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import {
  MEMORY_TYPE_LABELS,
  OWNER,
  POD,
  type Bot,
  type MemoryEntry,
  type PodSession,
  type Room,
  type RoomMessage,
  type SearchDoc,
  type SearchFilters,
  type SearchHit,
  type Task,
} from 'pod-domain'
import { listMemories, listMessages, listRooms, listRootTasks, listTaskTree } from 'pod-store'
import type { SearchIndex } from './index.ts'

/** 会被索引的文件：工作区里的 Markdown、纯文本、CSV、JSON 等。 */
const TEXT_FILES = new Set(['.md', '.markdown', '.txt', '.csv', '.tsv', '.json', '.yaml', '.yml', '.html', '.htm', '.xml', '.log'])

/** 单个文件最多索引的字数。 */
const FILE_TEXT_MAX = 200_000

const INDEXED_KINDS = new Set(['text', 'kickoff', 'folded'])

export interface SearchServiceDeps {
  readonly db: DatabaseSync
  readonly index: SearchIndex
  readonly workspaceRoot: string
  readonly bot: (id: string) => Bot | undefined
  readonly room: (id: string) => Room | undefined
  readonly roomsOfBot: (botId: string) => readonly string[]
  readonly isLead: (botId: string) => boolean
  readonly warn: (message: string) => void
}

function stripTags(text: string): string {
  return text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
}

/**
 * 搜索：聊天记录、任务、文件、记忆和网页存档写入时同步进索引；文件在任务结束时按修改时间增量扫描。
 * bot 只能搜到它有权看到的内容（它所在的房间、它的任务和文件），主管可以搜全部。
 */
export class SearchService {
  private readonly deps: SearchServiceDeps

  constructor(deps: SearchServiceDeps) {
    this.deps = deps
  }

  messageDoc(message: RoomMessage, room: Room): SearchDoc | undefined {
    if (!INDEXED_KINDS.has(message.kind) || message.deletedAt !== null || message.body.trim() === '') return undefined
    const author = message.author === OWNER ? '你' : message.author === POD ? 'dsh-bot' : (this.deps.bot(message.author)?.name ?? '')
    return {
      ref: `message:${message.id}`,
      kind: 'message',
      title: room.title,
      body: `${author}：${message.body}`,
      roomId: room.id,
      botId: message.author === OWNER || message.author === POD ? null : message.author,
      teamId: room.teamId,
      taskId: room.taskId,
      time: message.createdAt,
      boost: (message.author === OWNER ? 0.3 : 0) + (message.pinned ? 0.2 : 0),
    }
  }

  indexMessage(message: RoomMessage): void {
    const room = this.deps.room(message.roomId)
    if (room === undefined) return
    const doc = this.messageDoc(message, room)
    if (doc === undefined) this.deps.index.remove([`message:${message.id}`])
    else this.deps.index.upsert([doc])
  }

  taskDoc(task: Task): SearchDoc {
    const result = task.result
    const body = [
      task.brief,
      task.deliverable,
      task.acceptance.map((item) => item.text).join('；'),
      task.note,
      result?.summary ?? '',
      result?.files.join(' ') ?? '',
    ]
      .filter(Boolean)
      .join('\n')
    return {
      ref: `task:${task.id}`,
      kind: 'task',
      title: task.title,
      body,
      roomId: task.roomId,
      botId: task.ownerBotId,
      teamId: task.teamId,
      taskId: task.rootId,
      time: task.updatedAt,
      boost: task.status === 'done' && task.parentId === null ? 0.2 : 0,
    }
  }

  indexTask(task: Task): void {
    this.deps.index.upsert([this.taskDoc(task)])
  }

  memoryDoc(entry: MemoryEntry): SearchDoc {
    return {
      ref: `memory:${entry.id}`,
      kind: 'memory',
      title: MEMORY_TYPE_LABELS[entry.type],
      body: entry.content,
      roomId: entry.scopeKind === 'room' ? entry.scopeId : null,
      botId: entry.scopeKind === 'bot' ? entry.scopeId : null,
      teamId: entry.scopeKind === 'team' ? entry.scopeId : null,
      taskId: entry.scopeKind === 'task' ? entry.scopeId : null,
      time: entry.updatedAt,
      boost: entry.pinned ? 0.2 : 0,
    }
  }

  indexMemory(entry: MemoryEntry): void {
    if (entry.status === 'deleted') this.deps.index.remove([`memory:${entry.id}`])
    else this.deps.index.upsert([this.memoryDoc(entry)])
  }

  /** 网页存档：读过的网页正文，可搜，也是研究结论的出处。 */
  indexWeb(doc: { readonly id: string; readonly url: string; readonly title: string; readonly text: string; readonly botId: string | null; readonly taskId: string | null; readonly time: number }): void {
    this.deps.index.upsert([
      { ref: `web:${doc.id}`, kind: 'web', title: `${doc.title} ${doc.url}`, body: doc.text.slice(0, FILE_TEXT_MAX), roomId: null, botId: doc.botId, teamId: null, taskId: doc.taskId, time: doc.time, boost: 0 },
    ])
  }

  /** 扫一个工作区文件夹：只索引文本文件，按修改时间增量。 */
  async indexFolder(folder: string, owner: { readonly taskId: string | null; readonly roomId: string | null; readonly teamId: string | null; readonly botId: string | null }): Promise<number> {
    const root = join(this.deps.workspaceRoot, folder)
    let indexed = 0
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 6) return
      let entries: readonly { readonly name: string; isDirectory(): boolean; isFile(): boolean }[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(path, depth + 1)
          continue
        }
        if (!entry.isFile() || !TEXT_FILES.has(extname(entry.name).toLowerCase())) continue
        try {
          const info = await stat(path)
          if (info.size > 2_000_000) continue
          const known = await this.deps.index.fileState(path)
          if (known !== null && known.mtime === info.mtimeMs && known.size === info.size) continue
          const raw = await readFile(path, 'utf8')
          const text = (/\.html?$/i.test(entry.name) ? stripTags(raw) : raw).slice(0, FILE_TEXT_MAX)
          const rel = relative(this.deps.workspaceRoot, path)
          this.deps.index.upsert([
            { ref: `file:${rel}`, kind: 'file', title: rel, body: text, roomId: owner.roomId, botId: owner.botId, teamId: owner.teamId, taskId: owner.taskId, time: info.mtimeMs, boost: rel.includes('shared/') ? 0.2 : 0 },
          ])
          await this.deps.index.setFileState(path, info.mtimeMs, info.size)
          indexed += 1
        } catch (error) {
          this.deps.warn(`索引文件 ${path} 失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    await walk(root, 0)
    return indexed
  }

  /** 你在全局搜索框里搜：所有内容。 */
  search(query: string, filters: SearchFilters = {}): Promise<readonly SearchHit[]> {
    return this.deps.index.search(query, filters)
  }

  /**
   * bot 用检索工具搜：只看它所在的房间、它的任务和文件；主管可以搜全部。
   * 记忆的可见范围由记忆服务另外检查。
   */
  async searchFor(session: PodSession, query: string, filters: SearchFilters = {}): Promise<readonly SearchHit[]> {
    if (this.deps.isLead(session.botId)) return this.search(query, filters)
    const rooms = new Set(this.deps.roomsOfBot(session.botId))
    const hits = await this.deps.index.search(query, { ...filters, limit: 100 })
    return hits
      .filter((hit) => hit.kind === 'memory' || (hit.roomId !== null && rooms.has(hit.roomId)) || hit.botId === session.botId || (hit.taskId !== null && hit.taskId === this.rootOfSession(session)))
      .slice(0, filters.limit ?? 20)
  }

  private rootOfSession(session: PodSession): string | null {
    if (session.taskId === null) return null
    const row = this.deps.db.prepare('SELECT root_id FROM tasks WHERE id = ?').get(session.taskId) as { readonly root_id: string } | undefined
    return row?.root_id ?? null
  }

  /** 第一次启动或索引被删后，从数据库重建一遍。 */
  async rebuild(): Promise<number> {
    const { db } = this.deps
    let count = 0
    for (const room of [...listRooms(db, { archived: false }), ...listRooms(db, { archived: true })]) {
      let before: number | undefined
      for (;;) {
        const page = listMessages(db, room.id, { limit: 200, ...(before === undefined ? {} : { before }) })
        if (page.length === 0) break
        const docs = page.map((message) => this.messageDoc(message, room)).filter((doc): doc is SearchDoc => doc !== undefined)
        this.deps.index.upsert(docs)
        count += docs.length
        before = page[0]?.seq
        if (page.length < 200) break
      }
    }
    for (const root of listRootTasks(db, { limit: 5000 })) {
      const docs = listTaskTree(db, root.id).map((task) => this.taskDoc(task))
      this.deps.index.upsert(docs)
      count += docs.length
    }
    const memories = listMemories(db, { statuses: ['active', 'pending', 'archived', 'superseded'], limit: 100_000 }).map((entry) => this.memoryDoc(entry))
    this.deps.index.upsert(memories)
    return count + memories.length
  }
}
