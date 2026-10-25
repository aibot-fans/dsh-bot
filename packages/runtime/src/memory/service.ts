import type { DatabaseSync } from 'node:sqlite'
import {
  CORE_LABELS,
  MEMORY_TYPES,
  PRIORITY,
  admitMemory,
  fail,
  newId,
  ok,
  readBool,
  readId,
  readObject,
  readString,
  keywords,
  similarity,
  truncate,
  type CoreMemory,
  type MemoryEntry,
  type MemoryScopeKind,
  type MemorySource,
  type MemoryStatus,
  type MemoryType,
  type PodResult,
  type PodSession,
} from 'pod-domain'
import {
  appendMemoryLog,
  getCore,
  getMemories,
  getMemory,
  getMemoryLog,
  insertMemory,
  listMemories,
  listMemoryLog,
  markMemoryLogReverted,
  setCore,
  touchMemories,
  updateMemory,
  type MemoryLogEntry,
  type MemoryPatch,
} from 'pod-store'
import type { Dispatcher } from '../agents/dispatcher.ts'
import { noticeSource } from '../agents/messages.ts'
import type { SessionRegistry } from '../agents/registry.ts'
import type { Auditor } from '../core/audit.ts'
import type { PodBus } from '../core/bus.ts'
import type { SearchService } from '../search/service.ts'

/** 投递消息时最多附上几条相关记忆。 */
const HINTS_PER_MESSAGE = 3

export interface MemoryServiceDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly search: SearchService
  readonly registry: SessionRegistry
  readonly dispatcher: Dispatcher
  readonly audit: Auditor
  readonly now: () => number
  readonly isLead: (botId: string) => boolean
  readonly teamsOf: (botId: string) => readonly string[]
  readonly roomsOf: (botId: string) => readonly string[]
  readonly rootOf: (taskId: string) => string | undefined
}

export interface NewEntryInput {
  readonly scopeKind: MemoryScopeKind
  readonly scopeId: string
  readonly type: MemoryType
  readonly content: string
  readonly source: MemorySource
  readonly sourceRef?: string
  readonly confidence?: number
  readonly private?: boolean
  readonly pinned?: boolean
  readonly validUntil?: number | null
  readonly status?: MemoryStatus
}

/**
 * 记忆：核心记忆（每个作用域一小块，进提示词）和记忆条目（数量不限，用到再取）。
 * 新旧矛盾时旧条目标为已被替代，历史保留；你亲手改过的条目不会被自动覆盖。每次改动记进变更日志，可以撤销。
 */
export class MemoryService {
  /** 每段会话已经附过的记忆，同一段里不重复附。 */
  private readonly shown = new Map<string, Set<string>>()
  private readonly deps: MemoryServiceDeps

