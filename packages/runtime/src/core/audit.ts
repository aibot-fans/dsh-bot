import type { DatabaseSync } from 'node:sqlite'
import { maskSecrets } from 'pod-domain'
import { appendAudit } from 'pod-store'

/** 审计里每段文字最多保留的字数；只记摘要，不记全文。 */
const DETAIL_TEXT_MAX = 500

function summarize(value: unknown): unknown {
  if (typeof value === 'string') {
    const masked = maskSecrets(value).text
    return masked.length > DETAIL_TEXT_MAX ? `${masked.slice(0, DETAIL_TEXT_MAX)}…` : masked
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(summarize)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, summarize(item)]))
  }
  return value
}

/** 只追加的审计日志。写入前打码、截断；写失败只告警，不影响业务。 */
export class Auditor {
  private readonly db: DatabaseSync
  private readonly now: () => number
  private readonly warn: (message: string) => void

  constructor(db: DatabaseSync, now: () => number, warn: (message: string) => void) {
    this.db = db
    this.now = now
    this.warn = warn
  }

  record(kind: string, actor: string, subject: string, detail: Readonly<Record<string, unknown>> = {}): void {
    try {
      appendAudit(this.db, {
        kind,
        actor,
        subject,
        detail: summarize(detail) as Readonly<Record<string, unknown>>,
        now: this.now(),
      })
    } catch (error) {
      this.warn(`审计日志写入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
