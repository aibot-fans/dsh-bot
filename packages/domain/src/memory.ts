/**
 * 记忆：bot 知道的事实、偏好、约定和经验，分作用域存储。
 * 核心记忆每个作用域一小块，每段会话开始时放进提示词；记忆条目数量不限，用到时再取。
 */

import { containsSecret } from './secrets.ts'
import { estimateTokens } from './text.ts'

/** 你的档案、bot 个人、团队、房间、任务记录。 */
export type MemoryScopeKind = 'owner' | 'bot' | 'team' | 'room' | 'task'

export type MemoryType = 'fact' | 'preference' | 'convention' | 'decision' | 'experience' | 'person' | 'project' | 'todo'

export const MEMORY_TYPES: readonly MemoryType[] = ['fact', 'preference', 'convention', 'decision', 'experience', 'person', 'project', 'todo']

export const MEMORY_TYPE_LABELS: Readonly<Record<MemoryType, string>> = {
  fact: '事实',
  preference: '偏好',
  convention: '约定',
  decision: '决定',
  experience: '经验',
  person: '人物',
  project: '项目',
  todo: '待办',
}

/** 来源：你说的、bot 推断的、网页上的、其他 bot 说的、任务复盘。 */
export type MemorySource = 'owner' | 'bot' | 'web' | 'other-bot' | 'extracted' | 'task'

/** active 在用；pending 待确认（bot 推断的）；superseded 已被替代；archived 不再自动召回但能搜到；deleted 删了。 */
export type MemoryStatus = 'active' | 'pending' | 'superseded' | 'archived' | 'deleted'

export interface MemoryEntry {
  readonly id: string
  readonly scopeKind: MemoryScopeKind
  /** 你的档案为空串；其余是 bot、团队、房间或任务的 id。 */
  readonly scopeId: string
  readonly type: MemoryType
  readonly content: string
  readonly source: MemorySource
  /** 链接到原消息、原网页或任务。 */
  readonly sourceRef: string
  readonly confidence: number
  /** 私密：只有主管能读（只对你的档案有意义）。 */
  readonly private: boolean
  readonly pinned: boolean
  readonly status: MemoryStatus
  readonly supersedes: string | null
  readonly validUntil: number | null
  /** 你亲手改过的条目以后不会被自动覆盖。 */
  readonly userEdited: boolean
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastUsedAt: number | null
  readonly useCount: number
}

export interface CoreMemory {
  readonly scopeKind: MemoryScopeKind
  readonly scopeId: string
  readonly text: string
  readonly userEdited: boolean
  readonly updatedAt: number
}

/** 核心记忆的默认上限（token）。 */
export const CORE_LIMITS: Readonly<Record<MemoryScopeKind, number>> = {
  owner: 1500,
  bot: 800,
  team: 1500,
  room: 800,
  task: 800,
}

export const CORE_LABELS: Readonly<Record<MemoryScopeKind, string>> = {
  owner: '用户的档案',
  bot: '你自己的经验',
  team: '团队约定',
  room: '房间要点',
  task: '任务记录',
}

export const MEMORY_CONTENT_MAX = 600

/** 网页里“请记住……”“以后你要……”这类指令性的话，不能当成写记忆的指令。 */
const INSTRUCTION_LIKE = [
  /请(你)?(务必|一定)?记住/,
  /以后(你)?(要|必须|都要|一律)/,
  /从现在(开始|起)/,
  /忽略(之前|上面|以上)/,
  /ignore (all |the )?(previous|above|prior)/i,
  /you (must|should) (always|never)/i,
  /system prompt/i,
]

export function isInstructionLike(text: string): boolean {
  return INSTRUCTION_LIKE.some((pattern) => pattern.test(text))
}

export type AdmitResult = { readonly ok: true; readonly content: string } | { readonly ok: false; readonly reason: string }

/**
 * 一条候选记忆能不能写：不存密钥、密码、验证码、银行卡号这类东西；
 * 来自网页的指令性内容不进记忆。
 */
export function admitMemory(content: string, source: MemorySource): AdmitResult {
  const trimmed = content.replace(/\s+/g, ' ').trim()
  if (trimmed === '') return { ok: false, reason: '内容是空的' }
  if ([...trimmed].length > MEMORY_CONTENT_MAX) return { ok: false, reason: `一条记忆最多 ${MEMORY_CONTENT_MAX} 个字，太长就写进文件` }
  if (containsSecret(trimmed)) return { ok: false, reason: '记忆里不能存密钥、密码、令牌这类敏感信息' }
  if (/\b\d{13,19}\b/.test(trimmed.replace(/[\s-]/g, ''))) return { ok: false, reason: '记忆里不能存卡号这类数字' }
  if (source === 'web' && isInstructionLike(trimmed)) return { ok: false, reason: '网页里的指令性内容不能写进记忆' }
  return { ok: true, content: trimmed }
}

/** 字符二元组的 Jaccard 相似度，用来发现重复或要替代的旧条目。 */
export function similarity(left: string, right: string): number {
  const grams = (text: string): ReadonlySet<string> => {
    const chars = [...text.replace(/\s+/g, '').toLowerCase()]
    const set = new Set<string>()
    for (let index = 0; index < chars.length - 1; index += 1) set.add(`${chars[index]}${chars[index + 1]}`)
    if (chars.length === 1 && chars[0] !== undefined) set.add(chars[0])
    return set
  }
  const a = grams(left)
  const b = grams(right)
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const gram of a) if (b.has(gram)) shared += 1
  return shared / (a.size + b.size - shared)
}

/** 遗忘打分：重要性（置顶、你说的）、最近使用、使用次数。分低又 90 天没用过的转入归档。 */
export function retentionScore(entry: Pick<MemoryEntry, 'pinned' | 'source' | 'lastUsedAt' | 'createdAt' | 'useCount'>, now: number): number {
  if (entry.pinned) return 1
  const importance = entry.source === 'owner' ? 0.5 : entry.source === 'task' ? 0.3 : 0.2
  const days = (now - (entry.lastUsedAt ?? entry.createdAt)) / 86_400_000
  const recency = Math.max(0, 1 - days / 180)
  const usage = Math.min(1, entry.useCount / 10)
  return importance * 0.4 + recency * 0.4 + usage * 0.2
}

export const ARCHIVE_AFTER_DAYS = 90
export const ARCHIVE_SCORE = 0.25

/** 核心记忆超没超上限。 */
export function coreOverLimit(core: Pick<CoreMemory, 'scopeKind' | 'text'>): boolean {
  return estimateTokens(core.text) > CORE_LIMITS[core.scopeKind]
}
