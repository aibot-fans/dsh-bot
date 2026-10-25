/**
 * 分配打分（0–1）：Pod 直接计算，不调用模型，作为参考交给主管。
 * 能力匹配 40%、历史表现 25%、当前负载 15%、上下文连续 10%、模型价格 10%。
 * 评分卡还没积累数据时，历史表现的权重并入能力匹配。
 */

import type { Bot } from './bots.ts'
import { profileCovers } from './plan.ts'

export interface AssignmentInput {
  readonly kind: string
  readonly title: string
  readonly brief: string
  readonly needs: { readonly browser: boolean; readonly shell: boolean }
}

export interface BotStats {
  /** 一次验收通过率，0–1；没有数据时 undefined。 */
  readonly firstPassRate?: number
  /** 手上和排队的任务数。 */
  readonly load: number
  /** 做过上游子任务，或者记忆里有相关内容。 */
  readonly continuity: boolean
  /** 相对价格，0（便宜）到 1（贵）；未知时 0.5。 */
  readonly price?: number
}

export interface AssignmentScore {
  readonly botId: string
  readonly score: number
  readonly eligible: boolean
  readonly parts: {
    readonly capability: number
    readonly history: number | null
    readonly load: number
    readonly continuity: number
    readonly price: number
  }
}

function words(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[\s,，、。；;：:/()（）]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
}

/** 子任务描述和 bot 的能力标签、角色、职责重合多少。 */
export function capabilityMatch(bot: Pick<Bot, 'capabilities' | 'title' | 'card'>, input: AssignmentInput): number {
  const tags = [...bot.capabilities, bot.title].map((tag) => tag.toLowerCase()).filter(Boolean)
  if (tags.length === 0) return 0.3
  const haystack = `${input.kind} ${input.title} ${input.brief}`.toLowerCase()
  const kind = input.kind.toLowerCase()
  // 子任务类型正好是它的能力标签之一：最强的信号。
  const kindMatch = kind !== '' && tags.some((tag) => tag === kind || tag.includes(kind) || kind.includes(tag)) ? 0.9 : 0
  const hits = tags.filter((tag) => haystack.includes(tag)).length
  const ratio = Math.min(1, hits / Math.min(tags.length, 2))
  const duty = words(bot.card.duties).some((word) => word.length >= 2 && haystack.includes(word)) ? 0.15 : 0
  return Math.min(1, Math.max(kindMatch, ratio, 0.1) + duty)
}

export function scoreAssignment(bot: Bot, input: AssignmentInput, stats: BotStats): AssignmentScore {
  const eligible = bot.archivedAt === null && profileCovers(bot.toolProfile, input.needs)
  const capability = capabilityMatch(bot, input)
  const history = stats.firstPassRate ?? null
  const load = 1 / (1 + stats.load)
  const continuity = stats.continuity ? 1 : 0
  const price = 1 - (stats.price ?? 0.5)
  const weighted =
    history === null
      ? capability * 0.65 + load * 0.15 + continuity * 0.1 + price * 0.1
      : capability * 0.4 + history * 0.25 + load * 0.15 + continuity * 0.1 + price * 0.1
  return {
    botId: bot.id,
    score: eligible ? Number(weighted.toFixed(3)) : 0,
    eligible,
    parts: { capability, history, load, continuity, price },
  }
}

/** 最高分低于这个值说明没有合适的人：新建临时 bot，或者自己做。 */
export const MIN_GOOD_SCORE = 0.5
