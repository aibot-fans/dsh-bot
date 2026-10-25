import type { DatabaseSync } from 'node:sqlite'
import { LEAD_BOT_ID, looksInjected, truncate, type Bot } from 'pod-domain'
import { getTuning, readState, setTuning, writeState } from 'pod-store'
import type { BotService } from '../bots/service.ts'
import type { LiteLlm } from '../core/lite.ts'
import { extractJson } from '../core/lite.ts'
import type { FeedbackService } from './feedback.ts'
import { CALIBRATION_KEY, type EvolutionService } from './service.ts'

export interface TunerDeps {
  readonly db: DatabaseSync
  readonly lite: LiteLlm
  readonly bots: BotService
  readonly feedback: FeedbackService
  readonly evolution: EvolutionService
  readonly now: () => number
  readonly warn: (message: string, error?: unknown) => void
  /** bot 实际用的模型有哪些推理档位（从低到高）、现在是哪一档；你手动指定了模型的返回 undefined。 */
  readonly efforts: (bot: Bot) => Promise<{ readonly efforts: readonly string[]; readonly current: string } | undefined>
}

const MAX_LINES = 8
const WEEK = 7 * 86_400_000

const PERSONA_SYSTEM = [
  '你负责根据用户和组长的反馈，给一个 bot 写简短的工作习惯调整。',
  '只总结反馈里反复出现的问题，每条一句话、具体可执行，最多 3 条；不要改变它的角色、身份和职责，不要涉及权限、工具和安全规则。',
  '只输出 JSON：{"lines": ["…"]}；没有值得调整的就输出 {"lines": []}。',
].join('\n')

function lines(text: string): readonly string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean)
}

/**
 * 夜间调整：按积累的反馈调人设（只加“自动调整”段落，不碰你写的人设）、降推理档位、
 * 按找你和被改的次数调主管定前提的分寸。都记进进化日志，可以回滚，变差会自动退回。
 */
export class Tuner {
  private readonly deps: TunerDeps

  constructor(deps: TunerDeps) {
    this.deps = deps
  }

  /** 人设后面附加的“根据反馈的调整”段落。 */
  personaFor(botId: string): string {
    const tuning = getTuning(this.deps.db, botId)?.persona ?? ''
    const calibration = botId === LEAD_BOT_ID ? readState<string>(this.deps.db, CALIBRATION_KEY, '') : ''
    return [tuning, calibration].filter((text) => text.trim() !== '').join('\n')
  }

  effortFor(botId: string): string | null {
    return getTuning(this.deps.db, botId)?.effort ?? null
  }

  async nightly(): Promise<void> {
    for (const bot of this.deps.bots.active()) {
      await this.tunePersona(bot).catch((error: unknown) => this.deps.warn(`调整「${bot.name}」的人设失败`, error))
      await this.tuneEffort(bot).catch((error: unknown) => this.deps.warn(`调整「${bot.name}」的推理档位失败`, error))
    }
    this.calibrate()
  }

  /** 一周里同类负面反馈出现 3 次以上，才写一条调整。 */
  private async tunePersona(bot: Bot): Promise<void> {
    const tuning = getTuning(this.deps.db, bot.id)
    const since = Math.max(this.deps.now() - WEEK, tuning?.updatedAt ?? 0)
    const negative = this.deps.feedback.list({ botId: bot.id, since }).filter((item) => item.value < 0 && item.reason.trim() !== '' && (item.kind === 'rating' || item.kind === 'correction' || item.kind === 'review'))
    if (negative.length < 3) return
    const current = tuning?.persona ?? ''
    const result = await this.deps.lite.complete({
      purpose: 'persona-tune',
      system: PERSONA_SYSTEM,
      prompt: [`[bot] ${bot.name}（${bot.title || '成员'}）`, current === '' ? '' : `[已有的调整]\n${current}`, `[最近的反馈]\n${negative.map((item) => `- ${truncate(item.reason, 200)}`).join('\n')}`].filter(Boolean).join('\n\n'),
      maxTokens: 400,
    })
    const parsed = extractJson(result.text) as { readonly lines?: readonly unknown[] } | undefined
    const added = (parsed?.lines ?? []).filter((line): line is string => typeof line === 'string' && line.trim() !== '' && !looksInjected(line)).map((line) => truncate(line.trim(), 120))
    if (added.length === 0) return
    const merged = [...lines(current).filter((line) => !added.includes(line)), ...added].slice(-MAX_LINES)
    const text = merged.map((line) => `- ${line}`).join('\n')
    if (text === current) return
    setTuning(this.deps.db, bot.id, { persona: text }, this.deps.now())
    this.deps.evolution.log({ kind: 'persona', botId: bot.id, subject: bot.id, summary: `「${bot.name}」的人设加了 ${added.length} 条调整：${truncate(added.join('；'), 80)}`, before: { text: current }, after: { text }, reason: `最近一周有 ${negative.length} 条同类负面反馈`, source: 'nightly' })
  }

