import type { DatabaseSync } from 'node:sqlite'
import { readJson, writeJson } from './json.ts'

/**
 * 只追加的审计日志：工具调用摘要、审批记录、浏览器写操作、委派链、配置改动。
 * 表上有触发器，改和删都会被拒绝。
 */
export interface AuditEntry {
  readonly id: number
  readonly kind: string
  /** 谁做的：owner（你）、bot id、pod（Pod 自己）。 */
  readonly actor: string
  readonly subject: string
  readonly detail: Readonly<Record<string, unknown>>
  readonly createdAt: number
}

interface AuditRow {
  readonly id: number
  readonly kind: string
  readonly actor: string
  readonly subject: string
  readonly detail: string
  readonly created_at: number
}

export function appendAudit(
  db: DatabaseSync,
  entry: Omit<AuditEntry, 'id' | 'createdAt'> & { readonly now: number },
): void {
  db.prepare('INSERT INTO audit (kind, actor, subject, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(
    entry.kind,
    entry.actor,
    entry.subject,
    writeJson(entry.detail),
    entry.now,
  )
}

export function listAudit(db: DatabaseSync, options: { readonly limit: number; readonly before?: number }): readonly AuditEntry[] {
  const rows = (
    options.before === undefined
      ? db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(options.limit)
      : db.prepare('SELECT * FROM audit WHERE id < ? ORDER BY id DESC LIMIT ?').all(options.before, options.limit)
  ) as unknown as readonly AuditRow[]
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    actor: row.actor,
    subject: row.subject,
    detail: readJson<Readonly<Record<string, unknown>>>(row.detail, {}),
    createdAt: row.created_at,
  }))
}
