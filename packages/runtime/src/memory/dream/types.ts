import type { DreamEvidence, DreamRejection, MemoryScopeKind, MemoryType } from 'pod-domain'

/** 一份要回放的记录里的一句话。 */
export interface RecordLine {
  /** 给模型看的编号：m1、m2…… */
  readonly at: string
  /** 这句话在哪：message:<id>、session:<id>、task:<id>。 */
  readonly ref: string
  /** 谁说的：你、bot、工具结果、dsh-bot 自己写的记录。 */
  readonly by: 'owner' | 'bot' | 'tool' | 'pod'
  readonly name: string
  /** 哪个 bot 说的，或者哪个 bot 的会话里的工具结果。 */
  readonly botId: string | null
  readonly text: string
}

/** 一份要回放的记录：一段对话，或者一件事（交代、群里的话、各成员的会话、汇报）。 */
export interface DreamRecord {
  readonly id: string
  readonly kind: 'chat' | 'task'
  readonly title: string
  /** 记录里最后一句的时间。 */
  readonly time: number
  /** 这件事在哪个群里：群里定的事归它。单聊、没进群的任务是 null。 */
  readonly roomId: string | null
  /** 单聊是和哪个 bot 聊的；一个 bot 自己干的任务是它。 */
  readonly botId: string | null
  /** 读过网页或 X 的会话：里面的话不能直接变成“关于你”或群里的规矩。 */
  readonly tainted: boolean
  readonly lines: readonly RecordLine[]
  /** 读完以后把这些水位往前推，下次不再读。 */
  readonly marks: readonly Mark[]
}

export interface Mark {
  readonly key: string
  readonly value: number
}

/** confirm 证实了已有的一条；contradict 和已有的一条相反（被纠正了）；new 新的事。 */
export type FindingKind = 'new' | 'confirm' | 'contradict'

/** 回放找到的一条发现：出处已经在原文里查过，家也定好了。 */
export interface Finding {
  readonly id: string
  readonly kind: FindingKind
  readonly scopeKind: MemoryScopeKind
  readonly scopeId: string
  readonly type: MemoryType
  readonly content: string
  readonly evidence: DreamEvidence
  /** 原话是你说的。 */
  readonly byOwner: boolean
  /** 关于你、但不是你亲口说的：只能当待确认的条目，不进笔记和要点。 */
  readonly pending: boolean
  /** 被证实或被纠正的那条条目。 */
  readonly target: string | null
  readonly time: number
  readonly recordId: string
}

/** 一步模型调用用掉的 token。 */
export interface Spent {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cost: number
}

export const NOTHING_SPENT: Spent = { inputTokens: 0, outputTokens: 0, cost: 0 }

export function addSpent(left: Spent, right: Spent): Spent {
  return { inputTokens: left.inputTokens + right.inputTokens, outputTokens: left.outputTokens + right.outputTokens, cost: left.cost + right.cost }
}

/** 一步的结果里都带着：没过核对的和原因、用掉多少。 */
export interface StepOutcome {
  readonly rejected: readonly DreamRejection[]
  readonly spent: Spent
}

/** 做到一半存下来的进度：读完了哪几份记录、找到了什么。停下来以后接着做。 */
export interface DreamWork {
  /** 进度的格式：和现在的不一样（旧版本存的）就丢掉，从头再读。 */
  readonly version: number
  readonly done: readonly string[]
  readonly findings: readonly Finding[]
  readonly rejected: readonly DreamRejection[]
  readonly marks: readonly Mark[]
  /** 这一次没读成的记录原本要推的水位：同一个聊天室、同一类任务的水位只能推到它前面，下次接着读它。 */
  readonly failed: readonly Mark[]
  /** 这一次没读成的记录有几份（统计“读了几份”时不算它们）。 */
  readonly missed: number
  readonly spent: Spent
  /** 只整理这几个范围（页面上点某个范围的“现在整理”）；空的是全部。 */
  readonly only: readonly { readonly kind: MemoryScopeKind; readonly id: string }[]
}

export const WORK_VERSION = 2

export const EMPTY_WORK: DreamWork = { version: WORK_VERSION, done: [], findings: [], rejected: [], marks: [], failed: [], missed: 0, spent: NOTHING_SPENT, only: [] }

/**
 * 读完以后各个水位推到哪：一份记录没读成，它那个水位（同一个聊天室、同一类任务）只推到它前面，后面读成的也不算，下次从它接着读。
 */
export function settledMarks(marks: readonly Mark[], failed: readonly Mark[]): ReadonlyMap<string, number> {
  const floor = new Map<string, number>()
  for (const mark of failed) floor.set(mark.key, Math.min(floor.get(mark.key) ?? Number.POSITIVE_INFINITY, mark.value))
  const latest = new Map<string, number>()
  for (const mark of marks) {
    if (mark.value >= (floor.get(mark.key) ?? Number.POSITIVE_INFINITY)) continue
    latest.set(mark.key, Math.max(latest.get(mark.key) ?? 0, mark.value))
  }
  return latest
}
