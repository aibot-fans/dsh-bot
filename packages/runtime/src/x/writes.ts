import type { DatabaseSync } from 'node:sqlite'
import { XPostError } from 'aibot-x-post'
import { PRIORITY, SITE_MODE_LABELS, fnv1a, newId, t, xWriteMode, type PodSession, type PodSettings, type Wait } from 'pod-domain'
import { readState, writeState } from 'pod-store'
import type { Dispatcher } from '../agents/dispatcher.ts'
import { noticeSource } from '../agents/messages.ts'
import type { SessionRegistry } from '../agents/registry.ts'
import { APPROVE } from '../browser/approvals.ts'
import type { Auditor } from '../core/audit.ts'
import type { WaitService } from '../waits/service.ts'
import type { XAccount } from './account.ts'
import { describe, fields, linkOf, perform, type XWrite } from './actions.ts'
import { xErrorText } from './errors.ts'

export interface XWritesDeps {
  readonly db: DatabaseSync
  readonly account: XAccount
  readonly waits: WaitService
  readonly registry: SessionRegistry
  readonly dispatcher: Dispatcher
  readonly audit: Auditor
  readonly settings: () => PodSettings
  readonly now: () => number
  /** dsh web 对外开放时 X 写操作一律不做；返回原因。 */
  readonly exposed: () => string | undefined
  /** 受污染的会话要把内容发出去时，查有没有夹带私有信息；拦下时返回给 bot 的话。 */
  readonly exfiltration: (session: PodSession, key: string, candidate: string, title: string) => string | undefined
}

export interface XWriteOutcome {
  readonly ok: boolean
  readonly message: string
  readonly data?: Readonly<Record<string, unknown>>
}

interface InFlight {
  readonly key: string
  readonly sessionId: string
  readonly description: string
  readonly url: string
  readonly at: number
}

const INFLIGHT_KEY = 'x.inflight'

/**
 * X 写操作（发推、删推、点赞、转推、关注）按 x.com 的站点规则走：免审批的直接做；
 * 写操作需审批（默认）的交给你批准，批准后按原样执行，结果发回给 bot；只读和禁止的不做。
 * dsh web 对外开放时一律不做。
 */
export class XWrites {
  private readonly deps: XWritesDeps

  constructor(deps: XWritesDeps) {
    this.deps = deps
  }

  async request(session: PodSession, write: XWrite): Promise<XWriteOutcome> {
    const description = describe(write)
    const exposed = this.deps.exposed()
    if (exposed !== undefined) return { ok: false, message: `dsh web 现在对外开放（${exposed}），为了安全 X 写操作已禁用：「${description}」没有做。` }
    const mode = xWriteMode(this.deps.settings().siteRules)
    if (mode === 'blocked' || mode === 'read-only') {
      return { ok: false, message: `设置里 x.com 是「${SITE_MODE_LABELS[mode]}」，X 写操作不能做：「${description}」没有做。需要的话请用户在 设置 → 通用 → X 写操作 里改。` }
    }
    if (write.action === 'post') {
      const blocked = this.deps.exfiltration(session, `x:${fnv1a(write.text)}`, write.text, t('发到 X 的内容可能夹带私有信息'))
      if (blocked !== undefined) return { ok: false, message: blocked }
    }
    if (mode === 'free') return this.execute(session.id, session.botId, write)
    if (!(await this.deps.account.signedIn())) return { ok: false, message: xErrorText(new XPostError('not-logged-in', '')) }
    const link = linkOf(write)
    const form = fields(write)
    const handle = this.deps.account.status().handle
    const wait = this.deps.waits.ask({
      session,
      kind: 'write',
      title: t('批准：{description}', { description }),
      detail: [handle === '' ? '' : t('X 账号：@{handle}', { handle }), link === '' ? '' : t('网址：{url}', { url: link }), ...form.map((field) => `${field.label}：${field.value}`)].filter(Boolean).join('\n'),
      bypassed: false,
      data: { channel: 'x', write, description, url: link, form, account: handle },
    })
    return {
      ok: true,
      message: '这是 X 写操作，已提交给用户审批。批准后 dsh-bot 用浏览器里登录的 X 账号按原样执行，并把结果发给你。现在先做不依赖它的事，或者结束这一轮等结果。',
      data: { waitId: wait.id },
    }
  }

