import type { DatabaseSync } from 'node:sqlite'
import { admitMemory, sameMemory, t, type DreamOp, type MemoryEntry, type MemoryNote } from 'pod-domain'
import { appendMemoryLog, getCore, getMemory, getNote, insertMemory, markDreamOp, putNote, setCore, transaction, updateMemory } from 'pod-store'

export interface ApplyDeps {
  readonly db: DatabaseSync
  readonly now: () => number
}

/** 落库或撤销的结果：做了几处、哪几处没做和原因，以及动到的条目和笔记（索引要跟着更新）。 */
export interface ApplyResult {
  readonly done: number
  readonly skipped: readonly { readonly seq: number; readonly why: string }[]
  readonly entries: readonly MemoryEntry[]
  readonly notes: readonly MemoryNote[]
}

interface Sink {
  readonly entries: Map<string, MemoryEntry>
  readonly notes: Map<string, MemoryNote>
}

/** 条目还是定计划时看到的那个样子：之后又改过的不动它。 */
function unchanged(live: MemoryEntry | undefined, before: MemoryEntry): live is MemoryEntry {
  return live !== undefined && live.status === before.status && live.content === before.content && live.scopeKind === before.scopeKind && live.scopeId === before.scopeId
}

function log(deps: ApplyDeps, dreamId: string, action: string, before: MemoryEntry | null, after: MemoryEntry, reason: string, now: number): void {
  appendMemoryLog(deps.db, { memoryId: after.id, action, before, after, actor: 'dream', reason: t('{reason}（整理 {dreamId}）', { reason, dreamId }), now })
}

/** 做一处改动；做不了返回原因。 */
function applyOne(deps: ApplyDeps, op: DreamOp, now: number, sink: Sink): string | undefined {
  const { db } = deps
  switch (op.kind) {
    case 'note-upsert': {
      const draft = op.after.note
      if (draft === undefined) return t('改动的内容不完整')
      const before = op.before.note ?? null
      const live = getNote(db, op.ref)
      if (before === null ? live !== undefined : live === undefined || live.status !== 'active' || live.updatedAt !== before.updatedAt) return t('这页笔记之后又改过')
      const note: MemoryNote = { id: op.ref, scopeKind: op.scopeKind, scopeId: op.scopeId, ...draft, status: 'active', userEdited: false, createdAt: before?.createdAt ?? now, updatedAt: now }
      putNote(db, note)
      sink.notes.set(note.id, note)
      for (const entry of op.before.merged ?? []) {
        const current = getMemory(db, entry.id)
        if (!unchanged(current, entry)) continue
        const next = updateMemory(db, entry.id, { status: 'merged', noteId: note.id }, now)
        if (next === undefined) continue
        log(deps, op.dreamId, 'merge', current, next, t('并进笔记「{title}」', { title: note.title }), now)
        sink.entries.set(next.id, next)
      }
      return undefined
    }
    case 'note-archive': {
      const before = op.before.note ?? null
      const live = getNote(db, op.ref)
      if (before === null || live === undefined || live.status !== 'active' || live.updatedAt !== before.updatedAt) return t('这页笔记之后又改过')
      const note: MemoryNote = { ...live, status: 'archived', updatedAt: now }
      putNote(db, note)
      sink.notes.set(note.id, note)
      return undefined
    }
    case 'entry-supersede':
    case 'entry-archive':
    case 'entry-confirm':
    case 'entry-move': {
      const before = op.before.entry
      if (before === undefined) return t('改动的内容不完整')
      const live = getMemory(db, op.ref)
      if (!unchanged(live, before)) return t('这条之后又改过')
      const patch =
        op.kind === 'entry-move'
          ? { scopeKind: op.after.scopeKind ?? before.scopeKind, scopeId: op.after.scopeId ?? before.scopeId, ...(op.after.status === undefined ? {} : { status: op.after.status }) }
          : { status: op.after.status ?? before.status }
      const next = updateMemory(db, op.ref, patch, now)
      if (next === undefined) return t('这条之后又改过')
      log(deps, op.dreamId, op.kind.slice('entry-'.length), live, next, op.reason, now)
      sink.entries.set(next.id, next)
      return undefined
    }
    case 'entry-add': {
      const fresh = op.after.entry
      if (fresh === undefined) return t('改动的内容不完整')
      const admitted = admitMemory(fresh.content, fresh.source)
      if (!admitted.ok) return admitted.reason
      if (getMemory(db, op.ref) !== undefined) return t('已经记过了')
      const entry = insertMemory(db, {
        id: op.ref,
        scopeKind: op.scopeKind,
        scopeId: op.scopeId,
        type: fresh.type,
        content: admitted.content,
        source: fresh.source,
        sourceRef: fresh.sourceRef,
        confidence: fresh.source === 'owner' ? 0.95 : 0.7,
        private: false,
        pinned: false,
        status: fresh.status,
        supersedes: null,
        validUntil: null,
        userEdited: false,
        now,
      })
      log(deps, op.dreamId, 'add', null, entry, op.reason, now)
      sink.entries.set(entry.id, entry)
      return undefined
    }
    case 'core-set': {
      const live = getCore(db, op.scopeKind, op.scopeId)
      if (live.text !== (op.before.text ?? '')) return t('要点之后又改过')
      setCore(db, { scopeKind: op.scopeKind, scopeId: op.scopeId, text: op.after.text ?? '', userEdited: live.userEdited, updatedAt: now })
      appendMemoryLog(db, { memoryId: `core:${op.scopeKind}:${op.scopeId}`, action: 'core', before: null, after: null, actor: 'dream', reason: t('{reason}（整理 {dreamId}）', { reason: op.reason, dreamId: op.dreamId }), now })
      return undefined
    }
  }
}

