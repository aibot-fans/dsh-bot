import { isRecord, t, truncate, type MemoryEntry, type MemoryScopeKind } from 'pod-domain'
import type { OpBody } from './plan.ts'

/** 一晚最多分拣多少条 Super-agent 名下的条目。 */
export const SORT_MAX = 80

/** 分拣的提示词：Super-agent 名下的条目各归各的家。 */
export const SORT_SYSTEM = [
  '你在做“记忆整理”里的分拣：下面是总管 bot（Super-agent）名下记的条目。它不该记细节，每条要归到真正的家。',
  '对每条选一个去处：',
  'owner：关于用户本人的偏好、规矩、事实。',
  '某个群的编号（g 开头）：这条是那个群管的那件事的约定、决定、现状。',
  'org：哪个群管什么、哪类事该交给谁、交给谁以后做得怎么样。',
  'self：它自己干活的做法；或者看不出该归哪。拿不准就选 self。',
  '只输出 JSON 数组，每条一个元素：[{"id":"e1","to":"owner"}]',
].join('\n')

export interface SortGroup {
  readonly alias: string
  readonly id: string
  readonly title: string
  readonly about: string
}

export function sortPrompt(groups: readonly SortGroup[], entries: readonly MemoryEntry[]): string {
  return [
    `[现有的群]\n${groups.length === 0 ? '（没有）' : groups.map((group) => `(${group.alias}) 「${group.title}」${group.about === '' ? '' : `：${group.about}`}`).join('\n')}`,
    `[Super-agent 名下的条目]\n${entries.map((entry, index) => `(e${index + 1}) ${truncate(entry.content, 200)}`).join('\n')}`,
  ].join('\n\n')
}

/**
 * 按模型分的去处定下搬家的改动：归到关于你的，不是你亲口说的转成待确认；群的编号要认得；选 self 和看不懂的不动。
 */
export function sortOps(value: unknown, groups: readonly SortGroup[], entries: readonly MemoryEntry[], label: (kind: MemoryScopeKind, id: string) => string): readonly OpBody[] {
  if (!Array.isArray(value)) return []
  const ops: OpBody[] = []
  const done = new Set<string>()
  for (const item of value.filter(isRecord)) {
    const index = typeof item.id === 'string' ? Number(item.id.replace(/^e/, '')) - 1 : -1
    const entry = entries[index]
    const to = typeof item.to === 'string' ? item.to.trim() : ''
    if (entry === undefined || done.has(entry.id)) continue
    const group = groups.find((candidate) => candidate.alias === to)
    const target = to === 'owner' ? { kind: 'owner' as const, id: '' } : to === 'org' ? { kind: 'org' as const, id: '' } : group === undefined ? undefined : { kind: 'room' as const, id: group.id }
    if (target === undefined) continue
    done.add(entry.id)
    const pending = target.kind === 'owner' && entry.source !== 'owner'
    ops.push({
      kind: 'entry-move',
      scopeKind: entry.scopeKind,
      scopeId: entry.scopeId,
      ref: entry.id,
      before: { entry },
      after: { scopeKind: target.kind, scopeId: target.id, ...(pending ? { status: 'pending' as const } : {}) },
      reason: pending ? t('Super-agent 不记细节，归到{place}；不是你亲口说的，等你确认', { place: label(target.kind, target.id) }) : t('Super-agent 不记细节，归到{place}', { place: label(target.kind, target.id) }),
      evidence: [],
      held: false,
    })
  }
  return ops
}
