import type { DatabaseSync } from 'node:sqlite'
import {
  EMPTY_DREAM_STATS,
  costOf,
  dreamHold,
  fail,
  isCredentialMemory,
  isDeepSeekPeak,
  localDate,
  newId,
  noteIndexLine,
  ok,
  t,
  truncate,
  wallClock,
  type DreamDetail,
  type DreamOp,
  type DreamQuestion,
  type DreamRejection,
  type DreamScope,
  type DreamStats,
  type DreamTrigger,
  type MemoryDream,
  type MemoryEntry,
  type MemoryScopeKind,
  type PodResult,
} from 'pod-domain'
import {
  countAppliedDreams,
  getCore,
  getDream,
  insertDream,
  insertDreamOps,
  listDreamOps,
  listDreams,
  listMemories,
  listNotes,
  markDreamOp,
  openDream,
  readDreamWork,
  readState,
  transaction,
  updateDream,
  updateMemory,
  writeDreamWork,
  writeState,
  type NewDreamOp,
} from 'pod-store'
import { extractJson, type LiteLlm } from '../../core/lite.ts'
import type { ModelSelection, SessionEvent } from '../../dsh.ts'
import type { MemoryService } from '../service.ts'
import { applyOps, revertOps, type ApplyResult } from './apply.ts'
import { CONSOLIDATE_SYSTEM, DEFAULT_GUIDES } from './consolidate.ts'
import { ScopePlanner, type ScopeRef } from './plan.ts'
import { chatRecords } from './records.ts'
import { rehomeOps } from './rehome.ts'
import { REPLAY_SYSTEM, parseFindings, replayPrompt, settleFindings, type Known } from './replay.ts'
import { SORT_MAX, SORT_SYSTEM, sortOps, sortPrompt } from './sort.ts'
import { taskRecords } from './task-records.ts'
import { EMPTY_WORK, addSpent, type DreamRecord, type DreamWork, type Mark, type Spent } from './types.ts'

/** 一晚最多读多少段对话、多少件事；多的下一晚接着读。 */
const MAX_CHATS = 30
const MAX_TASKS = 12
/** 一个范围一晚最多整合几轮（一轮 60 条）。 */
const MAX_ROUNDS = 4
/** 一次模型调用最多等多久。 */
const CALL_TIMEOUT_MS = 240_000
/** 回放时给模型看多少条已有的记忆。 */
const KNOWN_MAX = 80
/** 夜里几点以后才自动整理（本地时间）。 */
const NIGHT_HOUR = 2
/** 没过核对的最多留多少条给你看。 */
const REJECTED_KEEP = 80

/** 整理哪几种范围：关于你、bot、群、组织目录。任务和旧团队不再是家，里面的条目先搬走。 */
const SCOPE_KINDS: readonly MemoryScopeKind[] = ['owner', 'bot', 'room', 'org']

/** Super-agent 名下的条目分拣到了什么时候。 */
const SORTED_KEY = 'memory.dream.sorted'

export interface DreamDeps {
  readonly db: DatabaseSync
  readonly lite: LiteLlm
  readonly memory: MemoryService
  readonly now: () => number
  readonly timezone: () => string
  /** 整理用哪个模型：设置里单独指定的，没指定就跟默认模型。 */
  readonly model: () => Promise<ModelSelection>
  readonly botName: (id: string) => string | undefined
  readonly roomTitle: (id: string) => string | undefined
  readonly leadOf: (roomId: string) => string | undefined
  /** 读一段会话在 from 到 to 之间的日志（任务会话里的工具调用和结果）。 */
  readonly sessionEvents: (sessionId: string, from: number, to: number) => Promise<readonly SessionEvent[]>
  /** 任务交进了哪个群、归哪个 bot 负责；旧团队转成了哪个群。 */
  readonly groupOf: (taskId: string) => string | undefined
  readonly ownerOf: (taskId: string) => string | undefined
  readonly teamRoom: (teamId: string) => string | undefined
  /** Super-agent 是哪个 bot；现有的群（名字、管什么）。它名下的条目整理时分拣到该在的家。 */
  readonly leadBot: () => string | undefined
  readonly groups: () => readonly { readonly id: string; readonly title: string; readonly about: string }[]
  /** 一次整理收尾了（等你看、生效了、没有要改的、没做成）：你叫的那一次在对话里说一声。 */
  readonly finished: (dream: MemoryDream) => void
  /** 有任务在跑，或者你刚说过话：这时候不开始，自动的那一次做完手上这一份就先停。 */
  readonly busy: () => boolean
  readonly enabled: () => boolean
  readonly warn: (message: string) => void
}

