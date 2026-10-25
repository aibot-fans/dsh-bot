/**
 * 自我优化：反馈信号、评分卡、技能、进化日志。和任务一样默认自治：改动直接生效、留版本、可回滚；
 * 只有涉及代码和权限的改动（带脚本的技能）要你批准。
 */

/** 反馈信号：你点赞点踩、你的纠正、组长验收、任务失败、重新生成、交付后被你改、找你和先绕过。 */
export type FeedbackKind = 'rating' | 'correction' | 'review' | 'failure' | 'regenerate' | 'edited' | 'asked' | 'bypassed'

export interface Feedback {
  readonly id: number
  readonly kind: FeedbackKind
  readonly botId: string | null
  readonly taskId: string | null
  readonly rootId: string | null
  readonly messageId: string | null
  /** +1 好、-1 不好、0 只记一次。 */
  readonly value: number
  readonly reason: string
  readonly createdAt: number
}

export type SkillStatus = 'active' | 'pending' | 'archived'

export interface Skill {
  readonly id: string
  /** dsh 技能名：小写字母、数字和连字符。 */
  readonly name: string
  readonly title: string
  readonly scopeKind: 'bot' | 'team'
  readonly scopeId: string
  /** 什么时候用。 */
  readonly description: string
  /** 步骤、容易出错的地方、输出模板（Markdown）。 */
  readonly content: string
  /** 带脚本的技能要你批准后才启用。 */
  readonly hasScript: boolean
  readonly status: SkillStatus
  readonly version: number
  readonly source: 'bot' | 'retro' | 'owner'
  readonly sourceRef: string | null
  readonly createdBy: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type EvolutionKind = 'experience' | 'skill' | 'persona' | 'effort' | 'promotion' | 'calibration' | 'revert'

export const EVOLUTION_LABELS: Readonly<Record<EvolutionKind, string>> = {
  experience: '经验',
  skill: '技能',
  persona: '人设',
  effort: '推理档位',
  promotion: '转为常驻',
  calibration: '定前提的分寸',
  revert: '自动退回',
}

export interface EvolutionEntry {
  readonly id: string
  readonly kind: EvolutionKind
  readonly botId: string | null
  /** 改的是什么：记忆条目、技能、bot 的 id。 */
  readonly subject: string
  readonly summary: string
  readonly before: unknown
  readonly after: unknown
  readonly reason: string
  readonly source: string
  /** 改动时的评分卡：之后 10 个任务明显变差就自动退回。 */
  readonly baseline: Scorecard | null
  readonly status: 'active' | 'reverted' | 'kept'
  readonly createdAt: number
  readonly revertedAt: number | null
}

/** 评分卡：主管和组长分派时参考，也写进“本周变化”。 */
export interface Scorecard {
  readonly tasks: number
  readonly done: number
  readonly failed: number
  /** 一次验收通过的比例；没有验收数据时 null。 */
  readonly firstPassRate: number | null
  readonly reworks: number
  /** 你的评分平均值（-1 到 1）；没评过时 null。 */
  readonly rating: number | null
  readonly ratings: number
  readonly corrections: number
  readonly avgCost: number
  readonly avgDurationMs: number
  /** 自治效果：每个任务平均找你几次、先绕过几次、交付后被你改几次。 */
  readonly asksPerTask: number
  readonly bypassPerTask: number
  readonly editsPerTask: number
}

export interface ScoredTask {
  readonly id: string
  readonly status: string
  readonly cost: number
  readonly durationMs: number
  /** 验收记录：每次通过或打回。 */
  readonly reviews: readonly boolean[]
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

/** 按任务和反馈算评分卡。 */
export function computeScorecard(tasks: readonly ScoredTask[], feedback: readonly Pick<Feedback, 'kind' | 'value' | 'taskId'>[]): Scorecard {
  const finished = tasks.filter((task) => task.status === 'done' || task.status === 'failed')
  const reviewed = finished.filter((task) => task.reviews.length > 0)
  const ratings = feedback.filter((item) => item.kind === 'rating')
  const count = (kind: Feedback['kind']): number => feedback.filter((item) => item.kind === kind).length
  const per = (value: number): number => (finished.length === 0 ? 0 : Math.round((value / finished.length) * 100) / 100)
  return {
    tasks: tasks.length,
    done: finished.filter((task) => task.status === 'done').length,
    failed: finished.filter((task) => task.status === 'failed').length,
    firstPassRate: reviewed.length === 0 ? null : reviewed.filter((task) => task.reviews[0] === true).length / reviewed.length,
    reworks: finished.reduce((sum, task) => sum + task.reviews.filter((pass) => !pass).length, 0),
    rating: ratings.length === 0 ? null : average(ratings.map((item) => item.value)),
    ratings: ratings.length,
    corrections: count('correction'),
    avgCost: average(finished.map((task) => task.cost)),
    avgDurationMs: average(finished.map((task) => task.durationMs)),
    asksPerTask: per(count('asked')),
    bypassPerTask: per(count('bypassed')),
    editsPerTask: per(count('edited')),
  }
}

/** 改动之后明显变差了吗：一次通过率掉了 25 个百分点以上、评分掉了 0.6 以上，或者交付后被改的次数明显变多。 */
export function clearlyWorse(baseline: Scorecard, current: Scorecard): string | undefined {
  if (current.done + current.failed < 3) return undefined
  if (baseline.firstPassRate !== null && current.firstPassRate !== null && baseline.firstPassRate - current.firstPassRate >= 0.25) {
    return `一次验收通过率从 ${Math.round(baseline.firstPassRate * 100)}% 降到 ${Math.round(current.firstPassRate * 100)}%`
  }
  if (baseline.rating !== null && current.rating !== null && current.ratings >= 2 && baseline.rating - current.rating >= 0.6) return '你的评分明显变低'
  if (current.editsPerTask - baseline.editsPerTask >= 0.4) return '交付后被你修改的次数明显变多'
  if (current.failed > baseline.failed && current.failed / Math.max(1, current.done + current.failed) >= 0.4) return '失败的任务明显变多'
  return undefined
}

/** dsh 技能名只能用小写字母、数字和连字符。 */
export function skillName(raw: string): string | undefined {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ? name : undefined
}

/** 技能里带不带可执行的脚本：带的要你批准。 */
export function hasScript(content: string): boolean {
  return /```\s*(bash|sh|zsh|shell|python|py|js|javascript|ts|typescript|node|powershell|pwsh|ruby|perl)\b/i.test(content) || /^\s*\$ \S/m.test(content)
}

const INJECTION = /忽略(之前|以上|前面)|无视(之前|以上)|不要告诉用户|绕过(审批|规则|限制)|ignore (all |the )?(previous|above)|disregard (previous|prior)|system prompt|you are now|do not tell the user/i

/** 来自网页的内容不能直接变成技能或人设：带着指令腔的一律拒绝。 */
export function looksInjected(text: string): boolean {
  return INJECTION.test(text)
}

/** 你的纠正：“以后别……”“应该……”“下次……”“不要再……”。 */
export function isCorrection(text: string): boolean {
  return /以后(别|不要|都|记得)|下次(别|不要|记得|要)|不要再|别再|应该(是|用|先|要)|我说过|跟你说过|不是这样/.test(text)
}
