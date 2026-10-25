import type { DatabaseSync } from 'node:sqlite'

export interface UsageRecord {
  readonly sessionId: string | null
  readonly botId: string | null
  readonly taskId: string | null
  readonly roomId: string | null
  readonly provider: string
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheTokens: number
  readonly cost: number | null
  readonly peak: boolean
  readonly purpose: string
  readonly now: number
}

export function insertUsage(db: DatabaseSync, record: UsageRecord): void {
  db.prepare(
    `INSERT INTO usage (session_id, bot_id, task_id, room_id, provider, model, input_tokens, output_tokens, cache_tokens, cost, peak, purpose, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.sessionId,
    record.botId,
    record.taskId,
    record.roomId,
    record.provider,
    record.model,
    record.inputTokens,
    record.outputTokens,
    record.cacheTokens,
    record.cost,
    record.peak ? 1 : 0,
    record.purpose,
    record.now,
  )
}

export interface UsageTotals {
  readonly tokens: number
  readonly cost: number
}

function totals(row: { readonly tokens: number | null; readonly cost: number | null } | undefined): UsageTotals {
  return { tokens: Number(row?.tokens ?? 0), cost: Number(row?.cost ?? 0) }
}

/** 一棵任务树的用量：根任务和所有子任务。 */
export function usageForRoot(db: DatabaseSync, rootId: string): UsageTotals {
  const row = db
    .prepare(
      `SELECT SUM(u.input_tokens + u.output_tokens) AS tokens, SUM(COALESCE(u.cost, 0)) AS cost
       FROM usage u JOIN tasks t ON t.id = u.task_id WHERE t.root_id = ?`,
    )
    .get(rootId) as { readonly tokens: number | null; readonly cost: number | null } | undefined
  return totals(row)
}

export function usageForTask(db: DatabaseSync, taskId: string): UsageTotals {
  const row = db
    .prepare('SELECT SUM(input_tokens + output_tokens) AS tokens, SUM(COALESCE(cost, 0)) AS cost FROM usage WHERE task_id = ?')
    .get(taskId) as { readonly tokens: number | null; readonly cost: number | null } | undefined
  return totals(row)
}

export function usageSince(db: DatabaseSync, since: number): UsageTotals {
  const row = db
    .prepare('SELECT SUM(input_tokens + output_tokens) AS tokens, SUM(COALESCE(cost, 0)) AS cost FROM usage WHERE created_at >= ?')
    .get(since) as { readonly tokens: number | null; readonly cost: number | null } | undefined
  return totals(row)
}

export function usageByBotSince(db: DatabaseSync, since: number): ReadonlyMap<string, UsageTotals> {
  const rows = db
    .prepare(
      'SELECT bot_id, SUM(input_tokens + output_tokens) AS tokens, SUM(COALESCE(cost, 0)) AS cost FROM usage WHERE created_at >= ? AND bot_id IS NOT NULL GROUP BY bot_id',
    )
    .all(since) as unknown as readonly { readonly bot_id: string; readonly tokens: number; readonly cost: number }[]
  return new Map(rows.map((row) => [row.bot_id, { tokens: Number(row.tokens), cost: Number(row.cost) }]))
}

/** 一次模型调用的用量，带上它所在的对话（任务会话按任务所在的群聊算）。 */
export interface UsageRow {
  readonly botId: string | null
  readonly roomId: string | null
  readonly sessionId: string | null
  readonly provider: string
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheTokens: number
  readonly cost: number
  readonly peak: boolean
  readonly createdAt: number
}

/** 某个时刻以来的用量明细，给用量页按时间、bot、对话汇总。 */
export function usageRowsSince(db: DatabaseSync, since: number): readonly UsageRow[] {
  const rows = db
    .prepare(
      `SELECT u.bot_id, COALESCE(u.room_id, t.room_id) AS room_id, u.session_id, u.provider, u.model, u.input_tokens, u.output_tokens,
              u.cache_tokens, COALESCE(u.cost, 0) AS cost, u.peak, u.created_at
       FROM usage u LEFT JOIN tasks t ON t.id = u.task_id WHERE u.created_at >= ? ORDER BY u.created_at`,
    )
    .all(since) as unknown as readonly {
    readonly bot_id: string | null
    readonly room_id: string | null
    readonly session_id: string | null
    readonly provider: string
    readonly model: string
    readonly input_tokens: number
    readonly output_tokens: number
    readonly cache_tokens: number
    readonly cost: number
    readonly peak: number
    readonly created_at: number
  }[]
  return rows.map((row) => ({
    botId: row.bot_id,
    roomId: row.room_id,
    sessionId: row.session_id,
    provider: row.provider,
    model: row.model,
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cacheTokens: Number(row.cache_tokens),
    cost: Number(row.cost),
    peak: row.peak === 1,
    createdAt: Number(row.created_at),
  }))
}
