import { MEMORY_TYPE_LABELS, isRecord, localDate, noteLines, type CoreMemory, type MemoryEntry, type MemoryScopeKind } from 'pod-domain'
import { flat } from './records.ts'
import type { Finding } from './types.ts'

/** 第二步的提示词：一个范围整合一次，交回新的一版，不写库。 */
export const CONSOLIDATE_SYSTEM = [
  '你在做“记忆整理”的第二步：把一个范围里零散的条目和今晚的发现，整理成几页主题笔记和一小段要点。以后的会话开头只带要点和笔记目录，所以要点要短，笔记要好找。',
  '你会拿到：这个范围现有的笔记（n 开头）、还没整理的条目（e 开头）、今晚从记录里找到的发现（f 开头）。',
  '怎么整理：',
  '1. 说同一件事的条目和发现并成一句，放进一页笔记。一页一个主题（比如“周报怎么写”“常用的服务器”），标题不超过 12 个字，description 用一句话说这页里有什么。',
  '2. 能放进现有笔记的就放进去：id 写它的编号，lines 只写要加的句子。没有合适的再开新的一页：id 写 new。',
  '3. 每句话都要写 from：它是从哪几条条目、哪几条发现来的（写编号）。没有出处的话不要写。不要编，不要推测，不要把两件不同的事合成一句含糊的话；名字、数字、路径、命令照原样留着。',
  '4. 标着“原样”的条目是用户亲手写的：要用就一个字不改地用。',
  '5. 两种说法不能都对时：有明确先后的（日期新的、标着“纠正”的发现），留新的，把旧的写进 replaced；分不清谁对，两条都不要并，写进 questions 问用户，不要猜。',
  '6. 一次性的细节、早就过期的状态写进 dropped，不并进笔记。拿不准有没有用的不要动它：不写它就是不动。',
  '7. points 是要点：这个范围里最要紧、每次都该知道的几句，最多 8 句，每句不超过 60 个字，同样写 from（条目、发现或笔记的编号）。没有特别要紧的就少写或不写。',
  '8. 笔记里原来的句子过时了、被新的说法替了，写进那页的 remove（text 照抄原句，why 写原因）。',
  '只输出一个 JSON 对象：',
  '{"notes":[{"id":"n1 或 new","title":"","description":"","lines":[{"text":"","from":["e1","f2"]}],"remove":[{"text":"","why":""}]}],"replaced":[{"old":"e3","by":"e5","why":""}],"dropped":[{"id":"e7","why":""}],"points":[{"text":"","from":["e1"]}],"questions":[{"text":"","about":["e2","e9"]}]}',
  '没有要做的那一项给空数组。',
].join('\n')

/** 各种范围默认“整理时留意什么”；你可以给每个 bot、每个群另写一句。 */
export const DEFAULT_GUIDES: Readonly<Record<MemoryScopeKind, string>> = {
  owner: '围绕用户这个人：偏好、规矩、身份、常用的服务和工具、在做的事。',
  bot: '围绕这个 bot 的职责：留能照着做的做法、命令和踩过的坑；一次性的数字不要。',
  room: '围绕这个群管的事：约定、决定、现状、待办、资料在哪。',
  team: '围绕这个团队的约定和分工。',
  task: '任务里值得留的做法和结论。',
  org: '哪个群管什么、哪类事交给谁做得好；只记任务结果里的事实，不给 bot 打分。',
}

const SOURCE_NAMES: Readonly<Record<MemoryEntry['source'], string>> = {
  owner: '用户说的',
  bot: 'bot 记的',
  web: '来自网页',
  'other-bot': '别的 bot 说的',
  extracted: '自动提取的',
  task: '任务里记的',
}

export interface NoteView {
  readonly alias: string
  readonly title: string
  readonly description: string
  readonly body: string
  readonly locked: boolean
}

export interface EntryView {
  readonly alias: string
  readonly entry: MemoryEntry
}

export interface ConsolidateInput {
  readonly label: string
  readonly guide: string
  readonly core: CoreMemory
  readonly notes: readonly NoteView[]
  readonly pinned: readonly MemoryEntry[]
  readonly entries: readonly EntryView[]
  readonly findings: readonly Finding[]
  readonly timezone: string
}

