import type { DatabaseSync } from 'node:sqlite'
import { EVOLUTION_LABELS, POD, clearlyWorse, fail, newId, nextCronRun, ok, parseCron, type EvolutionEntry, type EvolutionKind, type PodResult, type PodSettings, type Scorecard } from 'pod-domain'
import { getEvolution, insertEvolution, listEvolution, readState, setEvolutionStatus, setTuning, writeState } from 'pod-store'
import type { BotService } from '../bots/service.ts'
import type { RoomService } from '../chat/rooms.ts'
import type { Auditor } from '../core/audit.ts'
import type { PodBus } from '../core/bus.ts'
import type { MemoryService } from '../memory/service.ts'
import type { NotificationService } from '../notify/service.ts'
import type { FeedbackService } from './feedback.ts'
import type { SkillService } from './skills.ts'

export interface EvolutionDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly audit: Auditor
  readonly bots: BotService
  readonly memory: MemoryService
  readonly skills: SkillService
  readonly feedback: FeedbackService
  readonly rooms: RoomService
  readonly notifications: NotificationService
  readonly settings: () => PodSettings
  readonly now: () => number
  /** 你的档案这一周的改动条数，写进“本周变化”。 */
  readonly ownerChanges: (since: number) => readonly string[]
  /** 这段时间里结束的根任务数，自治效果按它平均。 */
  readonly rootsFinishedSince: (since: number) => number
}

export interface LogInput {
  readonly kind: EvolutionKind
  readonly botId: string | null
  readonly subject: string
  readonly summary: string
  readonly before: unknown
  readonly after: unknown
  readonly reason: string
  readonly source: string
}

const WEEKLY_KEY = 'weekly.nextAt'
/** 主管定前提的分寸：按找你和被改的次数写的提示。 */
export const CALIBRATION_KEY = 'calibration.lead'
const WEEKLY_CRON = '0 9 * * 1'
const TRACK_TASKS = 10
const REVERTIBLE: ReadonlySet<EvolutionKind> = new Set(['experience', 'skill', 'persona', 'effort', 'promotion', 'calibration'])
/** 这些改动之后跟踪接下来的任务，明显变差就自动退回。 */
const TRACKED: ReadonlySet<EvolutionKind> = new Set(['skill', 'persona', 'effort', 'calibration'])

/**
 * 进化日志：经验、技能、人设、推理档位、转为常驻、定前提的分寸，每次改动都记来源和理由，可以回滚。
 * 改动之后跟踪接下来 10 个任务，明显变差就自动退回上一版；每周给你一张“本周变化”卡。
 */
export class EvolutionService {
  private readonly deps: EvolutionDeps

  constructor(deps: EvolutionDeps) {
    this.deps = deps
  }

  log(input: LogInput): EvolutionEntry {
    const baseline = input.botId === null || !TRACKED.has(input.kind) ? null : this.deps.feedback.scorecard(input.botId, { limit: TRACK_TASKS })
    const entry = insertEvolution(this.deps.db, { id: newId('evo'), ...input, baseline, createdAt: this.deps.now() })
    this.deps.audit.record('evolution', input.source, entry.id, { kind: input.kind, summary: input.summary })
    this.deps.bus.emit({ type: 'evolution' })
    return entry
  }

  list(since?: number): readonly EvolutionEntry[] {
    return listEvolution(this.deps.db, { since, limit: 300 })
  }

  /** 回滚一条改动：按种类恢复到改之前。 */
  revert(id: string, actor = 'owner', why = '你点了回滚'): PodResult<EvolutionEntry> {
    const entry = getEvolution(this.deps.db, id)
    if (entry === undefined) return fail('not-found', '找不到这条改动')
    if (entry.status === 'reverted') return fail('conflict', '已经回滚过了')
    if (!REVERTIBLE.has(entry.kind)) return fail('conflict', '这条记录不能回滚')
    const before = (entry.before ?? {}) as Readonly<Record<string, unknown>>
    const after = (entry.after ?? {}) as Readonly<Record<string, unknown>>
    const now = this.deps.now()
    switch (entry.kind) {
      case 'experience':
        if (typeof after.memoryId === 'string') this.deps.memory.remove(after.memoryId, actor)
        break
      case 'skill': {
        const skillId = typeof after.skillId === 'string' ? after.skillId : entry.subject
        const result = typeof before.version === 'number' ? this.deps.skills.rollback(skillId, before.version, actor) : this.deps.skills.setStatus(skillId, 'archived', actor)
        if (!result.ok) return result
        break
      }
      case 'persona':
        if (entry.botId !== null) setTuning(this.deps.db, entry.botId, { persona: typeof before.text === 'string' ? before.text : '' }, now)
        break
      case 'calibration':
        writeState(this.deps.db, CALIBRATION_KEY, typeof before.text === 'string' ? before.text : '')
        break
      case 'effort':
        if (entry.botId !== null) setTuning(this.deps.db, entry.botId, { effort: typeof before.effort === 'string' ? before.effort : null }, now)
        break
      case 'promotion':
        if (entry.botId !== null) this.deps.bots.applyPatch(entry.botId, { temporary: true }, { source: 'rollback', actor, reason: '撤销转为常驻' })
        break
      default:
    }
    setEvolutionStatus(this.deps.db, id, 'reverted', now)
    this.deps.audit.record('evolution.revert', actor, id, { why })
    this.deps.bus.emit({ type: 'evolution' })
    if (entry.kind === 'persona' || entry.kind === 'skill') this.deps.bus.emit({ type: 'bots' })
    return ok(getEvolution(this.deps.db, id) ?? entry)
  }