  /** 审批的答复：批准就照做，结果发回给 bot。返回 true 表示已经处理，不再按默认方式转回。 */
  resolve(wait: Wait, answer: string): boolean {
    void this.approve(wait, answer).catch((error: unknown) => this.tell(wait.sessionId, `[审批后执行失败] ${xErrorText(error)}`))
    return true
  }

  private async approve(wait: Wait, answer: string): Promise<void> {
    const description = String(wait.data.description ?? wait.title)
    if (!APPROVE.test(answer.trim())) {
      this.tell(wait.sessionId, `[用户没有批准「${description}」] 用户原话：${answer || '不批准'}。不要再尝试这个操作，换别的做法，或在交付里说明。`)
      return
    }
    const exposed = this.deps.exposed()
    if (exposed !== undefined) {
      this.tell(wait.sessionId, `[审批作废] dsh web 现在对外开放（${exposed}），X 写操作已禁用，「${description}」没有做。`)
      return
    }
    const outcome = await this.execute(wait.sessionId ?? '', 'owner', wait.data.write as XWrite, wait.id)
    this.tell(wait.sessionId, `[用户批准了「${description}」] ${outcome.message}`)
  }

  private async execute(sessionId: string, actor: string, write: XWrite, key: string = newId('xw')): Promise<XWriteOutcome> {
    const description = describe(write)
    this.markInFlight({ key, sessionId, description, url: linkOf(write) || 'https://x.com', at: this.deps.now() })
    try {
      const done = await this.deps.account.use((xpost) => perform(xpost, write))
      this.deps.audit.record('x.write', actor, key, { action: write.action, description, ok: done.ok, ...done.data })
      return { ok: done.ok, message: done.message, data: done.data }
    } catch (error) {
      if (error instanceof XPostError) return { ok: false, message: `「${description}」没做成：${xErrorText(error)}` }
      return { ok: false, message: `「${description}」执行时出错（${xErrorText(error)}），不确定 X 那边有没有生效：先确认，别直接重做。` }
    } finally {
      this.clearInFlight(key)
    }
  }

  private tell(sessionId: string | null, text: string): void {
    if (sessionId === null || this.deps.registry.get(sessionId) === undefined) return
    this.deps.dispatcher.enqueue({
      sessionId,
      mode: this.deps.dispatcher.isRunning(sessionId) ? 'steer' : 'followup',
      priority: PRIORITY.owner,
      text,
      source: noticeSource(t('X 写操作审批')),
    })
  }

  // ---------- 执行到一半断了 ----------

  private inFlight(): readonly InFlight[] {
    return readState<readonly InFlight[]>(this.deps.db, INFLIGHT_KEY, [])
  }

  private markInFlight(entry: InFlight): void {
    writeState(this.deps.db, INFLIGHT_KEY, [...this.inFlight(), entry])
  }

  private clearInFlight(key: string): void {
    writeState(this.deps.db, INFLIGHT_KEY, this.inFlight().filter((entry) => entry.key !== key))
  }

  /** dsh web 重启时，上次正在执行的 X 写操作标为“状态未知”：先问你，不自动重做。 */
  markUnknown(): void {
    const entries = this.inFlight()
    if (entries.length === 0) return
    writeState(this.deps.db, INFLIGHT_KEY, [])
    for (const entry of entries) {
      const session = this.deps.registry.get(entry.sessionId)
      if (session === undefined) continue
      this.deps.waits.ask({
        session,
        kind: 'unknown-state',
        title: t('状态未知：{description}', { description: entry.description }),
        detail: t('执行到一半 dsh web 停了，不确定 X 那边有没有生效。请到 {url} 上确认；dsh-bot 不会自动重做。', { url: entry.url }),
        bypassed: false,
        data: { url: entry.url },
      })
    }
  }
}
