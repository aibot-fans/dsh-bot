import { execFile } from 'node:child_process'
import type { Socket } from 'node:net'
import type { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { fail as failed, ok, t, type ComputerPermissions, type ComputerStatus, type PodResult, type PodSession, type PodSettings, type Task } from 'pod-domain'
import type { SessionRegistry } from '../agents/registry.ts'
import type { Auditor } from '../core/audit.ts'
import type { WaitService } from '../waits/service.ts'
import { blockedReason, describeResponse, labelOf, normalizeApp, parseApps, snapshotIdOf, toDaemonCall, type Args, type ComputerAction, type RunningApp } from './actions.ts'
import { ComputerDaemon, type DaemonReply } from './daemon.ts'
import { ComputerGrants } from './grants.ts'
import { COMPUTER_HELP } from './help.ts'
import { ComputerHelper, helperApp } from './helper.ts'

const run = promisify(execFile)

/** 占着电脑的任务多久没动静就让给别人；再久一点就自动结束它的会话（你接管着的时候不算）。 */
const IDLE_MS = 3 * 60_000
const RELEASE_MS = 5 * 60_000
/** 电脑面板的画面：看得清就行，本机传输。 */
const STREAM = { fps: 15, maxWidth: 1600, bitrate: 2_500_000, background: '#1f1f1f' } as const

export interface ComputerOutcome {
  readonly ok: boolean
  readonly message: string
  readonly data?: Readonly<Record<string, unknown>>
  readonly image?: { readonly data: Uint8Array; readonly mediaType: string }
}

/** 占着电脑的任务：小助手一次只开一个会话。 */
interface Holder {
  readonly sessionId: string
  readonly botId: string
  readonly rootId: string
  /** start 时写的应用（原样的名字）。 */
  readonly apps: readonly string[]
  /** 画面跟着的应用：最近一次 get_app_state 看的。 */
  readonly app: string | null
  /** 你在电脑面板上接管了，bot 先停手。 */
  readonly takenOver: boolean
  readonly last: { readonly label: string; readonly at: number } | null
  readonly lastUsed: number
}

export interface ComputerServiceDeps {
  readonly db: DatabaseSync
  readonly dataRoot: string
  readonly waits: WaitService
  readonly registry: SessionRegistry
  readonly audit: Auditor
  readonly settings: () => PodSettings
  readonly now: () => number
  /** dsh web 对外开放时不让用；返回原因。 */
  readonly exposed: () => string | undefined
  readonly task: (taskId: string) => Task | undefined
  readonly botName: (botId: string) => string
  /** 谁在用、画面跟着哪个应用、接没接管、bot 又做了一步：告诉界面。 */
  readonly changed: () => void
  /** 一个任务开始用电脑：在对话里放一张电脑卡片。 */
  readonly started: (session: PodSession, apps: readonly string[]) => void
  /** 给做任务的会话递一句话（你交还电脑时）。 */
  readonly tell: (sessionId: string, text: string) => void
}

const fail = (message: string): ComputerOutcome => ({ ok: false, message })
const done = (message: string, data?: Readonly<Record<string, unknown>>): ComputerOutcome => ({ ok: true, message, ...(data === undefined ? {} : { data }) })

function appList(raw: unknown): readonly string[] {
  return Array.isArray(raw) ? [...new Set(raw.map((item) => (typeof item === 'string' ? item.trim() : '')).filter((item) => item !== ''))] : []
}

/**
 * 用电脑：照参考项目 Comma 的做法，由随 dsh-bot 一起装的小助手（它的开源 macOS 应用）在后台读写别的应用的窗口；
 * dsh-bot 这边管授权、一次一个任务、把结果交给 bot，还把正在用的应用窗口推到电脑面板上，你可以接管。
 */
export class ComputerService {
  readonly helper: ComputerHelper
  readonly daemon: ComputerDaemon
  readonly grants: ComputerGrants
  private holder: Holder | null = null
  private permissions: ComputerPermissions | null = null
  /** 电脑面板上连着的画面：电脑交还时断开。 */
  private readonly streams = new Set<() => void>()
  private readonly deps: ComputerServiceDeps

  constructor(deps: ComputerServiceDeps) {
    this.deps = deps
    this.helper = new ComputerHelper()
    this.daemon = new ComputerDaemon(deps.dataRoot, () => this.helper.prepare())
    this.grants = new ComputerGrants({ db: deps.db, waits: deps.waits, audit: deps.audit, now: deps.now, task: deps.task, botName: deps.botName })
  }

  status(): ComputerStatus {
    const holder = this.holder
    return {
      state: this.helper.state(),
      message: this.helper.message(),
      permissions: this.permissions,
      user:
        holder === null
          ? null
          : { botId: holder.botId, taskId: holder.rootId, taskTitle: this.deps.task(holder.rootId)?.title ?? '', apps: holder.apps, app: holder.app ?? holder.apps[0] ?? null, takenOver: holder.takenOver, last: holder.last },
      appPath: helperApp(),
    }
  }

  /** 问小助手系统权限给了没有（没在跑就拉起来）。 */
  async check(): Promise<ComputerStatus> {
    if (this.helper.state() === 'ready') this.remember(await this.daemon.control('permissions-status'))
    return this.status()
  }

  /** 打开小助手的授权引导窗口，带你去系统设置里给辅助功能和屏幕录制。 */
  async openPermissionFlow(): Promise<ComputerStatus> {
    this.remember(await this.daemon.control('open-permission-flow'))
    return this.status()
  }

  /** 关掉“用电脑”：收回所有授权，结束会话，小助手退出。 */
  async turnOff(): Promise<void> {
    this.grants.clear()
    this.release()
    await this.daemon.shutdown()
  }

  /** 定时看一眼：占着电脑的任务太久没动静（或会话没了）就结束它的会话；你接管着的时候只看会话还在不在。 */
  tick(): void {
    const holder = this.holder
    if (holder === null) return
    const owner = this.deps.registry.get(holder.sessionId)
    if (owner?.status === 'active' && (holder.takenOver || this.deps.now() - holder.lastUsed < RELEASE_MS)) return
    this.release()
    void this.daemon.end()
  }

  async dispose(): Promise<void> {
    this.release()
    await this.daemon.shutdown()
  }

  // ---------- 电脑面板 ----------

  /** 电脑面板的画面：推正在用电脑的任务、bot 最近看的那个应用的窗口；推不了返回原因。 */
  async stream(): Promise<Socket | string> {
    if (!this.deps.settings().computerUse) return t('用电脑关着')
    if (this.deps.exposed() !== undefined) return t('dsh web 现在对外开放，为了安全不推电脑的画面')
    const holder = this.holder
    const app = holder?.app ?? holder?.apps[0]
    if (holder === null || app === undefined) return t('现在没有 bot 在用电脑')
    const names = this.namesOf(app, await this.running())
    return this.daemon.openStream({ apps: [...new Set(names)], ...STREAM })
  }

  /** 画面连着时登记：电脑交还时断开它。返回撤销登记的函数。 */
  watch(close: () => void): () => void {
    this.streams.add(close)
    return () => {
      this.streams.delete(close)
    }
  }

  /** 你接管：bot 的动作先停下，直接在这台 Mac 上操作那个应用。 */
  takeover(): PodResult<ComputerStatus> {
    const holder = this.holder
    if (holder === null) return failed('conflict', t('现在没有 bot 在用电脑'))
    if (!holder.takenOver) {
      this.holder = { ...holder, takenOver: true }
      this.deps.audit.record('computer.takeover', 'owner', holder.sessionId, { app: holder.app })
      this.deps.changed()
    }
    return ok(this.status())
  }

  /** 交还：可以附一句话，bot 带着这句话接着做。 */
  handback(note: string): PodResult<ComputerStatus> {
    const holder = this.holder
    if (holder === null) return failed('conflict', t('现在没有 bot 在用电脑'))
    if (!holder.takenOver) return failed('conflict', t('你没有接管电脑'))
    this.holder = { ...holder, takenOver: false, lastUsed: this.deps.now() }
    this.deps.audit.record('computer.handback', 'owner', holder.sessionId, {})
    this.deps.tell(holder.sessionId, `[用户交还了电脑] ${note === '' ? '' : `用户原话：${note}。`}窗口可能变了，先 get_app_state 重新看再接着做。`)
    this.deps.changed()
    return ok(this.status())
  }

  private release(): void {
    const had = this.holder !== null
    this.holder = null
    for (const close of [...this.streams]) close()
    if (had) this.deps.changed()
  }

  private remember(reply: DaemonReply): void {
    if (reply.response.permissions !== undefined) this.permissions = reply.response.permissions
  }

  // ---------- computer_use 工具 ----------

  async call(session: PodSession, action: ComputerAction, args: Args, thinking: string): Promise<ComputerOutcome> {
    if (action === 'help') return done(COMPUTER_HELP)
    if (!this.deps.settings().computerUse) return fail('用户在设置里关掉了用电脑，不能用')
    const exposed = this.deps.exposed()
    if (exposed !== undefined) return fail(`dsh web 现在对外开放（${exposed}），为了安全用电脑已禁用`)
    const state = this.helper.state()
    if (state === 'unsupported') return fail('用电脑只支持 macOS 14 以上')
    if (state !== 'ready') return fail('这份 dsh-bot 里没带用电脑的小助手，不能用')
    const task = session.taskId === null ? undefined : this.deps.task(session.taskId)
    if (task === undefined) return fail('只有任务里能用电脑')
    if (this.holder?.sessionId === session.id && this.holder.takenOver && action !== 'stop' && action !== 'list_apps') {
      return fail('用户接管了电脑，在等用户交还。先做不依赖电脑的事，或者结束这一轮，交还时会告诉你。')
    }
    switch (action) {
      case 'list_apps':
        return this.listApps()
      case 'start':
        return this.start(session, task.rootId, args)
      case 'open_app':
        return this.openApp(task.rootId, args)
      case 'stop':
        return this.stop(session)
      default:
        return this.act(session, task.rootId, action, args, thinking)
    }
  }

  private async running(): Promise<readonly RunningApp[]> {
    const reply = await this.daemon.action('list_applications', {})
    return parseApps(reply.response.text ?? '')
  }

  /** 一个应用的所有叫法：给的名字，加上正在运行时它的名字和 bundle id。 */
  private namesOf(app: string, running: readonly RunningApp[]): readonly string[] {
    const key = normalizeApp(app)
    const match = running.find((item) => normalizeApp(item.name) === key || normalizeApp(item.bundle) === key)
    return match === undefined ? [app] : [app, match.name, match.bundle]
  }

  private async listApps(): Promise<ComputerOutcome> {
    const running = await this.running()
    const lines = running.map((item) => `${item.name} (${item.bundle})${blockedReason([item.name, item.bundle]) === undefined ? '' : ' ——不让用'}`)
    return done(lines.length === 0 ? '没有正在运行的应用' : `正在运行的应用（名字 (bundle id)）：\n${lines.join('\n')}`)
  }

  private async start(session: PodSession, rootId: string, args: Args): Promise<ComputerOutcome> {
    const apps = appList(args.apps)
    if (apps.length === 0) return fail('要写 apps：这次要用哪些应用（名字或 bundle id）')
    const running = await this.running()
    const blocked = blockedReason(apps.flatMap((app) => this.namesOf(app, running)))
    if (blocked !== undefined) return fail(blocked)
    if (!this.grants.covers(rootId, apps)) {
      if (this.grants.pending(rootId, apps) !== undefined) return done('已经在等用户批准用这些应用了。先做不依赖它的事，或者结束这一轮等答复。')
      const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
      if (reason === '') return fail('这个任务第一次用这些应用要用户批准：写上 reason（一句话，为什么要用）')
      const wait = this.grants.request(session, apps, reason)
      return done('第一次用这些应用要用户批准，已经提交。批准的答复会转给你，看到批准再 start。现在先做不依赖它的事，或者结束这一轮等答复。', { waitId: wait.id })
    }
    const claimed = await this.claim(session, rootId, apps)
    if (typeof claimed === 'string') return fail(claimed)
    let reply = await this.daemon.action('start', { mode: 'background', apps })
    if (!reply.response.ok && /already active/i.test(reply.response.error ?? '')) {
      // 小助手里还留着上一个会话（比如 dsh web 重启前的），先结束再开。
      await this.daemon.end()
      reply = await this.daemon.action('start', { mode: 'background', apps })
    }
    this.remember(reply)
    this.deps.audit.record('computer.start', session.botId, session.id, { apps, ok: reply.response.ok })
    if (!reply.response.ok) {
      this.release()
      return fail(describeResponse(reply.response, reply.notices))
    }
    this.deps.changed()
    if (claimed.fresh) this.deps.started(session, apps)
    return done(`开始了，这个任务能用：${this.grants.appsFor(rootId).join('、')}。应用没开先 open_app，然后 get_app_state 看窗口；用完 stop。用户在电脑面板上看得到画面。`)
  }

  /** 占住电脑；别的任务正在用（最近还有动静，或者你接管着）就返回原因。fresh：这个会话刚拿到电脑。 */
  private async claim(session: PodSession, rootId: string, apps: readonly string[]): Promise<{ readonly fresh: boolean } | string> {
    const holder = this.holder
    if (holder?.sessionId === session.id) {
      this.holder = { ...holder, apps: [...new Set([...holder.apps, ...apps])], lastUsed: this.deps.now() }
      return { fresh: false }
    }
    if (holder !== null) {
      const owner = this.deps.registry.get(holder.sessionId)
      if (owner?.status === 'active' && (holder.takenOver || this.deps.now() - holder.lastUsed < IDLE_MS)) {
        const title = this.deps.task(holder.rootId)?.title ?? ''
        return `电脑现在由「${this.deps.botName(holder.botId)}」在用（任务「${title}」），一次只能一个任务用。先做别的，过几分钟再试。`
      }
      this.release()
      await this.daemon.end()
    }
    this.holder = { sessionId: session.id, botId: session.botId, rootId, apps, app: null, takenOver: false, last: null, lastUsed: this.deps.now() }
    return { fresh: true }
  }

  private async openApp(rootId: string, args: Args): Promise<ComputerOutcome> {
    const app = typeof args.app === 'string' ? args.app.trim() : ''
    if (app === '') return fail('要写 app（应用名或 bundle id）')
    const blocked = blockedReason([app])
    if (blocked !== undefined) return fail(blocked)
    if (!this.grants.covers(rootId, [app])) return fail(`「${app}」用户还没批准：先 start，apps 里写上它`)
    // 带点、没有空格的当 bundle id。-g：在后台打开，不抢前台。
    const target = /^[\w-]+(\.[\w-]+)+$/.test(app) ? ['-b', app] : ['-a', app]
    await run('open', ['-g', ...target], { timeout: 30_000 }).catch((error: unknown) => {
      throw new Error(`打不开「${app}」：${error instanceof Error ? error.message : String(error)}`)
    })
    return done(`已在后台打开「${app}」，接着用 get_app_state 看它的窗口。`)
  }

  private async stop(session: PodSession): Promise<ComputerOutcome> {
    if (this.holder?.sessionId !== session.id) return done('你没在用电脑。')
    this.release()
    await this.daemon.end()
    return done('已结束，电脑交还了。')
  }

  private async act(session: PodSession, rootId: string, action: ComputerAction, args: Args, thinking: string): Promise<ComputerOutcome> {
    const holder = this.holder
    if (holder?.sessionId !== session.id) return fail('先用 start 开始（同一时间只能一个任务用电脑）')
    const call = toDaemonCall(action, args)
    if (typeof call === 'string') return fail(call)
    const looking = action === 'get_app_state' ? String(call.payload.app) : undefined
    if (looking !== undefined) {
      const names = this.namesOf(looking, await this.running())
      const blocked = blockedReason(names)
      if (blocked !== undefined) return fail(blocked)
      const granted = this.grants.appsFor(rootId)
      if (!names.some((name) => granted.includes(normalizeApp(name)))) return fail(`「${looking}」用户没批准过：要用就先 start，apps 里写上它（会再问用户一次）`)
    }
    // 画面跟着 bot 看的应用走；画面下面那行字是这一步。
    this.holder = { ...holder, app: looking ?? holder.app, last: { label: labelOf(action, args, thinking), at: this.deps.now() }, lastUsed: this.deps.now() }
    this.deps.changed()
    const reply = await this.daemon.action(call.name, call.payload, thinking)
    if (this.holder?.sessionId === session.id) this.holder = { ...this.holder, lastUsed: this.deps.now() }
    this.remember(reply)
    this.deps.audit.record('computer.action', session.botId, session.id, { action, ...(looking === undefined ? {} : { app: looking }), ok: reply.response.ok })
    const { response } = reply
    const snapshot = snapshotIdOf(response.text ?? '')
    const message = describeResponse(response, reply.notices)
    const image = response.ok && typeof response.imageData === 'string' && response.imageData !== '' ? { data: new Uint8Array(Buffer.from(response.imageData, 'base64')), mediaType: response.imageContentType ?? 'image/png' } : undefined
    return { ok: response.ok, message, ...(snapshot === undefined ? {} : { data: { snapshot_id: snapshot } }), ...(image === undefined ? {} : { image }) }
  }
}
