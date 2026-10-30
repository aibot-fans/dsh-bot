import type { DatabaseSync } from 'node:sqlite'
import { XError, endpointName, fromErrors, readErrors } from 'aibot-x-post'
import { PRIORITY, SITE_MODE_LABELS, fnv1a, newId, t, xWriteMode, type PodSession, type PodSettings, type Wait } from 'pod-domain'
import { readState, writeState } from 'pod-store'
import type { Dispatcher } from '../agents/dispatcher.ts'
import { noticeSource } from '../agents/messages.ts'
import type { SessionRegistry } from '../agents/registry.ts'
import { APPROVE } from '../browser/approvals.ts'
import type { Auditor } from '../core/audit.ts'
import type { WaitService } from '../waits/service.ts'
import type { XAccount } from './account.ts'
import { createdLink, describe, fields, isRoutine, linkOf, outgoingText, perform, type XWrite } from './actions.ts'
import { xErrorText } from './errors.ts'
import { refundReason, type XMeter } from './meter.ts'
import type { XResponses } from './responses.ts'

export interface XWritesDeps {
  readonly db: DatabaseSync
  readonly account: XAccount
  readonly responses: XResponses
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
  /** 访问 X 前扣 aibot 的次数，没做成退回。 */
  readonly meter: XMeter
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
 * X 写操作（x_api_request 里改东西的请求：发推、删推、点赞、关注……）按 x.com 的站点规则走：免审批时常用的写操作直接做，
 * 别的和写操作需审批（默认）时一样交给你批准，批准后按原样执行，结果发回给 bot；只读和禁止的不做。
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
    const candidate = outgoingText(write)
    if (candidate !== '') {
      const blocked = this.deps.exfiltration(session, `x:${fnv1a(candidate)}`, candidate, t('发到 X 的内容可能夹带私有信息'))
      if (blocked !== undefined) return { ok: false, message: blocked }
    }
    const unseen = this.unseenFiles(session, write)
    const unusual = mode === 'free' && !isRoutine(write)
    if (mode === 'free' && !unseen && !unusual) return this.execute(session.id, session.botId, write)
    // 次数已经用完就不让你白批一次。
    const blocked = this.deps.meter.blocked()
    if (blocked !== undefined) return { ok: false, message: `「${description}」没有做：${blocked}` }
    if (!(await this.deps.account.signedIn())) return { ok: false, message: xErrorText(new XError('not-logged-in', '')) }
    const link = linkOf(write)
    const form = fields(write)
    const handle = this.deps.account.status().handle
    const reason = unseen ? t('这个会话读过网页等外部内容，带文件的推文先给你看一眼') : unusual ? t('免审批只管发推、点赞、关注这类常用操作，别的写请求照样先给你看') : undefined
    const wait = this.deps.waits.ask({
      session,
      kind: 'write',
      title: t('批准：{description}', { description }),
      detail: [handle === '' ? '' : t('X 账号：@{handle}', { handle }), link === '' ? '' : t('网址：{url}', { url: link }), ...form.map((field) => `${field.label}：${field.value}`)].filter(Boolean).join('\n'),
      bypassed: false,
      data: { channel: 'x', write, description, url: link, form, account: handle, ...(reason === undefined ? {} : { reason }) },
    })
    return {
      ok: true,
      message: '这是 X 写操作，已提交给用户审批。批准后 dsh-bot 用浏览器里登录的 X 账号按原样执行，并把结果发给你。现在先做不依赖它的事，或者结束这一轮等结果。',
      data: { waitId: wait.id },
    }
  }

  /** 文件里是什么查不了：会话读过外部内容（受污染）时带文件发推，免审批也交给你批准。 */
  private unseenFiles(session: PodSession, write: XWrite): boolean {
    if ((write.media?.length ?? 0) === 0) return false
    return this.deps.registry.get(session.id)?.tainted ?? session.tainted
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
    const endpoint = endpointName(write.request)
    const charge = await this.deps.meter.charge({ tool: 'x_api_request', kind: 'write', files: write.media?.length ?? 0 })
    if (charge.blocked !== undefined) return { ok: false, message: `「${description}」没有做：${charge.blocked}` }
    this.markInFlight({ key, sessionId, description, url: linkOf(write) || 'https://x.com', at: this.deps.now() })
    try {
      const response = await this.deps.account.use((client) => perform(client, write))
      const id = this.deps.responses.add(sessionId, response)
      const errors = readErrors(response)
      const link = createdLink(response)
      this.deps.audit.record('x.write', actor, key, { endpoint, description, ok: errors.length === 0, response: id, ...(link === '' ? {} : { url: link }) })
      if (errors.length > 0) {
        this.deps.meter.refund(charge, 'x_errors')
        return { ok: false, message: `「${description}」没做成：${xErrorText(fromErrors(errors))}。响应存为 ${id}，可以用 x_filter_response 看。`, data: { id } }
      }
      const done = link === '' ? `「${description}」已发出` : `「${description}」已发出：${link}`
      return { ok: true, message: `${done}。响应存为 ${id}（用 x_filter_response 看）；写操作的返回不一定准，要确认就用读的接口再查一次，别直接重发。`, data: { id, ...(link === '' ? {} : { url: link }) } }
    } catch (error) {
      // X 明确说了没做成才退；别的错不知道 X 那边有没有生效，次数照扣。
      if (error instanceof XError) {
        this.deps.meter.refund(charge, refundReason(error))
        return { ok: false, message: `「${description}」没做成：${xErrorText(error)}` }
      }
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
