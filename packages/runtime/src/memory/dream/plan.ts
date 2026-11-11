import {
  CORE_LIMITS,
  NOTE_BODY_MAX,
  NOTE_DESCRIPTION_MAX,
  NOTE_LINE_MAX,
  NOTE_TITLE_MAX,
  estimateTokens,
  isCredentialMemory,
  isInstructionLike,
  localDate,
  noteBody,
  noteLines,
  sameMemory,
  t,
  textUnits,
  truncate,
  undated,
  type CoreMemory,
  type DreamEvidence,
  type DreamQuestion,
  type DreamRejection,
  type DreamScope,
  type MemoryEntry,
  type MemoryNote,
  type MemoryScopeKind,
  type NoteDraft,
} from 'pod-domain'
import type { NewDreamOp } from 'pod-store'
import { consolidatePrompt, parsePlan, type RawLine, type RawNote } from './consolidate.ts'
import { organizePrompt, parseOrganize } from './organize.ts'
import type { Finding } from './types.ts'

/** 一轮给模型看多少条没整理的条目；多的下一轮接着整理。 */
export const ROUND_ENTRIES = 40
/** 一轮最多带多少条发现。 */
const ROUND_FINDINGS = 40
/** 一轮最多往要点里加几句；要点一共最多几句、每句多少字。 */
const POINTS_MAX = 8
const CORE_LINES_MAX = 12
const POINT_LINE_MAX = 120
/** 一句话最多留几条原话当出处；一页最多链接几页。 */
const EVIDENCE_KEEP = 4
const LINKS_MAX = 6

function unbullet(line: string): string {
  return line.replace(/^\s*[-*]\s+/, '').trim()
}

export interface ScopeRef {
  readonly kind: MemoryScopeKind
  readonly id: string
  readonly label: string
}

/** 笔记里的一句话，和它的来历。 */
interface Line {
  readonly text: string
  readonly entries: readonly string[]
  readonly evidence: readonly DreamEvidence[]
  /** 什么时候说的、记的。 */
  readonly at: number
  readonly checkedAt?: number
  readonly doubt?: string
  readonly replaces?: string
}

interface NoteState {
  readonly id: string
  readonly alias: string
  readonly existing: MemoryNote | null
  title: string
  description: string
  lines: readonly Line[]
  links: readonly string[]
  added: number
  removed: number
  /** 对着记录核对过、存了疑的句子数。 */
  checked: number
  /** 别的页并进来了几页。 */
  absorbed: number
  renamed: boolean
  linked: boolean
  /** 这页并进了哪一页；并走了就收掉。 */
  into: string | null
}

/** 一处改动，还没编号。 */
export type OpBody = Omit<NewDreamOp, 'dreamId' | 'seq'>

interface Ask {
  readonly text: string
  readonly options: readonly { readonly label: string; readonly ops: readonly OpBody[] }[]
}

export interface PlannerInput {
  readonly scope: ScopeRef
  readonly core: CoreMemory
  readonly notes: readonly MemoryNote[]
  /** 这个范围在用的条目，不含账号密码类的和私密的。 */
  readonly entries: readonly MemoryEntry[]
  /** 已经并进笔记的条目：笔记里一句话是谁说的、什么时候记的要看它们。 */
  readonly merged: readonly MemoryEntry[]
  /** 上次整理到了什么时候：之后新记的、改过的条目才拿去整理；0 是全部重看。 */
  readonly since: number
  /** 待确认的条目：发现里有你的原话证实了的，转成生效。 */
  readonly pending: readonly MemoryEntry[]
  readonly findings: readonly Finding[]
  readonly guide: string
  readonly timezone: string
  readonly newId: (prefix: 'mem' | 'note') => string
}

function grams(text: string): ReadonlySet<string> {
  const chars = [...text.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase()]
  const set = new Set<string>()
  for (let index = 0; index < chars.length - 1; index += 1) set.add(`${chars[index]}${chars[index + 1]}`)
  return set
}

/**
 * 一句话和它的出处对不对得上：句子里的数字、路径、命令、英文名必须在出处里原样出现；用词也要有相当一部分来自出处。
 * 拦的是整句编出来的话和写错的数字、命令；意思改反了这种靠预览和出处来查。
 */
export function grounded(line: string, sources: string): boolean {
  const hay = sources.toLowerCase()
  const hard = (line.match(/[A-Za-z0-9][A-Za-z0-9_./:@-]+/g) ?? []).map((token) => token.replace(/[./:@-]+$/, '').toLowerCase()).filter((token) => token.length >= 2)
  if (hard.some((token) => !hay.includes(token))) return false
  const pairs = grams(line)
  if (pairs.size === 0) return true
  const have = grams(sources)
  let shared = 0
  for (const pair of pairs) if (have.has(pair)) shared += 1
  if (shared / pairs.size >= 0.3) return true
  const chars = [...new Set([...line.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase()])]
  return chars.length > 0 && chars.filter((char) => hay.includes(char)).length / chars.length >= 0.6
}