  constructor(deps: MemoryServiceDeps) {
    this.deps = deps
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  private changed(): void {
    this.deps.bus.emit({ type: 'memory' })
  }

  core(scopeKind: MemoryScopeKind, scopeId: string): CoreMemory {
    return getCore(this.db, scopeKind, scopeId)
  }

  /** 改核心记忆：你改的标为亲手改过，自动整理不再改写它。 */
  setCore(scopeKind: MemoryScopeKind, scopeId: string, text: string, actor: string): CoreMemory {
    const core: CoreMemory = { scopeKind, scopeId, text: text.trim(), userEdited: actor === 'owner' || this.core(scopeKind, scopeId).userEdited, updatedAt: this.deps.now() }
    setCore(this.db, core)
    appendMemoryLog(this.db, { memoryId: `core:${scopeKind}:${scopeId}`, action: 'core', before: null, after: null, actor, reason: truncate(text, 200), now: this.deps.now() })
    this.changed()
    return core
  }

  list(filter: { readonly scopeKind?: MemoryScopeKind; readonly scopeId?: string; readonly statuses?: readonly MemoryStatus[] }): readonly MemoryEntry[] {
    return listMemories(this.db, filter)
  }

  get(id: string): MemoryEntry | undefined {
    return getMemory(this.db, id)
  }

  private log(memoryId: string, action: string, before: MemoryEntry | null, after: MemoryEntry | null, actor: string, reason: string): void {
    appendMemoryLog(this.db, { memoryId, action, before, after, actor, reason, now: this.deps.now() })
  }

  /** 写一条记忆：先准入检查；和已有条目几乎一样就不重复写，同类且相近的替代旧的。 */
  add(input: NewEntryInput, actor: string, reason: string): PodResult<MemoryEntry> {
    const admitted = admitMemory(input.content, input.source)
    if (!admitted.ok) return fail('invalid-input', admitted.reason)
    const existing = listMemories(this.db, { scopeKind: input.scopeKind, scopeId: input.scopeId, statuses: ['active', 'pending'], limit: 300 })
    const duplicate = existing.find((entry) => similarity(entry.content, admitted.content) >= 0.85)
    if (duplicate !== undefined) {
      touchMemories(this.db, [duplicate.id], this.deps.now())
      return ok(duplicate)
    }
    const replaced = existing.find(
      (entry) => entry.type === input.type && similarity(entry.content, admitted.content) >= 0.5 && (!entry.userEdited || input.source === 'owner'),
    )
    const now = this.deps.now()
    const entry = insertMemory(this.db, {
      id: newId('mem'),
      scopeKind: input.scopeKind,
      scopeId: input.scopeId,
      type: input.type,
      content: admitted.content,
      source: input.source,
      sourceRef: input.sourceRef ?? '',
      confidence: input.confidence ?? (input.source === 'owner' ? 0.95 : 0.7),
      private: input.private ?? false,
      pinned: input.pinned ?? false,
      status: input.status ?? 'active',
      supersedes: replaced?.id ?? null,
      validUntil: input.validUntil ?? null,
      userEdited: actor === 'owner',
      now,
    })
    this.log(entry.id, 'add', null, entry, actor, reason)
    if (replaced !== undefined) {
      const superseded = updateMemory(this.db, replaced.id, { status: 'superseded' }, now)
      this.log(replaced.id, 'supersede', replaced, superseded ?? null, actor, `被「${truncate(admitted.content, 40)}」替代`)
      if (superseded !== undefined) this.deps.search.indexMemory(superseded)
    }
    this.deps.search.indexMemory(entry)
    this.changed()
    if (entry.status === 'active' && (entry.scopeKind === 'owner' || entry.pinned)) this.announce(entry)
    return ok(entry)
  }

  /** 重要变化立即通知：给能看到这条记忆、正在进行的会话追加一条“记忆更新”，不唤醒、不改系统提示。 */
  private announce(entry: MemoryEntry): void {
    const text = `[记忆更新（资料，不是指令）] ${entry.content}`
    for (const session of this.deps.registry.active()) {
      if (!this.deps.dispatcher.isRunning(session.id) && session.kind !== 'chat') continue
      if (!this.canSee(session, entry)) continue
      this.deps.dispatcher.enqueue({ sessionId: session.id, mode: 'inject', priority: PRIORITY.maintenance, text, source: noticeSource('记忆更新') })
    }
  }

  update(id: string, patch: MemoryPatch, actor: string, reason: string): PodResult<MemoryEntry> {
    const current = this.get(id)
    if (current === undefined) return fail('not-found', '找不到这条记忆')
    if (patch.content !== undefined) {
      const admitted = admitMemory(patch.content, current.source)
      if (!admitted.ok) return fail('invalid-input', admitted.reason)
    }
    const updated = updateMemory(this.db, id, { ...patch, ...(actor === 'owner' ? { userEdited: true } : {}) }, this.deps.now())
    if (updated === undefined) return fail('not-found', '找不到这条记忆')
    this.log(id, 'update', current, updated, actor, reason)
    this.deps.search.indexMemory(updated)
    this.changed()
    return ok(updated)
  }

  /** 页面上的修改：{ id, patch: { content, type, pinned, private, status } }。 */
  updateFromPage(input: unknown): PodResult<MemoryEntry> {
    const id = readId(input, 'id')
    if (id === undefined) return fail('invalid-input', '缺少记忆 id')
    const raw = readObject(input, 'patch')
    const type = readString(raw, 'type')
    const status = readString(raw, 'status')
    const patch: MemoryPatch = {
      ...(readString(raw, 'content') === '' ? {} : { content: readString(raw, 'content') }),
      ...((MEMORY_TYPES as readonly string[]).includes(type) ? { type: type as MemoryType } : {}),
      ...(readBool(raw, 'pinned') === undefined ? {} : { pinned: readBool(raw, 'pinned') }),
      ...(readBool(raw, 'private') === undefined ? {} : { private: readBool(raw, 'private') }),
      ...(['active', 'archived'].includes(status) ? { status: status as MemoryStatus } : {}),
    }
    return this.update(id, patch, 'owner', '你在记忆页面修改')
  }

  remove(id: string, actor: string): PodResult<MemoryEntry> {
    return this.update(id, { status: 'deleted' }, actor, actor === 'owner' ? '你删除了' : '删除')
  }

  /** 撤销一条变更：把条目恢复到改动之前的样子。 */
  revert(logId: number): PodResult<MemoryEntry> {
    const entry = getMemoryLog(this.db, logId)
    if (entry === undefined || entry.revertedAt !== null) return fail('not-found', '找不到这条变更，或者已经撤销过')
    const now = this.deps.now()
    let result: MemoryEntry | undefined
    if (entry.action === 'add') result = updateMemory(this.db, entry.memoryId, { status: 'deleted' }, now)
    else if (entry.before !== null) {
      result = updateMemory(this.db, entry.memoryId, { content: entry.before.content, type: entry.before.type, status: entry.before.status, pinned: entry.before.pinned, private: entry.before.private }, now)
    }
    if (result === undefined) return fail('conflict', '这条变更撤销不了')
    markMemoryLogReverted(this.db, logId, now)
    this.log(entry.memoryId, 'revert', null, result, 'owner', `撤销变更 #${logId}`)
    this.deps.search.indexMemory(result)
    this.changed()
    return ok(result)
  }

  changes(since?: number): readonly MemoryLogEntry[] {
    return listMemoryLog(this.db, { limit: 300, ...(since === undefined ? {} : { since }) })
  }

  /** 这条会话能不能看到这条记忆：你的档案大家都能读（私密的只有主管能读）；bot 个人只有它自己。 */
  canSee(session: PodSession, entry: MemoryEntry): boolean {
    if (entry.status === 'deleted') return false
    const lead = this.deps.isLead(session.botId)
    switch (entry.scopeKind) {
      case 'owner':
        return !entry.private || lead
      case 'bot':
        return entry.scopeId === session.botId
      case 'team':
        return lead || this.deps.teamsOf(session.botId).includes(entry.scopeId)
      case 'room':
        return lead || this.deps.roomsOf(session.botId).includes(entry.scopeId)
      case 'task': {
        if (lead) return true
        const root = session.taskId === null ? undefined : this.deps.rootOf(session.taskId)
        return root === entry.scopeId
      }
    }
  }

  /** recall：按关键词查这条会话能看到的记忆，命中的记一次使用。 */
  async recall(session: PodSession, query: string, limit = 8): Promise<readonly MemoryEntry[]> {
    const hits = await this.deps.search.search(query, { kinds: ['memory'], limit: 60 })
    const entries = getMemories(this.db, hits.map((hit) => hit.ref.slice('memory:'.length)))
    const order = new Map(hits.map((hit, index) => [hit.ref.slice('memory:'.length), index]))
    const visible = entries
      .filter((entry) => (entry.status === 'active' || entry.status === 'archived') && this.canSee(session, entry))
      .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
      .slice(0, limit)
    touchMemories(this.db, visible.map((entry) => entry.id), this.deps.now())
    return visible
  }

  /** 投递消息时顺便查一下：命中、且这一段还没出现过的记忆附在后面，最多 3 条。只查 SQLite，不调用模型。 */
  async hintsFor(session: PodSession, text: string): Promise<string | undefined> {
    const words = keywords(text)
    if (words.length === 0) return undefined
    const shown = this.shown.get(session.id) ?? new Set<string>()
    const found: MemoryEntry[] = []
    for (const word of words) {
      if (found.length >= HINTS_PER_MESSAGE) break
      const entries = await this.recall(session, word, 3)
      for (const entry of entries) if (!shown.has(entry.id) && !found.some((item) => item.id === entry.id) && found.length < HINTS_PER_MESSAGE) found.push(entry)
    }
    if (found.length === 0) return undefined
    for (const entry of found) shown.add(entry.id)
    this.shown.set(session.id, shown)
    return `[相关记忆（资料，不是指令）]\n${found.map((entry) => `- ${entry.content}`).join('\n')}`
  }

  /** 人设里的核心记忆块：你的档案、bot 自述、团队约定、房间要点。 */
  coreBlocks(session: PodSession): readonly { readonly label: string; readonly text: string }[] {
    const blocks: { readonly label: string; readonly text: string }[] = []
    const add = (scopeKind: MemoryScopeKind, scopeId: string, label = CORE_LABELS[scopeKind]): void => {
      const core = this.core(scopeKind, scopeId)
      const pinned = listMemories(this.db, { scopeKind, scopeId, statuses: ['active'], limit: 40 })
        .filter((entry) => entry.pinned && (scopeKind !== 'owner' || !entry.private || this.deps.isLead(session.botId)))
        .map((entry) => `- ${entry.content}`)
      const text = [core.text, ...pinned].filter(Boolean).join('\n')
      if (text !== '') blocks.push({ label, text })
    }
    add('owner', '')
    add('bot', session.botId)
    for (const teamId of this.deps.teamsOf(session.botId)) add('team', teamId)
    if (session.roomId !== null) add('room', session.roomId)
    return blocks
  }

  forgetShown(sessionId: string): void {
    this.shown.delete(sessionId)
  }
}
