/**
 * 记忆的夜间整理：事后拿原始记录核对白天记下的条目，并成主题笔记，更新每段会话开头带的要点。
 * 模型只交“发现”和“新的一版”，代码逐条查出处、定好每一处改动，先给你看或直接生效；每一晚的改动都留着，能整晚撤销。
 * 这里是页面和宿主共用的类型，和几条不依赖库的规则。
 */

import { t } from './i18n.ts'
import type { MemoryEntry, MemoryScopeKind, MemoryStatus, MemoryType } from './memory.ts'

/** 一句话的出处：原话在哪、是谁说的。 */
export interface DreamEvidence {
  /** message:<id> 聊天里的一句；task:<id> 任务汇报；session:<id> 会话日志。 */
  readonly ref: string
  readonly quote: string
  /** owner 是你；其余是 bot 的名字，或者“工具结果”。 */
  readonly by: string
}

/** 笔记正文里一句话是怎么来的：并进来的条目，和从记录里找到的原话；什么时候说的、核对过没有。 */
export interface NoteSource {
  readonly line: string
  readonly entries: readonly string[]
  readonly evidence: readonly DreamEvidence[]
  /** 这句话是什么时候说的、记的（出处里最新的那个时间）。老数据没有，启动时补上。 */
  readonly at?: number
  /** 最近一次有记录证实它的时间。 */
  readonly checkedAt?: number
  /** 拿不准：记忆里说得肯定，记录里其实没核实。这里是记录里那句原话。 */
  readonly doubt?: string
  /** 它替掉了原来的哪一句。 */
  readonly replaces?: string
}

export type NoteStatus = 'active' | 'archived' | 'deleted'