  /** 夜间检查：改动之后的任务明显变差就自动退回，写进“本周变化”。 */
  autoRevert(): number {
    let reverted = 0
    for (const entry of this.list(this.deps.now() - 60 * 86_400_000)) {
      if (entry.status !== 'active' || !TRACKED.has(entry.kind) || entry.botId === null || entry.baseline === null) continue
      const current: Scorecard = this.deps.feedback.scorecard(entry.botId, { since: entry.createdAt, limit: TRACK_TASKS })
      const finished = current.done + current.failed
      const worse = finished >= 5 ? clearlyWorse(entry.baseline, current) : undefined
      if (worse !== undefined) {
        const result = this.revert(entry.id, POD, worse)
        if (result.ok) {
          reverted += 1
          this.log({ kind: 'revert', botId: entry.botId, subject: entry.id, summary: `自动退回了${EVOLUTION_LABELS[entry.kind]}的改动：${entry.summary}`, before: null, after: null, reason: worse, source: 'nightly' })
        }
      } else if (finished >= TRACK_TASKS) {
        setEvolutionStatus(this.deps.db, entry.id, 'kept', this.deps.now())
      }
    }
    return reverted
  }

  /** 临时 bot 这次表现好（子任务都一次通过、没被点踩）就转为常驻，写进“本周变化”。 */
  promote(botId: string, rootId: string): boolean {
    const bot = this.deps.bots.get(botId)
    if (bot === undefined || !bot.temporary || bot.role !== 'member') return false
    const card = this.deps.feedback.scorecard(botId, { limit: 10 })
    const feedback = this.deps.feedback.list({ botId }).filter((item) => item.rootId === rootId)
    const negative = feedback.some((item) => item.value < 0)
    if (card.done === 0 || card.failed > 0 || card.firstPassRate !== 1 || negative) return false
    const result = this.deps.bots.applyPatch(botId, { temporary: false }, { source: 'auto', actor: POD, reason: '临时 bot 表现好，转为常驻' })
    if (!result.ok) return false
    this.log({ kind: 'promotion', botId, subject: botId, summary: `「${bot.name}」转为常驻`, before: { temporary: true }, after: { temporary: false }, reason: '子任务都一次验收通过，没有负面反馈', source: 'retro' })
    return true
  }

  // ---------- 本周变化 ----------

  private nextWeekly(now: number): number {
    const schedule = parseCron(WEEKLY_CRON)
    return typeof schedule === 'string' ? now + 7 * 86_400_000 : (nextCronRun(schedule, now, this.deps.settings().timezone) ?? now + 7 * 86_400_000)
  }

  /** 每周一早上发一张“本周变化”卡到主管单聊：只看不用处理，哪条不满意一键回滚。 */
  weeklyTick(): boolean {
    const now = this.deps.now()
    const due = readState<number | null>(this.deps.db, WEEKLY_KEY, null)
    if (due === null) {
      writeState(this.deps.db, WEEKLY_KEY, this.nextWeekly(now))
      return false
    }
    if (due > now) return false
    writeState(this.deps.db, WEEKLY_KEY, this.nextWeekly(now))
    this.sendWeekly(now - 7 * 86_400_000)
    return true
  }

  weekly(since: number): { readonly entries: readonly EvolutionEntry[]; readonly owner: readonly string[]; readonly autonomy: { readonly asked: number; readonly bypassed: number; readonly edited: number; readonly tasks: number } } {
    const entries = this.list(since)
    const feedback = this.deps.feedback.list({ since })
    return {
      entries,
      owner: this.deps.ownerChanges(since),
      autonomy: {
        asked: feedback.filter((item) => item.kind === 'asked').length,
        bypassed: feedback.filter((item) => item.kind === 'bypassed').length,
        edited: feedback.filter((item) => item.kind === 'edited').length,
        tasks: this.deps.rootsFinishedSince(since),
      },
    }
  }

  sendWeekly(since: number): void {
    const data = this.weekly(since)
    const counts = new Map<EvolutionKind, number>()
    for (const entry of data.entries) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1)
    const parts = [...counts].map(([kind, count]) => `${EVOLUTION_LABELS[kind]} ${count} 条`)
    const body = [
      parts.length === 0 ? '这一周没有自动改动。' : `这一周的自动改动：${parts.join('、')}。`,
      data.owner.length === 0 ? '' : `你的档案新增或改动 ${data.owner.length} 条。`,
      `自治效果：${data.autonomy.tasks} 个任务里找了你 ${data.autonomy.asked} 次，先绕过 ${data.autonomy.bypassed} 次，交付后被你改了 ${data.autonomy.edited} 次。`,
    ]
      .filter(Boolean)
      .join('\n')
    const room = this.deps.rooms.ensureLeadRoom()
    this.deps.rooms.post(room.id, { author: POD, kind: 'weekly', body, data: { since, until: this.deps.now() } })
    this.deps.notifications.notify({ kind: 'weekly', title: '本周变化', body, roomId: room.id })
  }
}
