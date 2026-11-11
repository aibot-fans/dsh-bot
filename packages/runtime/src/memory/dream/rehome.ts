import type { DatabaseSync } from 'node:sqlite'
import { isCredentialMemory, t, type DreamScope, type MemoryEntry, type MemoryScopeKind } from 'pod-domain'
import { listMemories } from 'pod-store'
import type { OpBody } from './plan.ts'

/** 一晚最多搬多少条；多的下一晚接着搬。 */
const REHOME_MAX = 200

export interface RehomeDeps {
  readonly db: DatabaseSync
  /** 任务交进了哪个群。 */
  readonly groupOf: (taskId: string) => string | undefined
  /** 任务归哪个 bot 负责。 */
  readonly ownerOf: (taskId: string) => string | undefined
  /** 旧的正式团队转成了哪个群。 */
  readonly teamRoom: (teamId: string) => string | undefined
  readonly label: (kind: MemoryScopeKind, id: string) => string
}

function move(entry: MemoryEntry, kind: MemoryScopeKind, id: string, reason: string): OpBody {
  return { kind: 'entry-move', scopeKind: entry.scopeKind, scopeId: entry.scopeId, ref: entry.id, before: { entry }, after: { scopeKind: kind, scopeId: id }, reason, evidence: [], held: false }
}

/**
 * 任务和旧团队不再是记忆的家：任务里记的事分到它所在的群，没进群的归负责它的 bot；每轮结果的流水账直接归档（结果本来就在汇报里）；
 * 旧团队的并进它转成的群。搬过去以后，下一次整理时在新家里并进笔记。账号密码类的和私密的不动。
 */
export function rehomeOps(deps: RehomeDeps): { readonly ops: readonly OpBody[]; readonly scopes: readonly DreamScope[] } {
  const usable = (kind: MemoryScopeKind): readonly MemoryEntry[] =>
    listMemories(deps.db, { scopeKind: kind, statuses: ['active'], limit: 5000 }).filter((entry) => !entry.private && !entry.userEdited && !isCredentialMemory(entry.content))
  const ops: OpBody[] = []
  const tasks = usable('task')
  for (const entry of tasks.slice(0, REHOME_MAX)) {
    if (entry.source === 'task' && entry.content.startsWith('任务「')) {
      ops.push({ kind: 'entry-archive', scopeKind: 'task', scopeId: entry.scopeId, ref: entry.id, before: { entry }, after: { status: 'archived' }, reason: t('任务每轮的结果在汇报里，不用再留一份'), evidence: [], held: false })
      continue
    }
    const group = deps.groupOf(entry.scopeId)
    const owner = deps.ownerOf(entry.scopeId)
    if (group !== undefined) ops.push(move(entry, 'room', group, t('任务里记的，归到{place}', { place: deps.label('room', group) })))
    else if (owner !== undefined) ops.push(move(entry, 'bot', owner, t('任务里记的，归到{place}', { place: deps.label('bot', owner) })))
  }
  const before = ops.length
  const teams = usable('team')
  for (const entry of teams.slice(0, REHOME_MAX)) {
    const room = deps.teamRoom(entry.scopeId)
    if (room !== undefined) ops.push(move(entry, 'room', room, t('旧团队的约定，并进{place}', { place: deps.label('room', room) })))
  }
  const scopes: DreamScope[] = [
    ...(before === 0 ? [] : [{ kind: 'task' as const, id: '*', label: t('任务里记的，分到群和 bot 名下'), size: tasks.length, touched: before }]),
    ...(ops.length === before ? [] : [{ kind: 'team' as const, id: '*', label: t('旧团队的，并进群'), size: teams.length, touched: ops.length - before }]),
  ]
  return { ops, scopes }
}