export function consolidatePrompt(input: ConsolidateInput): string {
  const day = (time: number): string => localDate(time, input.timezone).slice(5)
  const entryLine = (view: EntryView): string => {
    const { entry } = view
    const tags = [entry.userEdited ? '原样' : '', MEMORY_TYPE_LABELS[entry.type], entry.userEdited ? '用户亲手写的' : SOURCE_NAMES[entry.source], day(entry.createdAt)].filter((tag) => tag !== '')
    return `(${view.alias}) ${tags.join('，')}：${entry.content}`
  }
  const findingLine = (finding: Finding): string => {
    const kind = finding.kind === 'contradict' ? '纠正' : finding.kind === 'confirm' ? '证实' : '新的'
    const who = finding.byOwner ? '用户' : finding.evidence.by
    return `(${finding.id}) ${kind}，${who}的原话「${finding.evidence.quote}」，${day(finding.time)}：${finding.content}`
  }
  const noteBlock = (note: NoteView): string => {
    const lines = noteLines(note.body).map((line) => `  - ${line}`)
    return [`(${note.alias}) 《${note.title}》${note.locked ? '（用户改过，不能动）' : ''}：${note.description}`, ...lines].join('\n')
  }
  return [
    `[范围] ${input.label}`,
    `[整理时留意什么] ${input.guide}`,
    `[现在的要点]${input.core.userEdited ? '（用户改过，不能动）' : ''}\n${input.core.text === '' ? '（还没有）' : input.core.text}`,
    `[现有的笔记]\n${input.notes.length === 0 ? '（还没有）' : input.notes.map(noteBlock).join('\n')}`,
    input.pinned.length === 0 ? '' : `[置顶的条目（每次都带着，不用动，也不用再写进笔记）]\n${input.pinned.map((entry) => `- ${entry.content}`).join('\n')}`,
    `[还没整理的条目]\n${input.entries.length === 0 ? '（没有）' : input.entries.map(entryLine).join('\n')}`,
    `[今晚的发现]\n${input.findings.length === 0 ? '（没有）' : input.findings.map(findingLine).join('\n')}`,
  ]
    .filter((part) => part !== '')
    .join('\n\n')
}

export interface RawLine {
  readonly text: string
  readonly from: readonly string[]
}

export interface RawNote {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly lines: readonly RawLine[]
  readonly remove: readonly { readonly text: string; readonly why: string }[]
}

export interface RawPlan {
  readonly notes: readonly RawNote[]
  readonly replaced: readonly { readonly old: string; readonly by: string; readonly why: string }[]
  readonly dropped: readonly { readonly id: string; readonly why: string }[]
  readonly points: readonly RawLine[]
  readonly questions: readonly { readonly text: string; readonly about: readonly string[] }[]
}

function text(value: unknown): string {
  return typeof value === 'string' ? flat(value) : ''
}

function list(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function names(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value.trim()]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()) : []
}

function rawLines(value: unknown): readonly RawLine[] {
  return list(value)
    .map((item) => ({ text: text(item.text), from: names(item.from) }))
    .filter((line) => line.text !== '')
}

/** 模型交回的新的一版；不是对象就算没交。 */
export function parsePlan(value: unknown): RawPlan | undefined {
  if (!isRecord(value)) return undefined
  return {
    notes: list(value.notes).map((item) => ({
      id: text(item.id),
      title: text(item.title),
      description: text(item.description),
      lines: rawLines(item.lines),
      remove: list(item.remove)
        .map((line) => ({ text: text(line.text), why: text(line.why) }))
        .filter((line) => line.text !== ''),
    })),
    replaced: list(value.replaced)
      .map((item) => ({ old: text(item.old), by: text(item.by), why: text(item.why) }))
      .filter((item) => item.old !== ''),
    dropped: list(value.dropped)
      .map((item) => ({ id: text(item.id), why: text(item.why) }))
      .filter((item) => item.id !== ''),
    points: rawLines(value.points),
    questions: list(value.questions)
      .map((item) => ({ text: text(item.text), about: names(item.about) }))
      .filter((item) => item.text !== ''),
  }
}