/** 这个范围整理到了什么时候：之后新记的、改过的条目才再拿去整理。 */
function seenKey(scope: { readonly kind: MemoryScopeKind; readonly id: string }): string {
  return `memory.dream.seen.${scope.kind}:${scope.id}`
}

/** 你给一个范围写的“整理时留意什么”。 */
export function guideKey(kind: MemoryScopeKind, id: string): string {
  return `memory.dream.guide.${kind}:${id}`
}

/**
 * 记忆的夜间整理。一次分五步：挑记录（代码）→ 逐份回放（模型，只交发现，带出处和原话）→ 按范围整合（模型，交新的一版）
 * → 核对并定下每一处改动（代码）→ 先给你看或直接生效。模型调用不带工具，不直接写库。
 * 同时只做一次；每处改动都留着改之前的样子，能整晚撤销。
 */
export class DreamService {
  private current: Promise<void> | undefined
  private readonly deps: DreamDeps

  constructor(deps: DreamDeps) {
    this.deps = deps
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  list(limit = 60): readonly MemoryDream[] {
    return listDreams(this.db, limit)
  }

  detail(id: string): DreamDetail | undefined {
    const dream = getDream(this.db, id)
    return dream === undefined ? undefined : { dream, ops: listDreamOps(this.db, id) }
  }

  guide(kind: MemoryScopeKind, id: string): string {
    return readState<string>(this.db, guideKey(kind, id), '')
  }

  setGuide(kind: MemoryScopeKind, id: string, text: string): string {
    const guide = truncate(text.replace(/\s+/g, ' ').trim(), 200)
    writeState(this.db, guideKey(kind, id), guide)
    return guide
  }

  /** 上一次的结果还等你看：先看那一次，不另开。 */
  private waiting(): MemoryDream | undefined {
    return listDreams(this.db, 20).find((dream) => dream.status === 'preview')
  }

  /**
   * 开始一次整理，在后台做。only 是只整理这几个范围（页面上某个范围的“现在整理”），这时把这个范围没整理进笔记的条目全部重看一遍。
   * 已经有一次在做，或者上一次的结果还等你看，就不另开。
   */
  start(trigger: DreamTrigger, only: readonly { readonly kind: MemoryScopeKind; readonly id: string }[] = []): PodResult<MemoryDream> {
    if (!this.deps.lite.available) return fail('session-unavailable', t('这个 dsh 没有提供模型调用，整理不了'))
    if (this.current !== undefined) return fail('conflict', t('正在整理，等这一次做完'))
    // 上次做到一半停下的（有任务在跑先停着，或者中途重启了）：接着做那一次，不另开。
    const open = openDream(this.db)
    if (open !== undefined) {
      this.kick(open.id)
      return ok(open)
    }
    if (this.waiting() !== undefined) return fail('conflict', t('上一次整理的结果还没看，先看那一次'))
    const dream = insertDream(this.db, { id: newId('dream'), trigger, status: 'running', model: '', startedAt: this.deps.now() })
    writeDreamWork(this.db, dream.id, { ...EMPTY_WORK, only })
    this.kick(dream.id)
    return ok(dream)
  }

  private kick(id: string): void {
    this.current = this.run(id)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        this.deps.warn(`整理记忆没做成：${message}`)
        updateDream(this.db, id, { status: 'failed', error: truncate(message, 300), finishedAt: this.deps.now() })
      })
      .finally(() => {
        this.current = undefined
        this.deps.memory.touch()
        const dream = getDream(this.db, id)
        if (dream !== undefined && dream.status !== 'running' && dream.status !== 'paused') this.deps.finished(dream)
      })
  }

  /** 等正在做的这一次做完（“整理一下记忆”要等结果回话）。 */
  async settled(): Promise<void> {
    await this.current
  }

  /**
   * 每十分钟看一次：停着的那一次空了就接着做；今天还没自动整理过、过了夜里两点、当天的备份做完了、现在空着，就开始。
   * 上一次的结果还等你看时今晚不做。
   */
  tick(): void {
    if (this.current !== undefined || !this.deps.enabled() || !this.deps.lite.available) return
    const open = openDream(this.db)
    if (open !== undefined) {
      if (!this.deps.busy()) this.kick(open.id)
      return
    }
    const now = this.deps.now()
    const today = localDate(now, this.deps.timezone())
    if (readState<string>(this.db, 'memory.dream.lastNight', '') === today) return
    if (wallClock(now, this.deps.timezone()).hour < NIGHT_HOUR || readState<string>(this.db, 'maintenance.lastDay', '') !== today) return
    if (this.deps.busy()) return
    writeState(this.db, 'memory.dream.lastNight', today)
    if (this.waiting() === undefined) this.start('nightly')
  }

  private label(kind: MemoryScopeKind, id: string): string {
    if (kind === 'owner') return t('关于你')
    if (kind === 'bot') return t('{name}的经验', { name: this.deps.botName(id) ?? 'bot' })
    if (kind === 'room') return t('群「{title}」', { title: this.deps.roomTitle(id) ?? id })
    if (kind === 'org') return t('组织目录')
    return `${kind}:${id}`
  }

  /** 整理时能动的条目：在用的，不含账号密码类的和私密的（私密的只有 Super-agent 能读，不能并进大家都看的笔记）。 */
  private usable(kind: MemoryScopeKind, id: string, statuses: readonly MemoryEntry['status'][] = ['active']): readonly MemoryEntry[] {
    return listMemories(this.db, { scopeKind: kind, scopeId: id, statuses, limit: 5000 }).filter((entry) => !entry.private && !isCredentialMemory(entry.content))
  }

  private async ask(purpose: string, system: string, prompt: string, model: ModelSelection, maxTokens: number): Promise<{ readonly value: unknown; readonly spent: Spent }> {
    const result = await this.deps.lite.complete({ purpose, system, prompt, model, maxTokens, thorough: true, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) })
    const cost = costOf(result.provider, result.model, result.usage, isDeepSeekPeak(this.deps.now())) ?? 0
    return { value: extractJson(result.text), spent: { inputTokens: result.usage.inputTokens + result.usage.cacheReadTokens, outputTokens: result.usage.outputTokens, cost } }
  }

  /** 回放时给模型看的已有记忆：关于你的，加上这份记录所在的群、这个 bot 名下的。 */
  private known(record: DreamRecord): { readonly known: readonly Known[]; readonly notes: string } {
    const scopes: { readonly kind: MemoryScopeKind; readonly id: string }[] = [
      { kind: 'owner', id: '' },
      ...(record.roomId === null ? [] : [{ kind: 'room' as const, id: record.roomId }]),
      ...(record.botId === null ? [] : [{ kind: 'bot' as const, id: record.botId }]),
    ]
    const entries = scopes.flatMap((scope) => this.usable(scope.kind, scope.id, ['active', 'pending']).slice(0, scope.kind === 'owner' ? 50 : 20)).slice(0, KNOWN_MAX)
    const known = entries.map((entry, index) => ({
      alias: `k${index + 1}`,
      id: entry.id,
      scopeKind: entry.scopeKind,
      scopeId: entry.scopeId,
      text: `${entry.status === 'pending' ? '（待确认）' : ''}${truncate(entry.content, 160)}`,
    }))
    const notes = scopes.flatMap((scope) => listNotes(this.db, { scopeKind: scope.kind, scopeId: scope.id }).slice(0, 12).map(noteIndexLine)).join('\n')
    return { known, notes }
  }

  private scopes(work: DreamWork): readonly ScopeRef[] {
    const found = new Map<string, ScopeRef>()
    const add = (kind: MemoryScopeKind, id: string): void => {
      if (!SCOPE_KINDS.includes(kind) || found.has(`${kind}:${id}`)) return
      found.set(`${kind}:${id}`, { kind, id, label: this.label(kind, id) })
    }
    if (work.only.length > 0) {
      for (const scope of work.only) add(scope.kind, scope.id)
      return [...found.values()]
    }
    add('owner', '')
    for (const entry of listMemories(this.db, { statuses: ['active'], limit: 100_000 })) add(entry.scopeKind, entry.scopeId)
    for (const finding of work.findings) add(finding.scopeKind, finding.scopeId)
    return [...found.values()]
  }

  private async run(id: string): Promise<void> {
    const dream = getDream(this.db, id)
    if (dream === undefined) return
    const model = await this.deps.model()
    updateDream(this.db, id, { status: 'running', model: `${model.provider}/${model.model}` })
    this.deps.memory.touch()
    let work = readDreamWork<DreamWork>(this.db, id, EMPTY_WORK)

    // 第一步：挑记录。读过的（停下来之前读完的）不再读。
    const sources = { db: this.db, now: this.deps.now, botName: this.deps.botName }
    const chats = work.only.length > 0 ? { records: [], skipped: [] } : chatRecords(sources, MAX_CHATS)
    const tasks = work.only.length > 0 ? { records: [], skipped: [] } : await taskRecords({ ...sources, sessionEvents: this.deps.sessionEvents, groupOf: this.deps.groupOf }, MAX_TASKS)
    const picked = { records: [...chats.records, ...tasks.records], skipped: [...chats.skipped, ...tasks.skipped] }
    if (work.done.length === 0 && work.marks.length === 0) work = { ...work, marks: picked.skipped }

    // 第二步：逐份回放，只交发现。自动的那一次碰上有任务在跑就先停，空了接着做。
    for (const record of picked.records) {
      if (work.done.includes(record.id)) continue
      if (dream.trigger === 'nightly' && this.deps.busy()) {
        writeDreamWork(this.db, id, work)
        updateDream(this.db, id, { status: 'paused' })
        return
      }
      const { known, notes } = this.known(record)
      const answer = await this.ask('memory-dream-replay', REPLAY_SYSTEM, replayPrompt(record, known, notes), model, 3000)
      const raw = parseFindings(answer.value)
      const settled = raw === undefined ? { findings: [], rejected: [{ what: record.title, why: t('回放这份记录时模型交回的不是能读的结果') }] } : settleFindings({ leadOf: this.deps.leadOf }, record, raw, known, work.findings.length)
      work = {
        ...work,
        done: [...work.done, record.id],
        findings: [...work.findings, ...settled.findings],
        rejected: [...work.rejected, ...settled.rejected],
        marks: [...work.marks, ...record.marks],
        spent: addSpent(work.spent, answer.spent),
      }
      writeDreamWork(this.db, id, work)
    }

    // 第三、四步：每个范围整合一次，逐条核对，定下改动。
    const ops: NewDreamOp[] = []
    const questions: DreamQuestion[] = []
    const rejected: DreamRejection[] = [...work.rejected]
    const scopes: DreamScope[] = []
    const marks: Mark[] = [...work.marks]
    let spent = work.spent
    const leaving = new Set<string>()
    if (work.only.length === 0) {
      const moved = rehomeOps({ db: this.db, groupOf: this.deps.groupOf, ownerOf: this.deps.ownerOf, teamRoom: this.deps.teamRoom, label: (kind, scopeId) => this.label(kind, scopeId) })
      ops.push(...moved.ops.map((body, index) => ({ ...body, dreamId: id, seq: index + 1 })))
      scopes.push(...moved.scopes)
      // Super-agent 名下新记的条目先分拣：关于你的、某个群的、组织目录的各归各家，剩下的才当它自己的经验整理。
      const lead = this.deps.leadBot()
      const sorted = readState<number>(this.db, SORTED_KEY, 0)
      const mine = lead === undefined ? [] : [...this.usable('bot', lead)].filter((entry) => !entry.userEdited && !entry.pinned && entry.updatedAt > sorted).sort((left, right) => left.updatedAt - right.updatedAt).slice(0, SORT_MAX)
      if (lead !== undefined && mine.length > 0) {
        const groups = this.deps.groups().map((group, index) => ({ ...group, alias: `g${index + 1}` }))
        const answer = await this.ask('memory-dream-sort', SORT_SYSTEM, sortPrompt(groups, mine), model, 3000)
        spent = addSpent(spent, answer.spent)
        const sortedOps = sortOps(answer.value, groups, mine, (kind, scopeId) => this.label(kind, scopeId))
        ops.push(...sortedOps.map((body, index) => ({ ...body, dreamId: id, seq: ops.length + index + 1 })))
        for (const op of sortedOps) leaving.add(op.ref)
        if (sortedOps.length > 0) scopes.push({ kind: 'bot', id: lead, label: this.label('bot', lead), size: this.usable('bot', lead).length, touched: sortedOps.length })
        marks.push({ key: SORTED_KEY, value: mine.at(-1)?.updatedAt ?? sorted })
      }
    }
    for (const scope of this.scopes(work)) {
      const manual = work.only.some((item) => item.kind === scope.kind && item.id === scope.id)
      const planner = new ScopePlanner({
        scope,
        core: getCore(this.db, scope.kind, scope.id),
        notes: listNotes(this.db, { scopeKind: scope.kind, scopeId: scope.id }),
        entries: this.usable(scope.kind, scope.id).filter((entry) => !leaving.has(entry.id)),
        since: manual ? 0 : readState<number>(this.db, seenKey(scope), 0),
        pending: this.usable(scope.kind, scope.id, ['pending']),
        findings: work.findings.filter((finding) => finding.scopeKind === scope.kind && finding.scopeId === scope.id),
        guide: this.guide(scope.kind, scope.id) || DEFAULT_GUIDES[scope.kind],
        timezone: this.deps.timezone(),
        newId,
      })
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const prompt = planner.prompt()
        if (prompt === undefined) break
        const answer = await this.ask('memory-dream-consolidate', CONSOLIDATE_SYSTEM, prompt, model, 8000)
        spent = addSpent(spent, answer.spent)
        planner.absorb(answer.value)
      }
      const result = planner.result(id, ops.length + 1)
      ops.push(...result.ops)
      questions.push(...result.questions)
      rejected.push(...result.rejected)
      const listed = scopes.findIndex((item) => item.kind === scope.kind && item.id === scope.id)
      if (listed >= 0) scopes[listed] = { ...result.scope, touched: result.scope.touched + (scopes[listed]?.touched ?? 0) }
      else if (result.ops.length + result.questions.length > 0) scopes.push(result.scope)
      marks.push({ key: seenKey(scope), value: planner.seen() })
    }

    // 第五步：定稿。水位往前推；没有要改的就记一笔，头几次和大改先给你看，其余直接生效。
    const live = ops.filter((op) => !op.held)
    const stats: DreamStats = {
      ...EMPTY_DREAM_STATS,
      records: work.done.length,
      findings: work.findings.length,
      rejected: rejected.length,
      notes: live.filter((op) => op.kind === 'note-upsert' || op.kind === 'note-archive').length,
      merged: live.reduce((sum, op) => sum + (op.before.merged?.length ?? 0), 0),
      changed: live.filter((op) => op.kind === 'entry-supersede' || op.kind === 'entry-archive' || op.kind === 'entry-move').length,
      added: live.filter((op) => op.kind === 'entry-add' || op.kind === 'entry-confirm').length,
      questions: questions.length,
      inputTokens: spent.inputTokens,
      outputTokens: spent.outputTokens,
      cost: spent.cost,
    }
    // 上一次的结果你撤销了或者没要：这一次不管多小都先给你看。
    const last = listDreams(this.db, 20).find((item) => item.id !== id && (item.status === 'applied' || item.status === 'reverted' || item.status === 'discarded'))
    const refused = last !== undefined && last.status !== 'applied' ? t('上一次整理的结果你没要，这一次先给你看') : ''
    const held = live.length === 0 ? '' : refused || dreamHold(countAppliedDreams(this.db), scopes)
    transaction(this.db, () => {
      insertDreamOps(this.db, ops)
      const latest = new Map<string, number>()
      for (const mark of marks) latest.set(mark.key, Math.max(latest.get(mark.key) ?? 0, mark.value))
      for (const [key, value] of latest) if (value > readState<number>(this.db, key, 0)) writeState(this.db, key, value)
      updateDream(this.db, id, {
        status: live.length + questions.length === 0 ? 'empty' : 'preview',
        scopes,
        stats,
        questions,
        rejected: rejected.slice(0, REJECTED_KEEP),
        held,
        finishedAt: this.deps.now(),
      })
    })
    if (live.length > 0 && held === '') this.apply(id, [])
    else if (live.length === 0 && questions.length > 0) updateDream(this.db, id, { status: 'applied', appliedAt: this.deps.now() })
  }

  private reindex(result: ApplyResult): void {
    this.deps.memory.reindex(result.entries, result.notes)
  }

  /** 让这一晚的改动生效。skip 是你在预览里去掉勾的那几处；等你回答的问题不跟着生效。 */
  apply(id: string, skip: readonly number[]): PodResult<DreamDetail> {
    const dream = getDream(this.db, id)
    if (dream === undefined) return fail('not-found', t('找不到这次整理'))
    if (dream.status !== 'preview') return fail('conflict', t('这次整理已经处理过了'))
    const ops = listDreamOps(this.db, id)
    const dropped = new Set(skip)
    for (const op of ops) if (dropped.has(op.seq) && !op.held) markDreamOp(this.db, id, op.seq, { skipped: t('你没要这一处') })
    const result = applyOps({ db: this.db, now: this.deps.now }, ops, (op: DreamOp) => !op.held && !dropped.has(op.seq))
    updateDream(this.db, id, { status: 'applied', appliedAt: this.deps.now() })
    this.reindex(result)
    return ok(this.detail(id) as DreamDetail)
  }

  /** 这一版不要了：什么都不改。 */
  discard(id: string): PodResult<MemoryDream> {
    const dream = getDream(this.db, id)
    if (dream === undefined) return fail('not-found', t('找不到这次整理'))
    if (dream.status !== 'preview') return fail('conflict', t('这次整理已经处理过了'))
    const next = updateDream(this.db, id, { status: 'discarded' })
    this.deps.memory.touch()
    return ok(next ?? dream)
  }

  /** 整晚撤销：这一晚做了的改动都撤回去；之后又改过的不动，在结果里说明。 */
  revert(id: string): PodResult<DreamDetail> {
    const dream = getDream(this.db, id)
    if (dream === undefined) return fail('not-found', t('找不到这次整理'))
    if (dream.status !== 'applied') return fail('conflict', t('只有已经生效的整理能撤销'))
    const result = revertOps({ db: this.db, now: this.deps.now }, listDreamOps(this.db, id))
    updateDream(this.db, id, { status: 'reverted', revertedAt: this.deps.now() })
    this.reindex(result)
    return ok(this.detail(id) as DreamDetail)
  }

  /** 回答一个问题：做你选的那一项带的改动。 */
  answer(id: string, questionId: string, label: string): PodResult<DreamDetail> {
    const dream = getDream(this.db, id)
    const question = dream?.questions.find((item) => item.id === questionId)
    const option = question?.options.find((item) => item.label === label)
    if (dream === undefined || question === undefined || option === undefined) return fail('not-found', t('找不到这个问题'))
    if (question.answer !== null) return fail('conflict', t('这个问题已经答过了'))
    if (dream.status !== 'preview' && dream.status !== 'applied') return fail('conflict', t('这次整理已经不能改了'))
    const picked = new Set(option.ops)
    const ops = listDreamOps(this.db, id)
    const result = applyOps({ db: this.db, now: this.deps.now }, ops, (op: DreamOp) => picked.has(op.seq))
    // 你定了留下的那一条：算刚改过，下次整理时再拿去并进笔记。
    for (const op of ops) {
      if (picked.has(op.seq) && op.kind === 'entry-supersede' && op.after.by !== undefined && op.after.by !== '') updateMemory(this.db, op.after.by, {}, this.deps.now())
    }
    updateDream(this.db, id, { questions: dream.questions.map((item) => (item.id === questionId ? { ...item, answer: label } : item)) })
    this.reindex(result)
    return ok(this.detail(id) as DreamDetail)
  }
}