/** 主题笔记：一个主题一页，夜里整理时写；你也能在页面上改，改过的整理时不动。 */
export interface MemoryNote {
  readonly id: string
  readonly scopeKind: MemoryScopeKind
  readonly scopeId: string
  readonly title: string
  /** 一句说明：每段会话开头的目录里就是这一行。 */
  readonly description: string
  /** 正文：一行一句。 */
  readonly body: string
  /** 指向别的笔记（id）。 */
  readonly links: readonly string[]
  readonly sources: readonly NoteSource[]
  readonly status: NoteStatus
  readonly userEdited: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

/** 整理时写出来的一页（还没落库）。 */
export type NoteDraft = Pick<MemoryNote, 'title' | 'description' | 'body' | 'links' | 'sources'>

export const NOTE_TITLE_MAX = 30
export const NOTE_DESCRIPTION_MAX = 80
/** 一页笔记正文最多多少字。 */
export const NOTE_BODY_MAX = 2000
/** 笔记里一句话最多多少字。 */
export const NOTE_LINE_MAX = 240
/** 每段会话开头的笔记目录最多列几页。 */
export const NOTE_INDEX_MAX = 30

/**
 * running 正在整理；paused 有任务在跑先停着，空了接着做；preview 等你看过再生效；applied 已生效；
 * discarded 你没要；reverted 整晚撤销了；failed 没做成；empty 看过了，没有要改的。
 */
export type DreamStatus = 'running' | 'paused' | 'preview' | 'applied' | 'discarded' | 'reverted' | 'failed' | 'empty'

export type DreamTrigger = 'nightly' | 'manual'

export interface DreamStats {
  /** 读了几份记录。 */
  readonly records: number
  /** 从记录里找到几条发现。 */
  readonly findings: number
  /** 出处核对不上、没落库的有几条。 */
  readonly rejected: number
  /** 写了、改了几页笔记。 */
  readonly notes: number
  /** 并进笔记的条目。 */
  readonly merged: number
  /** 替掉、归档、挪走的条目。 */
  readonly changed: number
  /** 新记的条目。 */
  readonly added: number
  readonly questions: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cost: number
}

export const EMPTY_DREAM_STATS: DreamStats = { records: 0, findings: 0, rejected: 0, notes: 0, merged: 0, changed: 0, added: 0, questions: 0, inputTokens: 0, outputTokens: 0, cost: 0 }

/** 这一晚整理到的一个范围。 */
export interface DreamScope {
  readonly kind: MemoryScopeKind
  readonly id: string
  readonly label: string
  /** 整理前这个范围有多少条在用的条目和笔记。 */
  readonly size: number
  /** 这一晚要动其中多少。 */
  readonly touched: number
}

/** 拿不准、要你定的事。每个选项点了以后做哪几处改动；一处都没有就是不动。 */
export interface DreamQuestion {
  readonly id: string
  readonly scopeKind: MemoryScopeKind
  readonly scopeId: string
  readonly text: string
  readonly options: readonly { readonly label: string; readonly ops: readonly number[] }[]
  /** 你选的那一项；没答是 null。 */
  readonly answer: string | null
}

/** 核对没过、没有落库的一条，和原因。 */
export interface DreamRejection {
  readonly what: string
  readonly why: string
}

export interface MemoryDream {
  readonly id: string
  readonly trigger: DreamTrigger
  readonly status: DreamStatus
  readonly scopes: readonly DreamScope[]
  readonly stats: DreamStats
  readonly questions: readonly DreamQuestion[]
  readonly rejected: readonly DreamRejection[]
  readonly model: string
  readonly error: string
  /** 为什么要先给你看；自动生效的是空串。 */
  readonly held: string
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly appliedAt: number | null
  readonly revertedAt: number | null
}

/**
 * 一处改动的种类：写一页笔记（新开或加减几句，同时把条目并进去）、归档一页笔记、
 * 旧说法被新的替掉、条目归档、条目挪到别的范围、新记一条、待确认的转成生效、更新要点。
 */
export type DreamOpKind = 'note-upsert' | 'note-archive' | 'entry-supersede' | 'entry-archive' | 'entry-move' | 'entry-add' | 'entry-confirm' | 'core-set'

/** 改之前的样子：撤销时照它恢复。 */
export interface DreamOpBefore {
  readonly entry?: MemoryEntry
  readonly note?: MemoryNote | null
  /** 写笔记时并进去的条目原来的样子。 */
  readonly merged?: readonly MemoryEntry[]
  /** 要点原来的文字，和它是不是你改过的。 */
  readonly text?: string
  readonly userEdited?: boolean
}

/** 改之后的样子。 */
export interface DreamOpAfter {
  readonly note?: NoteDraft
  readonly status?: MemoryStatus
  /** 被哪一条替掉（条目 id）；是这一晚的发现替的就是空串，看 evidence。 */
  readonly by?: string
  readonly scopeKind?: MemoryScopeKind
  readonly scopeId?: string
  readonly entry?: { readonly type: MemoryType; readonly content: string; readonly source: MemoryEntry['source']; readonly sourceRef: string; readonly status: MemoryStatus }
  readonly text?: string
}

export interface DreamOp {
  readonly dreamId: string
  readonly seq: number
  readonly kind: DreamOpKind
  readonly scopeKind: MemoryScopeKind
  readonly scopeId: string
  /** 动的是哪条条目、哪页笔记；要点是空串。 */
  readonly ref: string
  readonly before: DreamOpBefore
  readonly after: DreamOpAfter
  readonly reason: string
  readonly evidence: readonly DreamEvidence[]
  /** 等你在问题里选了才做，不跟着整晚一起生效。 */
  readonly held: boolean
  readonly appliedAt: number | null
  readonly revertedAt: number | null
  /** 没做的原因（你没要、之后又改过）；做了的是空串。 */
  readonly skipped: string
}

/** 一晚的整理和它的每一处改动。 */
export interface DreamDetail {
  readonly dream: MemoryDream
  readonly ops: readonly DreamOp[]
}

/** 头几晚的结果都先给你看。 */
export const DREAM_PREVIEW_NIGHTS = 3
/** 一个范围一晚动了这么多比例以上的内容，不自动生效。 */
export const DREAM_HOLD_RATIO = 0.3
/** 动的条数少于这个数不算大改（小范围里并两三条就会过三成）。 */
export const DREAM_HOLD_MIN = 8

/** 这一晚要不要先给你看，和原因。 */
export function dreamHold(applied: number, scopes: readonly DreamScope[]): string {
  if (applied < DREAM_PREVIEW_NIGHTS) return t('头 {nights} 次整理先给你看，点了才生效', { nights: DREAM_PREVIEW_NIGHTS })
  const big = scopes.find((scope) => scope.touched >= DREAM_HOLD_MIN && scope.touched > scope.size * DREAM_HOLD_RATIO)
  return big === undefined ? '' : t('「{label}」这一次要动 {touched} 处，超过三成，先给你看', { label: big.label, touched: big.touched })
}

/** 一晚改了什么，一句话；没有要改的返回空串。 */
export function dreamChanges(stats: DreamStats): string {
  return [
    stats.notes > 0 ? t('写了 {notes} 页笔记', { notes: stats.notes }) : '',
    stats.merged > 0 ? t('并进 {merged} 条', { merged: stats.merged }) : '',
    stats.changed > 0 ? t('替掉、归档、挪走 {changed} 条', { changed: stats.changed }) : '',
    stats.added > 0 ? t('新记 {added} 条', { added: stats.added }) : '',
    stats.questions > 0 ? t('有 {questions} 件想跟你确认', { questions: stats.questions }) : '',
  ]
    .filter((part) => part !== '')
    .join(t('，'))
}

function plain(text: string): string {
  return text.replace(/[\s​]+/g, '').toLowerCase()
}

/** 出处里的原话在不在原文里（不算空白和大小写）。太短的原话不算数：三四个字到处都对得上。 */
export function quoteIn(quote: string, source: string): boolean {
  const needle = plain(quote)
  return needle.length >= 4 && plain(source).includes(needle)
}

/** 笔记目录里的一行。 */
export function noteIndexLine(note: Pick<MemoryNote, 'title' | 'description'>): string {
  return note.description === '' ? `- ${note.title}` : `- ${note.title}：${note.description}`
}

/** 笔记正文拆成一句句（空行不算）。 */
export function noteLines(body: string): readonly string[] {
  return body
    .split('\n')
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line !== '')
}

/**
 * 笔记正文给 bot 和模型看的样子：每句后面带上日期，拿不准的标出来。新旧说法不一样时看日期。
 * day 把时间换成“月-日”（时区由调用的一方定）。
 */
export function datedNoteLines(note: Pick<MemoryNote, 'body' | 'sources' | 'updatedAt'>, day: (time: number) => string): readonly string[] {
  const sources = new Map(note.sources.map((source) => [source.line, source]))
  return noteLines(note.body).map((line) => {
    const source = sources.get(line)
    return `${line}（${day(source?.at ?? note.updatedAt)}${source?.doubt === undefined ? '' : t('，拿不准')}）`
  })
}

/** 模型照抄笔记里的一句时可能连后面的日期一起抄回来：去掉它再比。 */
export function undated(line: string): string {
  return line.replace(/（\d{1,2}-\d{1,2}(，[^（）]*)?）\s*$/, '').trim()
}

/** 几句话拼成笔记正文。 */
export function noteBody(lines: readonly string[]): string {
  return lines.map((line) => `- ${line}`).join('\n')
}