function unique<T>(items: readonly T[]): readonly T[] {
  return [...new Set(items)]
}

/**
 * 一个范围这一晚的整理：拿模型交回的新的一版逐条核对，定下每一处改动。只在内存里算，不写库。
 * 守的线：每句话要有出处、和出处对得上；你亲手写的条目只能原样用、不替不归档；你改过的笔记和要点不动；
 * 账号密码类的不进笔记；说法冲突时你的原话压过 bot 的推断，同级的新的盖旧的，分不清就变成问题留给你。
 * 回放时指着笔记里某一句说的（证实、纠正、存疑）在这里落到那一句上；最后整理员那一趟只挪句子、改标题、补链接，一句不丢。
 */
export class ScopePlanner {
  private readonly input: PlannerInput
  private readonly entries: readonly MemoryEntry[]
  private readonly alias = new Map<string, MemoryEntry>()
  private readonly aliasOf = new Map<string, string>()
  private readonly findings = new Map<string, Finding>()
  private readonly notes: NoteState[] = []
  private readonly merged = new Map<string, string>()
  private readonly replaced = new Map<string, { readonly by: string; readonly why: string; readonly evidence: readonly DreamEvidence[] }>()
  private readonly dropped = new Map<string, string>()
  private readonly asked = new Set<string>()
  private readonly offered = new Set<string>()
  private readonly cited = new Set<string>()
  /** 纠正了笔记里哪一句的发现：新的那句写进笔记时记下它替了谁。 */
  private readonly replacing = new Map<string, string>()
  /** 和笔记里你说过的话不一样、又不是你亲口说的发现：不动笔记，记成待确认的条目，标明和哪一页对不上。 */
  private readonly disputed = new Map<string, string>()
  private readonly asks: Ask[] = []
  private readonly rejected: DreamRejection[] = []
  private readonly confirmed: MemoryEntry[] = []
  /** 要点，一行一句：原来的照原样留着，整理只在后面加，明说过时的才去掉。 */
  private core: readonly string[]
  private coreEvidence: readonly DreamEvidence[] = []
  private coreTouched = false
  private rounds = 0
  private batch: readonly string[] = []
  private readonly shown = new Set<string>()
  private shownBatch: readonly string[] = []

