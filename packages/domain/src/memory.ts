/**
 * 记忆：bot 知道的事实、偏好、约定和经验，按“关于什么”分开放：关于你、群、bot。
 * 每个范围里有两层：要点（一小块，每段会话开始时放进提示词，夜里整理时更新）和条目（数量不限，白天只追加，用到时再取）。
 * 还没整理出要点的范围，先把最近的条目放进提示词。
 */

import { t } from './i18n.ts'
import { containsSecret } from './secrets.ts'
import { estimateTokens, textUnits } from './text.ts'

/** 你的档案、bot 个人、团队、房间、任务记录、组织目录（哪个群管什么、哪类事交给谁，只给 Super-agent）。 */
export type MemoryScopeKind = 'owner' | 'bot' | 'team' | 'room' | 'task' | 'org'

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

/**
 * active 在用；pending 待确认（bot 推断的）；superseded 已被替代；archived 不再自动召回但能搜到；
 * merged 夜里整理时并进了一页笔记（内容在笔记里，条目留着当出处）；deleted 删了。
 */
export type MemoryStatus = 'active' | 'pending' | 'superseded' | 'archived' | 'merged' | 'deleted'

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
  /** 并进了哪页笔记（status 是 merged 时）。 */
  readonly noteId: string | null
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
  org: 1200,
}

export const CORE_LABELS: Readonly<Record<MemoryScopeKind, string>> = {
  owner: '关于用户',
  bot: '你自己的经验',
  team: '团队约定',
  room: '这个群里定的事',
  task: '任务记录',
  org: '组织目录',
}

/**
 * 每段会话开头带的那一块，各范围的条目最多放多少字（中文一个字算一个，两个英文字母算一个）。
 * 要点另算（见 CORE_LIMITS）；任务记录不带。
 */
export const ALWAYS_LIMITS: Readonly<Record<MemoryScopeKind, number>> = {
  owner: 800,
  bot: 500,
  team: 400,
  room: 500,
  task: 0,
  org: 400,
}

/** 整理出要点以后，之后新记的条目另带这么多字（当天记的当天就用得上）。 */
export const FRESH_LIMIT = 300

/** 送消息、送交代时顺带附的相关记忆最多几条。 */
export const HINT_LIMIT = 5

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
 * 一条候选记忆能不能写：不存银行卡号这类长数字；来自网页的指令性内容不进记忆。
 * 用户给的密码、密钥照存，bot 以后要用。
 */
export function admitMemory(content: string, source: MemorySource): AdmitResult {
  const trimmed = content.replace(/\s+/g, ' ').trim()
  if (trimmed === '') return { ok: false, reason: t('内容是空的') }
  if (textUnits(trimmed) > MEMORY_CONTENT_MAX) return { ok: false, reason: t('一条记忆最多 {MEMORY_CONTENT_MAX} 个字，太长就写进文件', { MEMORY_CONTENT_MAX, letters: MEMORY_CONTENT_MAX * 2 }) }
  if (/\b\d{13,19}\b/.test(trimmed.replace(/[\s-]/g, ''))) return { ok: false, reason: t('记忆里不能存卡号这类数字') }
  if (source === 'web' && isInstructionLike(trimmed)) return { ok: false, reason: t('网页里的指令性内容不能写进记忆') }
  return { ok: true, content: trimmed }
}

const CREDENTIAL_WORDS = /密码|口令|密钥|私钥|令牌|password|passwd|passphrase|api[\s_-]?key|secret|token|private key/i

/**
 * 账号、密码、密钥这类条目：照样存着、recall 查得到，但不放进每段会话开头带的那一块，也不顺带附在消息后面；
 * 夜里整理时原样保留，不改写、不并进笔记。
 */
export function isCredentialMemory(content: string): boolean {
  return CREDENTIAL_WORDS.test(content) || containsSecret(content)
}

/** 两条记忆是不是同一句话（不算空白和大小写）：一样的不重复写。 */
export function sameMemory(left: string, right: string): boolean {
  const plain = (text: string): string => text.replace(/\s+/g, '').toLowerCase()
  return plain(left) === plain(right)
}

/** 字符二元组的 Jaccard 相似度，夜里整理时用来找说的是同一件事的条目。 */
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