/** 撤一处改动：现在还是这一晚改成的样子才撤，之后又改过的不动；撤不了返回原因。 */
function revertOne(deps: ApplyDeps, op: DreamOp, now: number, sink: Sink): string | undefined {
  const { db } = deps
  switch (op.kind) {
    case 'note-upsert': {
      const live = getNote(db, op.ref)
      if (live === undefined || live.updatedAt !== op.appliedAt) return t('这页笔记之后又改过，没有撤')
      const before = op.before.note ?? null
      const note: MemoryNote = before === null ? { ...live, status: 'deleted', updatedAt: now } : { ...before, updatedAt: now }
      putNote(db, note)
      sink.notes.set(note.id, note)
      for (const entry of op.before.merged ?? []) {
        const current = getMemory(db, entry.id)
        if (current === undefined || current.status !== 'merged' || current.noteId !== op.ref) continue
        const next = updateMemory(db, entry.id, { status: entry.status, noteId: entry.noteId }, now)
        if (next === undefined) continue
        log(deps, op.dreamId, 'revert', current, next, t('整晚撤销：从笔记里拿回来'), now)
        sink.entries.set(next.id, next)
      }
      return undefined
    }
    case 'note-archive': {
      const live = getNote(db, op.ref)
      if (live === undefined || live.status !== 'archived' || live.updatedAt !== op.appliedAt) return t('这页笔记之后又改过，没有撤')
      const note: MemoryNote = { ...live, status: 'active', updatedAt: now }
      putNote(db, note)
      sink.notes.set(note.id, note)
      return undefined
    }
    case 'entry-supersede':
    case 'entry-archive':
    case 'entry-confirm':
    case 'entry-move': {
      const before = op.before.entry
      const live = getMemory(db, op.ref)
      if (before === undefined || live === undefined) return t('这条已经不在了')
      const still = op.kind === 'entry-move' ? live.scopeKind === op.after.scopeKind && live.scopeId === op.after.scopeId : live.status === op.after.status
      if (!still || live.content !== before.content) return t('这条之后又改过，没有撤')
      const next = updateMemory(db, op.ref, { status: before.status, scopeKind: before.scopeKind, scopeId: before.scopeId }, now)
      if (next === undefined) return t('这条已经不在了')
      log(deps, op.dreamId, 'revert', live, next, t('整晚撤销'), now)
      sink.entries.set(next.id, next)
      return undefined
    }
    case 'entry-add': {
      const live = getMemory(db, op.ref)
      if (live === undefined) return undefined
      if (live.status !== op.after.entry?.status || !sameMemory(live.content, op.after.entry.content)) return t('这条之后又改过，没有撤')
      const next = updateMemory(db, op.ref, { status: 'deleted' }, now)
      if (next === undefined) return undefined
      log(deps, op.dreamId, 'revert', live, next, t('整晚撤销：去掉这一晚新记的'), now)
      sink.entries.set(next.id, next)
      return undefined
    }
    case 'core-set': {
      const live = getCore(db, op.scopeKind, op.scopeId)
      if (live.text !== (op.after.text ?? '')) return t('要点之后又改过，没有撤')
      setCore(db, { scopeKind: op.scopeKind, scopeId: op.scopeId, text: op.before.text ?? '', userEdited: op.before.userEdited ?? false, updatedAt: now })
      appendMemoryLog(db, { memoryId: `core:${op.scopeKind}:${op.scopeId}`, action: 'core', before: null, after: null, actor: 'dream', reason: t('整晚撤销：要点改回去（整理 {dreamId}）', { dreamId: op.dreamId }), now })
      return undefined
    }
  }
}

/**
 * 把选中的改动在一次事务里落库：每处都先看现在还是不是定计划时的样子，不是就跳过并记下原因。
 * 条目的改动同时记进变更日志，带上这一晚的编号。
 */
export function applyOps(deps: ApplyDeps, ops: readonly DreamOp[], pick: (op: DreamOp) => boolean): ApplyResult {
  const sink: Sink = { entries: new Map(), notes: new Map() }
  const skipped: { seq: number; why: string }[] = []
  let done = 0
  transaction(deps.db, () => {
    const now = deps.now()
    for (const op of ops) {
      if (op.appliedAt !== null || !pick(op)) continue
      const why = applyOne(deps, op, now, sink)
      if (why === undefined) {
        markDreamOp(deps.db, op.dreamId, op.seq, { appliedAt: now, skipped: '' })
        done += 1
      } else {
        markDreamOp(deps.db, op.dreamId, op.seq, { skipped: why })
        skipped.push({ seq: op.seq, why })
      }
    }
  })
  return { done, skipped, entries: [...sink.entries.values()], notes: [...sink.notes.values()] }
}

/** 整晚撤销：把这一晚做了的改动倒着撤回去。 */
export function revertOps(deps: ApplyDeps, ops: readonly DreamOp[]): ApplyResult {
  const sink: Sink = { entries: new Map(), notes: new Map() }
  const skipped: { seq: number; why: string }[] = []
  let done = 0
  transaction(deps.db, () => {
    const now = deps.now()
    for (const op of [...ops].reverse()) {
      if (op.appliedAt === null || op.revertedAt !== null) continue
      const why = revertOne(deps, op, now, sink)
      if (why === undefined) {
        markDreamOp(deps.db, op.dreamId, op.seq, { revertedAt: now })
        done += 1
      } else {
        markDreamOp(deps.db, op.dreamId, op.seq, { skipped: why })
        skipped.push({ seq: op.seq, why })
      }
    }
  })
  return { done, skipped, entries: [...sink.entries.values()], notes: [...sink.notes.values()] }
}
