/**
 * 用量和花费。token 数以模型接口返回的实际用量为准；只有认识的模型才算钱，
 * 其余只显示 token 数。价格单位：美元 / 100 万 tokens。
 */

export interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
}

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }

export function addUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
  }
}

interface Price {
  readonly cacheHit: number
  readonly miss: number
  readonly output: number
}

interface PriceRow {
  readonly match: RegExp
  readonly offPeak: Price
  readonly peak: Price
}

/** 估算花费用的 DeepSeek 价格；高峰为北京时间工作日 09:00–12:00、14:00–18:00。 */
const PRICES: readonly PriceRow[] = [
  {
    match: /flash|chat|v3/i,
    offPeak: { cacheHit: 0.003, miss: 0.15, output: 0.6 },
    peak: { cacheHit: 0.006, miss: 0.3, output: 1.2 },
  },
  {
    match: /pro|reasoner|r1/i,
    offPeak: { cacheHit: 0.022, miss: 0.66, output: 1.98 },
    peak: { cacheHit: 0.044, miss: 1.32, output: 3.96 },
  },
]

/**
 * 估算一次请求的花费（美元）。不认识的模型返回 undefined，界面只显示 token。
 * @param provider - 模型服务，只有 deepseek 系列才有价格。
 */
export function costOf(provider: string, model: string, usage: Usage, peak: boolean): number | undefined {
  if (!/deepseek/i.test(provider) && !/deepseek/i.test(model)) return undefined
  const row = PRICES.find((candidate) => candidate.match.test(model)) ?? PRICES[0]
  if (row === undefined) return undefined
  const price = peak ? row.peak : row.offPeak
  const cached = Math.min(usage.cacheReadTokens, usage.inputTokens)
  const missed = usage.inputTokens - cached
  return (cached * price.cacheHit + missed * price.miss + usage.outputTokens * price.output) / 1_000_000
}

export function formatCost(cost: number): string {
  if (cost === 0) return '$0'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`
  return `${(tokens / 1_000_000).toFixed(2)}M`
}