  /** 最近 10 个任务八成以上一次通过、没有失败和差评：推理档位降一档（只对跟随默认模型的 bot）。 */
  private async tuneEffort(bot: Bot): Promise<void> {
    const card = this.deps.feedback.scorecard(bot.id, { limit: 10 })
    if (card.done < 8 || card.failed > 0 || (card.firstPassRate ?? 0) < 0.8 || (card.rating ?? 0) < 0) return
    const tuning = getTuning(this.deps.db, bot.id)
    if (tuning !== undefined && this.deps.now() - tuning.updatedAt < WEEK) return
    const info = await this.deps.efforts(bot)
    if (info === undefined) return
    const index = info.efforts.indexOf(info.current)
    if (index <= 0) return
    const lower = info.efforts[index - 1] as string
    setTuning(this.deps.db, bot.id, { effort: lower }, this.deps.now())
    this.deps.evolution.log({
      kind: 'effort',
      botId: bot.id,
      subject: bot.id,
      summary: `「${bot.name}」的推理档位从 ${info.current} 降到 ${lower}`,
      before: { effort: tuning?.effort ?? null },
      after: { effort: lower },
      reason: `最近 ${card.done} 个任务一次通过率 ${Math.round((card.firstPassRate ?? 0) * 100)}%`,
      source: 'nightly',
    })
  }

  /** 找你多，说明前提定得太保守；被改多，说明定得太大胆。按这两个数调主管定前提的分寸。 */
  private calibrate(): void {
    const since = this.deps.now() - 2 * WEEK
    const feedback = this.deps.feedback.list({ since })
    const roots = new Set(feedback.map((item) => item.rootId).filter((id): id is string => id !== null))
    if (roots.size < 3) return
    const asks = feedback.filter((item) => item.kind === 'asked').length / roots.size
    const edits = feedback.filter((item) => item.kind === 'edited').length / roots.size
    const advice = [
      asks > 1 ? `- 最近每个任务平均找用户 ${asks.toFixed(1)} 次：只有没有默认值、会让结果方向完全不同的歧义才问；其余按合理默认推进，并在交付里写明前提。` : '',
      edits > 0.5 ? `- 最近交付后常被用户修改（每个任务平均 ${edits.toFixed(1)} 次）：关键前提定得太大胆了，开工说明里先列清前提，拿不准的给两个方案。` : '',
    ]
      .filter(Boolean)
      .join('\n')
    const current = readState<string>(this.deps.db, CALIBRATION_KEY, '')
    if (advice === current) return
    writeState(this.deps.db, CALIBRATION_KEY, advice)
    this.deps.evolution.log({
      kind: 'calibration',
      botId: LEAD_BOT_ID,
      subject: LEAD_BOT_ID,
      summary: advice === '' ? '主管定前提的分寸恢复默认' : `调整了主管定前提的分寸（找你 ${asks.toFixed(1)} 次/任务，被改 ${edits.toFixed(1)} 次/任务）`,
      before: { text: current },
      after: { text: advice },
      reason: '按最近两周的自治效果统计',
      source: 'nightly',
    })
  }
}