  constructor(input: PlannerInput) {
    this.input = input
    this.core = input.core.text
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.trim() !== '')
    this.entries = [...input.entries].filter((entry) => !entry.pinned && entry.updatedAt > input.since).sort((left, right) => left.updatedAt - right.updatedAt)
    this.entries.forEach((entry, index) => {
      this.alias.set(`e${index + 1}`, entry)
      this.aliasOf.set(entry.id, `e${index + 1}`)
    })
    const merged = new Map(input.merged.map((entry) => [entry.id, entry]))
    const ids = new Set(input.notes.map((note) => note.id))
    input.notes.forEach((note, index) => {
      const sources = new Map(note.sources.map((source) => [source.line, source]))
      this.notes.push({
        id: note.id,
        alias: `n${index + 1}`,
        existing: note,
        title: note.title,
        description: note.description,
        lines: noteLines(note.body).map((text) => {
          const source = sources.get(text)
          const recorded = (source?.entries ?? []).map((id) => merged.get(id)?.createdAt ?? 0).reduce((latest, time) => Math.max(latest, time), 0)
          return {
            text,
            entries: source?.entries ?? [],
            evidence: source?.evidence ?? [],
            at: source?.at ?? (recorded > 0 ? recorded : note.updatedAt),
            ...(source?.checkedAt === undefined ? {} : { checkedAt: source.checkedAt }),
            ...(source?.doubt === undefined ? {} : { doubt: source.doubt }),
            ...(source?.replaces === undefined ? {} : { replaces: source.replaces }),
          }
        }),
        links: note.links.filter((id) => ids.has(id)),
        added: 0,
        removed: 0,
        checked: 0,
        absorbed: 0,
        renamed: false,
        linked: false,
        into: null,
      })
    })
    for (const finding of input.findings) {
      if (finding.pending) continue
      // 发现里说的和已有的一条一字不差：不是新的，不用再整理一遍。
      if (finding.kind === 'new' && input.entries.some((entry) => sameMemory(entry.content, finding.content))) continue
      // 指着笔记里某一句说的：证实、存疑落到那一句上就完了；纠正要看压不压得过。
      if (finding.line !== null && this.settle(finding, merged)) continue
      // 证实、存疑只是给已有的记忆做记号，不是要写进笔记的新内容。
      if (finding.kind === 'doubt' || (finding.kind === 'confirm' && finding.line !== null)) continue
      this.findings.set(finding.id, finding)
    }
    // 待确认的条目有你的原话证实了：转成生效。
    for (const finding of input.findings) {
      if (finding.kind !== 'confirm' || !finding.byOwner || finding.target === null) continue
      const target = input.pending.find((entry) => entry.id === finding.target)
      if (target !== undefined && !this.confirmed.includes(target)) this.confirmed.push(target)
    }
    // 记录里纠正过的：新说法压得过旧的那条，就直接替掉，不靠模型记得写。
    for (const finding of this.findings.values()) {
      if (finding.kind !== 'contradict' || finding.target === null) continue
      const target = input.entries.find((entry) => entry.id === finding.target)
      if (target !== undefined && !target.pinned) this.replace(target, finding.id, t('记录里纠正过'))
    }
    // 白天记的时候就说了是来改哪一条的：照同样的规矩替。
    for (const entry of this.entries) {
      const target = entry.supersedes === null ? undefined : input.entries.find((candidate) => candidate.id === entry.supersedes)
      if (target !== undefined && !target.pinned) this.replace(target, entry.id, t('记的时候就说是来改这条的'))
    }
  }

  private day(time: number): string {
    return localDate(time, this.input.timezone).slice(5)
  }

  /** 给模型看的一句：后面带日期，拿不准的标出来。 */
  private shownLine(line: Line): string {
    return `${line.text}（${this.day(line.at)}${line.doubt === undefined ? '' : t('，拿不准')}）`
  }

  /**
   * 回放时指着笔记里某一句的发现落到那一句上。返回 true 是处理完了（不用再给模型看）。
   * 证实：记下最近核对的时间和原话。存疑：标成拿不准。
   * 纠正：这页你没改过、而且新说法压得过（是你亲口说的，或者原来那句本来就不是你说的），就把原来那句去掉，新的那句交给模型放进笔记；
   * 压不过（原来那句是你说的，新的不是）就不动笔记，新说法记成待确认的条目。
   */
  private settle(finding: Finding, merged: ReadonlyMap<string, MemoryEntry>): boolean {
    const note = this.notes.find((candidate) => candidate.id === finding.line?.noteId)
    const at = note === undefined ? -1 : note.lines.findIndex((line) => sameMemory(line.text, finding.line?.text ?? ''))
    const line = note?.lines[at]
    if (note === undefined || line === undefined) return finding.kind !== 'contradict'
    if (note.existing?.userEdited === true) {
      if (finding.kind === 'contradict') this.refuse(finding.content, t('笔记「{title}」你改过，整理时不动；记录里有不一样的说法，另记一条', { title: note.title }))
      return finding.kind !== 'contradict'
    }
    const swap = (next: Line | undefined): void => {
      note.lines = next === undefined ? note.lines.filter((_, index) => index !== at) : note.lines.map((item, index) => (index === at ? next : item))
    }
    const evidence = [...line.evidence.filter((item) => item.quote !== finding.evidence.quote), finding.evidence].slice(-EVIDENCE_KEEP)
    if (finding.kind === 'confirm') {
      swap({ text: line.text, entries: line.entries, evidence, at: line.at, checkedAt: finding.time, ...(line.replaces === undefined ? {} : { replaces: line.replaces }) })
      note.checked += 1
      return true
    }
    if (finding.kind === 'doubt') {
      swap({ ...line, evidence, doubt: truncate(finding.content, 120) })
      note.checked += 1
      return true
    }
    const ownerBacked = line.evidence.some((item) => item.by === 'owner') || line.entries.some((id) => merged.get(id)?.source === 'owner')
    if (finding.byOwner || !ownerBacked) {
      swap(undefined)
      note.removed += 1
      this.replacing.set(finding.id, line.text)
      this.dropPoint(line.text)
      return false
    }
    this.disputed.set(finding.id, note.title)
    return true
  }

  /** 一句话被纠正、替掉了：要点里一模一样的那句也跟着去掉（你改过的要点不动），不然每段会话开头还带着旧说法。 */
  private dropPoint(text: string): void {
    if (this.input.core.userEdited) return
    const next = this.core.filter((line) => !sameMemory(unbullet(line), text))
    if (next.length === this.core.length) return
    this.core = next
    this.coreTouched = true
  }

  private remaining(): readonly MemoryEntry[] {
    return this.entries.filter((entry) => !this.merged.has(entry.id) && !this.replaced.has(entry.id) && !this.dropped.has(entry.id) && !this.asked.has(entry.id) && !this.offered.has(entry.id))
  }

  /** 这个范围整理到了什么时候：给模型看过的最后一条的时间；一条都没看就还是原来的。 */
  seen(): number {
    return this.entries.filter((entry) => this.offered.has(entry.id)).reduce((latest, entry) => Math.max(latest, entry.updatedAt), this.input.since)
  }

  private waiting(): readonly Finding[] {
    return [...this.findings.values()].filter((finding) => !this.shown.has(finding.id))
  }

  /** 还有没有要整理的：没看过的条目，或者还没给模型看过的发现。 */
  hasWork(): boolean {
    return this.remaining().length > 0 || this.waiting().length > 0
  }

  /** 这一轮没成（模型的回答读不出来，或者模型服务出错）：给它看的条目和发现不算看过，下次整理再拿出来。 */
  giveBack(why: string): void {
    for (const id of this.batch) this.offered.delete(id)
    for (const id of this.shownBatch) this.shown.delete(id)
    this.refuse(this.input.scope.label, why)
  }

  private pages(): readonly NoteState[] {
    return this.notes.filter((note) => note.into === null)
  }

  /** 这一轮给模型的输入；没有要整理的返回 undefined。 */
  prompt(): string | undefined {
    if (!this.hasWork()) return undefined
    const batch = this.remaining().slice(0, ROUND_ENTRIES)
    for (const entry of batch) this.offered.add(entry.id)
    this.batch = batch.map((entry) => entry.id)
    const findings = this.waiting().slice(0, ROUND_FINDINGS)
    for (const finding of findings) this.shown.add(finding.id)
    this.shownBatch = findings.map((finding) => finding.id)
    this.rounds += 1
    return consolidatePrompt({
      label: this.input.scope.label,
      guide: this.input.guide,
      core: { ...this.input.core, text: this.core.join('\n') },
      notes: this.pages().map((note) => ({ alias: note.alias, title: note.title, description: note.description, lines: note.lines.map((line) => this.shownLine(line)), locked: note.existing?.userEdited === true })),
      pinned: this.input.entries.filter((entry) => entry.pinned),
      entries: batch.map((entry) => ({ alias: this.aliasOf.get(entry.id) ?? '', entry })),
      findings,
      timezone: this.input.timezone,
    })
  }

  private refuse(what: string, why: string): void {
    this.rejected.push({ what: truncate(what, 80), why })
  }

  private free(entry: MemoryEntry): boolean {
    return !this.replaced.has(entry.id) && !this.dropped.has(entry.id) && !this.asked.has(entry.id)
  }

  private supersede(entry: MemoryEntry, by: string, why: string, evidence: readonly DreamEvidence[]): OpBody {
    return {
      kind: 'entry-supersede',
      scopeKind: this.input.scope.kind,
      scopeId: this.input.scope.id,
      ref: entry.id,
      before: { entry },
      after: { status: 'superseded', by },
      reason: why,
      evidence,
      held: false,
    }
  }

  /** 旧的一条被新的替掉：新的压得过旧的才自动替，压不过的问你。by 是条目的编号或发现的编号。 */
  private replace(old: MemoryEntry, by: string, why: string): void {
    if (this.replaced.has(old.id) || this.asked.has(old.id)) return
    const entry = this.alias.get(by) ?? this.input.entries.find((candidate) => candidate.id === by)
    const finding = this.findings.get(by)
    if (entry === undefined && finding === undefined) return this.refuse(old.content, t('说不出被哪一条替掉'))
    if (entry?.id === old.id) return
    const newer = entry === undefined ? { owner: finding?.byOwner === true, time: finding?.time ?? 0, text: finding?.content ?? '', evidence: finding === undefined ? [] : [finding.evidence] } : { owner: entry.source === 'owner', time: entry.createdAt, text: entry.content, evidence: [] }
    const strong = (newer.owner ? 2 : 1) > (old.source === 'owner' ? 2 : 1) || ((newer.owner ? 2 : 1) === (old.source === 'owner' ? 2 : 1) && newer.time >= old.createdAt)
    const reason = why === '' ? t('被「{text}」替了', { text: truncate(newer.text, 40) }) : t('{why}：被「{text}」替了', { why, text: truncate(newer.text, 40) })
    if (strong && !old.userEdited) {
      this.replaced.set(old.id, { by: entry?.id ?? '', why: reason, evidence: newer.evidence })
      this.dropPoint(old.content)
      return
    }
    this.asked.add(old.id)
    if (entry !== undefined) this.asked.add(entry.id)
    this.asks.push({
      text: t(old.userEdited ? '「{old}」是你亲手写的，后来又有一条说法不一样：「{fresh}」。以哪条为准？' : '「{old}」是你说的，后来又有一条说法不一样：「{fresh}」。以哪条为准？', { old: truncate(old.content, 60), fresh: truncate(newer.text, 60) }),
      options: [
        { label: t('用后一条'), ops: [{ ...this.supersede(old, entry?.id ?? '', reason, newer.evidence), held: true }] },
        { label: t('留着前一条'), ops: entry === undefined ? [] : [{ ...this.supersede(entry, old.id, t('你定了以「{text}」为准', { text: truncate(old.content, 40) }), []), held: true }] },
      ],
    })
  }

  /** 核对一句话：出处要认得、和出处对得上；返回过了的那一句，或者 undefined（原因记进没过的清单）。 */
  private line(raw: RawLine, max: number, allowNotes: boolean): Line | undefined {
    // 模型可能照着笔记的样子把日期也写在句子后面：去掉，日期由出处定。
    const text = undated(raw.text)
    if (text === '') return undefined
    if (textUnits(text) > max) return void this.refuse(text, t('一句话太长'))
    if (isCredentialMemory(text)) return void this.refuse(t('一条账号、密码类的内容（不显示）'), t('账号、密码这类的不进笔记和要点'))
    const entries: MemoryEntry[] = []
    const findings: Finding[] = []
    const pages: NoteState[] = []
    for (const name of raw.from) {
      const entry = this.alias.get(name)
      const finding = this.findings.get(name)
      const page = allowNotes ? this.pages().find((note) => note.alias === name) : undefined
      if (entry !== undefined && this.free(entry) && (!entry.userEdited || sameMemory(entry.content, text) || allowNotes)) entries.push(entry)
      else if (finding !== undefined) findings.push(finding)
      else if (page !== undefined) pages.push(page)
    }
    if (entries.length + findings.length + pages.length === 0) return void this.refuse(text, t('没有出处，或者出处是你亲手写的条目却改了它的字'))
    const sources = [...entries.map((entry) => entry.content), ...findings.flatMap((finding) => [finding.content, finding.evidence.quote]), ...pages.flatMap((page) => page.lines.map((line) => line.text))].join('\n')
    if (!grounded(text, sources)) return void this.refuse(text, t('和它写的出处对不上'))
    for (const finding of findings) this.cited.add(finding.id)
    const at = [...entries.map((entry) => entry.createdAt), ...findings.map((finding) => finding.time)].reduce((latest, time) => Math.max(latest, time), 0)
    const replaces = findings.map((finding) => this.replacing.get(finding.id)).find((old) => old !== undefined)
    return {
      text,
      entries: entries.map((entry) => entry.id),
      evidence: findings.map((finding) => finding.evidence).slice(0, EVIDENCE_KEEP),
      at: at > 0 ? at : this.input.core.updatedAt,
      ...(replaces === undefined ? {} : { replaces }),
    }
  }

  private page(raw: RawNote): void {
    const lines = raw.lines
    const known = this.pages().find((note) => note.alias === raw.id) ?? (raw.title === '' ? undefined : this.pages().find((note) => sameMemory(note.title, raw.title)))
    if (known === undefined && raw.title === '') return lines.forEach((line) => this.refuse(line.text, t('新开的一页没有标题')))
    if (known?.existing?.userEdited === true) return lines.forEach((line) => this.refuse(line.text, t('笔记「{title}」你改过，整理时不动；要加可以在页面上自己加', { title: known.title })))
    const note: NoteState = known ?? {
      id: this.input.newId('note'),
      alias: `n${this.notes.length + 1}`,
      existing: null,
      title: truncate(raw.title, NOTE_TITLE_MAX),
      description: truncate(raw.description, NOTE_DESCRIPTION_MAX),
      lines: [],
      links: [],
      added: 0,
      removed: 0,
      checked: 0,
      absorbed: 0,
      renamed: false,
      linked: false,
      into: null,
    }
    for (const gone of raw.remove) {
      const at = note.lines.findIndex((line) => sameMemory(line.text, undated(gone.text)))
      if (at < 0 || gone.why === '') continue
      this.dropPoint(note.lines[at]?.text ?? '')
      note.lines = note.lines.filter((_, index) => index !== at)
      note.removed += 1
    }
    let size = textUnits(noteBody(note.lines.map((line) => line.text)))
    for (const item of lines) {
      if (note.lines.some((line) => sameMemory(line.text, undated(item.text)))) continue
      const checked = this.line(item, NOTE_LINE_MAX, false)
      if (checked === undefined) continue
      if (size + textUnits(checked.text) > NOTE_BODY_MAX) {
        this.refuse(checked.text, t('笔记「{title}」写满了，这句等下次另开一页', { title: note.title }))
        continue
      }
      const fresh = checked.entries.filter((id) => !this.merged.has(id))
      for (const id of fresh) this.merged.set(id, note.id)
      note.lines = [...note.lines, checked]
      note.added += 1
      size += textUnits(checked.text)
    }
    if (known !== undefined && raw.description !== '' && note.added > 0) note.description = truncate(raw.description, NOTE_DESCRIPTION_MAX)
    if (known === undefined && note.lines.length > 0) this.notes.push(note)
  }

  /** 收下模型这一轮交回的结果。先处理替掉、归档和拿不准的，剩下的条目才能并进笔记。 */
  absorb(value: unknown): boolean {
    const plan = parsePlan(value)
    if (plan === undefined) {
      this.giveBack(t('模型交回的不是能读的结果，这一轮没有用，这些条目下次再整理'))
      return false
    }
    for (const item of plan.replaced) {
      const old = this.alias.get(item.old)
      if (old === undefined) continue
      if (old.pinned) this.refuse(old.content, t('置顶的条目整理时不动'))
      else this.replace(old, item.by, item.why)
    }
    for (const item of plan.dropped) {
      const entry = this.alias.get(item.id)
      if (entry === undefined || !this.free(entry)) continue
      if (entry.userEdited || entry.source === 'owner') this.refuse(entry.content, t('你说的、你写的不自动归档'))
      else this.dropped.set(entry.id, item.why === '' ? t('一次性的细节') : item.why)
    }
    for (const item of plan.questions) {
      const about = item.about.map((name) => this.alias.get(name)).filter((entry): entry is MemoryEntry => entry !== undefined && this.free(entry))
      const [first, second] = about
      for (const entry of about) this.asked.add(entry.id)
      this.asks.push({
        text: item.text,
        options:
          first === undefined || second === undefined
            ? []
            : [
                { label: t('留「{text}」', { text: truncate(first.content, 16) }), ops: first.userEdited && second.userEdited ? [] : [{ ...this.supersede(second, first.id, t('你定了留另一条'), []), held: true }] },
                { label: t('留「{text}」', { text: truncate(second.content, 16) }), ops: [{ ...this.supersede(first, second.id, t('你定了留另一条'), []), held: true }] },
              ],
      })
    }
    for (const note of plan.notes) this.page(note)
    if (plan.points.length + plan.dropPoints.length > 0) {
      if (this.input.core.userEdited) this.refuse([...plan.points, ...plan.dropPoints].map((line) => line.text).join('；'), t('要点你改过，整理时不动；要改可以在页面上自己改'))
      else {
        for (const gone of plan.dropPoints) {
          const at = this.core.findIndex((line) => sameMemory(unbullet(line), gone.text))
          if (at < 0 || gone.why === '') continue
          this.core = this.core.filter((_, index) => index !== at)
          this.coreTouched = true
        }
        for (const raw of plan.points.slice(0, POINTS_MAX)) {
          if (this.core.some((line) => sameMemory(unbullet(line), undated(raw.text)))) continue
          const line = this.line(raw, POINT_LINE_MAX, true)
          if (line === undefined) continue
          const next = [...this.core, `- ${line.text}`]
          if (next.length > CORE_LINES_MAX || estimateTokens(next.join('\n')) > CORE_LIMITS[this.input.scope.kind]) {
            this.refuse(line.text, t('要点满了，这句没加进去；可以在页面上自己调'))
            continue
          }
          this.core = next
          this.coreEvidence = [...this.coreEvidence, ...line.evidence]
          this.coreTouched = true
        }
      }
    }
    return true
  }

  /**
   * 整理员那一趟的输入：这个范围至少有两页、这一次又动过笔记（或者你点了这个范围的“现在整理”）才做。不用做返回 undefined。
   */
  organizePrompt(force: boolean): string | undefined {
    const pages = this.pages().filter((note) => note.lines.length > 0)
    if (pages.length < 2) return undefined
    if (!force && !pages.some((note) => note.added + note.removed > 0)) return undefined
    const aliasOf = new Map(pages.map((note) => [note.id, note.alias]))
    return organizePrompt(
      this.input.scope.label,
      pages.map((note) => ({
        alias: note.alias,
        title: note.title,
        description: note.description,
        lines: note.lines.map((line) => line.text),
        locked: note.existing?.userEdited === true,
        links: note.links.flatMap((id) => aliasOf.get(id) ?? []),
      })),
    )
  }

  /**
   * 收下整理员的安排。合并：把一页的句子连同出处原样搬进另一页（一样的句子只留一句、出处并在一起），原来那页收掉，指向它的链接改指新的一页；
   * 改名、补链接只动标题、说明和链接。你改过的页不参加。一句话都不改、不丢。
   */
  organize(value: unknown): boolean {
    const plan = parseOrganize(value)
    if (plan === undefined) {
      this.refuse(this.input.scope.label, t('收拾笔记那一步模型交回的不是能读的结果，这一次没有收拾'))
      return false
    }
    const find = (alias: string): NoteState | undefined => this.pages().find((note) => note.alias === alias)
    for (const item of plan.merge) {
      const from = find(item.from)
      const into = find(item.into)
      if (from === undefined || into === undefined || from === into) continue
      if (from.existing?.userEdited === true || into.existing?.userEdited === true) {
        this.refuse(from.title, t('你改过的笔记整理时不合并'))
        continue
      }
      const extra = from.lines.filter((line) => !into.lines.some((have) => sameMemory(have.text, line.text)))
      if (textUnits(noteBody([...into.lines, ...extra].map((line) => line.text))) > NOTE_BODY_MAX) {
        this.refuse(from.title, t('「{from}」并进「{into}」会超过一页的长度，没有并', { from: from.title, into: into.title }))
        continue
      }
      into.lines = [
        ...into.lines.map((have) => {
          const twin = from.lines.find((line) => sameMemory(line.text, have.text))
          return twin === undefined ? have : { ...have, entries: unique([...have.entries, ...twin.entries]), evidence: [...have.evidence, ...twin.evidence].slice(0, EVIDENCE_KEEP), at: Math.max(have.at, twin.at) }
        }),
        ...extra,
      ]
      into.absorbed += 1
      into.links = unique([...into.links, ...from.links]).filter((id) => id !== into.id && id !== from.id).slice(0, LINKS_MAX)
      from.into = into.id
      for (const [entryId, noteId] of this.merged) if (noteId === from.id) this.merged.set(entryId, into.id)
      for (const note of this.pages()) {
        if (!note.links.includes(from.id)) continue
        note.links = unique(note.links.map((id) => (id === from.id ? into.id : id))).filter((id) => id !== note.id)
        note.linked = true
      }
    }
    for (const item of plan.rename) {
      const note = find(item.id)
      if (note === undefined || note.existing?.userEdited === true) continue
      const title = truncate(item.title, NOTE_TITLE_MAX)
      const description = truncate(item.description, NOTE_DESCRIPTION_MAX)
      const fine = (text: string): boolean => !isCredentialMemory(text) && !isInstructionLike(text)
      if (title !== '' && title !== note.title && fine(title) && !this.pages().some((other) => other !== note && sameMemory(other.title, title))) {
        note.title = title
        note.renamed = true
      }
      if (description !== '' && description !== note.description && fine(description)) {
        note.description = description
        note.renamed = true
      }
    }
    for (const item of plan.links) {
      const note = find(item.id)
      if (note === undefined || note.existing?.userEdited === true) continue
      const targets = item.to.flatMap((alias) => find(alias)?.id ?? []).filter((id) => id !== note.id)
      const next = unique([...note.links, ...targets]).slice(0, LINKS_MAX)
      if (next.length === note.links.length) continue
      note.links = next
      note.linked = true
    }
    return true
  }

  private draft(note: NoteState): NoteDraft {
    return {
      title: note.title,
      description: note.description,
      body: noteBody(note.lines.map((line) => line.text)),
      links: note.links,
      sources: note.lines.map((line) => ({
        line: line.text,
        entries: line.entries,
        evidence: line.evidence,
        at: line.at,
        ...(line.checkedAt === undefined ? {} : { checkedAt: line.checkedAt }),
        ...(line.doubt === undefined ? {} : { doubt: line.doubt }),
        ...(line.replaces === undefined ? {} : { replaces: line.replaces }),
      })),
    }
  }

  /** 一页这一次怎么动的，一句话。 */
  private changes(note: NoteState, merged: number): string {
    return [
      note.existing === null ? t('新开的一页') : '',
      note.added > 0 ? t('加了 {count} 句', { count: note.added }) : '',
      note.removed > 0 ? t('去掉 {count} 句', { count: note.removed }) : '',
      note.checked > 0 ? t('对着记录核对了 {count} 句', { count: note.checked }) : '',
      note.absorbed > 0 ? t('并进来 {count} 页', { count: note.absorbed }) : '',
      note.renamed ? t('改了标题或说明') : '',
      note.linked ? t('补了链接') : '',
      merged > 0 ? t('并进 {count} 条', { count: merged }) : '',
    ]
      .filter((part) => part !== '')
      .join(t('，'))
  }

  /** 这个范围定下来的改动、要问你的事、没过核对的。seq 从 from 起编。 */
  result(dreamId: string, from: number): { readonly ops: readonly NewDreamOp[]; readonly questions: readonly DreamQuestion[]; readonly rejected: readonly DreamRejection[]; readonly scope: DreamScope } {
    const { scope } = this.input
    const at = { scopeKind: scope.kind, scopeId: scope.id }
    const bodies: OpBody[] = []
    for (const entry of this.confirmed) {
      bodies.push({ kind: 'entry-confirm', ...at, ref: entry.id, before: { entry }, after: { status: 'active' }, reason: t('你的原话证实了'), evidence: this.input.findings.filter((finding) => finding.target === entry.id).map((finding) => finding.evidence), held: false })
    }
    let touchedNotes = 0
    for (const note of this.notes) {
      if (note.into !== null) {
        // 并进了别的页：原来就有的那页收掉（还搜得到），这一次新开又并走的不留。
        if (note.existing === null) continue
        touchedNotes += 1
        const into = this.notes.find((other) => other.id === note.into)
        bodies.push({ kind: 'note-archive', ...at, ref: note.id, before: { note: note.existing }, after: {}, reason: t('并进了笔记「{title}」', { title: into?.title ?? '' }), evidence: [], held: false })
        continue
      }
      if (note.added + note.removed + note.checked + note.absorbed === 0 && !note.renamed && !note.linked) continue
      if (note.existing !== null) touchedNotes += 1
      const merged = this.entries.filter((entry) => this.merged.get(entry.id) === note.id && !this.replaced.has(entry.id))
      bodies.push({
        kind: 'note-upsert',
        ...at,
        ref: note.id,
        before: { note: note.existing, merged },
        after: { note: this.draft(note) },
        reason: this.changes(note, merged.length),
        evidence: note.lines.flatMap((line) => line.evidence).slice(0, 12),
        held: false,
      })
    }
    for (const [id, info] of this.replaced) {
      const entry = this.input.entries.find((candidate) => candidate.id === id)
      if (entry !== undefined) bodies.push(this.supersede(entry, info.by, info.why, info.evidence))
    }
    for (const [id, why] of this.dropped) {
      const entry = this.entries.find((candidate) => candidate.id === id)
      if (entry !== undefined) bodies.push({ kind: 'entry-archive', ...at, ref: entry.id, before: { entry }, after: { status: 'archived' }, reason: why, evidence: [], held: false })
    }
    // 没被哪一页用上的发现不丢：记成一条条目，下次再整理。关于你又不是你亲口说的、和笔记里你说过的话对不上的，进待确认。
    // 已经有一模一样的条目，或者笔记里已经有这一句的，不再另记。
    const texts = [...[...this.input.entries, ...this.input.pending].map((entry) => entry.content), ...this.notes.flatMap((note) => note.lines.map((line) => line.text))]
    for (const finding of this.input.findings) {
      const disputed = this.disputed.get(finding.id)
      if (disputed === undefined && (finding.kind === 'confirm' || finding.kind === 'doubt' || this.cited.has(finding.id))) continue
      if (texts.some((content) => sameMemory(content, finding.content))) continue
      texts.push(finding.content)
      const waits = finding.pending || disputed !== undefined
      bodies.push({
        kind: 'entry-add',
        ...at,
        ref: this.input.newId('mem'),
        before: {},
        after: { entry: { type: finding.type, content: finding.content, source: finding.byOwner ? 'owner' : 'extracted', sourceRef: finding.evidence.ref, status: waits ? 'pending' : 'active' } },
        reason:
          disputed !== undefined
            ? t('和笔记「{title}」里你说过的一句不一样，又不是你亲口说的，等你确认', { title: disputed })
            : finding.pending
              ? t('从记录里看出来的，不是你亲口说的，等你确认')
              : t('记录里有，白天没记'),
        evidence: [finding.evidence],
        held: false,
      })
    }
    const text = this.core.join('\n')
    if (this.coreTouched && text !== this.input.core.text) {
      bodies.push({ kind: 'core-set', ...at, ref: '', before: { text: this.input.core.text, userEdited: this.input.core.userEdited }, after: { text }, reason: t('更新要点'), evidence: this.coreEvidence.slice(0, 12), held: false })
    }
    const ops: NewDreamOp[] = bodies.map((body, index) => ({ ...body, dreamId, seq: from + index }))
    const questions: DreamQuestion[] = this.asks.map((ask, index) => ({
      id: `${scope.kind}:${scope.id}:${index + 1}`,
      scopeKind: scope.kind,
      scopeId: scope.id,
      text: ask.text,
      options: [
        ...ask.options.map((option) => ({
          label: option.label,
          ops: option.ops.map((body) => {
            const seq = from + ops.length
            ops.push({ ...body, dreamId, seq })
            return seq
          }),
        })),
        { label: ask.options.length === 0 ? t('知道了') : t('都留着'), ops: [] },
      ],
      answer: null,
    }))
    return {
      ops,
      questions,
      rejected: this.rejected,
      scope: { ...scope, size: this.input.entries.length + this.input.notes.length, touched: this.merged.size + this.replaced.size + this.dropped.size + touchedNotes },
    }
  }
}
