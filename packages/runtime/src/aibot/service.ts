import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { t, type AibotBind, type AibotBindResult, type AibotState, type AibotStatus, type PodSession, type PodSettings } from 'pod-domain'
import { ensureAibotDevice, readAibotDevice, readState, saveAibotKey, setAibotDisabled, type AibotDevice } from 'pod-store'
import type { BotService } from '../bots/service.ts'
import type { RoomService } from '../chat/rooms.ts'
import type { PodBus } from '../core/bus.ts'
import type { ToolDefinition } from '../dsh.ts'
import type { NotificationService } from '../notify/service.ts'
import type { XCharge, XUsage } from '../x/meter.ts'
import { AIBOT_SITE, AibotClient, count, isJson, networkText, reasonOf, text, toTime, type Json } from './client.ts'
import { parseDaily, parseInfo, type DeviceInfo } from './device.ts'
import { AibotError, DEVICE_DISABLED, DISABLED_TEXT, INVALID_KEY, isQuotaCode, localQuotaText, quotaText, signupText, toolErrorText } from './errors.ts'
import { XInbox } from './inbox.ts'
import { McpClient, type McpTool } from './mcp.ts'
import { localizeX, seedX, xBot } from './seed.ts'
import { MonitorStream, type StreamState } from './stream.ts'
import { wantsX, xTools, type XToolValue } from './tools.ts'

export interface AibotDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly settings: () => PodSettings
  readonly bots: BotService
  readonly rooms: RoomService
  readonly notifications: NotificationService
  readonly version: string
  readonly now: () => number
  readonly warn: (message: string) => void
  /** X 工具装好或换了以后，让相关会话重新装一遍工具。 */
  readonly toolsChanged: () => void
}

const REFRESH_MS = 10 * 60_000
const AFTER_CALL_REFRESH_MS = 20_000
const REPROVISION_GAP_MS = 10 * 60_000
/** 网络问题的重试间隔：1 分钟起，最长 1 小时。 */
const NETWORK_RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]

/** 不扣次数的工具（监控相关、查额度）：额度用完时照常能调。这是计费规则，annotations 里没有，只能按名字认。 */
function isFreeTool(name: string): boolean {
  return name.startsWith('twitter_monitor') || name === 'twitter_get_quota' || name === 'twitter_list_usage'
}

/** 工具列表的指纹：名字和读写标记有变化，就要重新装进会话。 */
function toolSignature(tools: readonly McpTool[]): string {
  return tools.map((tool) => `${tool.name}:${tool.readOnly ? 'r' : 'w'}${tool.destructive ? 'd' : ''}`).join(',')
}

/**
 * aibot 接入：第一次启动免登录开通（安装码和 Key 只存在 Pod 的数据库里），
 * 当 MCP 客户端把 X 工具装进相关 bot 的会话，有监控时连实时事件流、把事件发进「X 监控」群聊并发通知。
 * 额度用完、风控、设备停用都按 aibot 的错误码给一句话；停用后不再自动调用，也不换安装码重新开通。
 */
export class AibotService {
  private readonly deps: AibotDeps
  private readonly client = new AibotClient()
  private readonly mcp: McpClient
  private readonly stream: MonitorStream
  private readonly inbox: XInbox
  private device: AibotDevice | undefined
  private state: AibotState = 'starting'
  private message = ''
  private info: DeviceInfo | undefined
  private checkedAt: number | null = null
  private tools: readonly McpTool[] = []
  private definitions: readonly ToolDefinition[] = []
  private streamState: StreamState = 'idle'
  private retryAt: number | null = null
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private networkFailures = 0
  private reprovisionedAt = 0
  private booting: Promise<void> | undefined
  private running = false
  /** 当天额度用完时记下错误码，避免同一天反复打扰；明早恢复。 */
  private quotaBlock: { readonly code: string; readonly until: number } | undefined

  constructor(deps: AibotDeps) {
    this.deps = deps
    this.device = readAibotDevice(deps.db)
    this.mcp = new McpClient({ endpoint: this.client.url('/x-api/mcp'), key: () => this.device?.apiKey ?? '', version: deps.version })
    this.inbox = new XInbox({
      db: deps.db,
      bots: deps.bots,
      rooms: deps.rooms,
      notifications: deps.notifications,
      now: deps.now,
      page: (since, cursor) => this.authed((key) => this.client.events(key, since, cursor)),
    })
    this.stream = new MonitorStream({
      url: this.client.url('/twitter/monitor/events/stream'),
      key: () => this.key(),
      onEvent: (raw) => this.inbox.receive([raw], true),
      onOpen: () => this.inbox.backfill(),
      onState: (state) => {
        this.streamState = state
        this.emit()
      },
      onRefused: (error) => this.refused(error),
      warn: deps.warn,
    })
  }

  private get enabled(): boolean {
    return this.deps.settings().aibotEnabled
  }

  private key(): string | undefined {
    const key = this.device?.apiKey ?? ''
    return key === '' || this.device?.disabledAt !== null ? undefined : key
  }

  private emit(): void {
    this.deps.bus.emit({ type: 'aibot' })
  }

  /** 插件启动：建好默认的 X bot 和群聊，开着的话开通并连上；设置里的开关一变就跟着开关。 */
  start(): () => void {
    seedX(this.deps.db, this.deps.bots, this.deps.rooms)
    localizeX(this.deps.db, this.deps.bots, this.deps.rooms)
    this.running = true
    void this.boot()
    return () => this.shutdown()
  }

  /** 语言换了：默认的 X bot 和群跟着换。 */
  languageChanged(): void {
    localizeX(this.deps.db, this.deps.bots, this.deps.rooms)
  }

  /** 设置里的开关变了。 */
  settingsChanged(next: PodSettings, previous: PodSettings): void {
    if (next.aibotEnabled === previous.aibotEnabled || !this.running) return
    if (next.aibotEnabled) void this.boot()
    else this.pause()
  }

  private shutdown(): void {
    this.running = false
    this.pause()
  }

  /** 关掉：不调 aibot、不连事件流；Key 和安装码保留。 */
  private pause(): void {
    clearTimeout(this.retryTimer)
    clearTimeout(this.refreshTimer)
    this.retryTimer = undefined
    this.refreshTimer = undefined
    this.retryAt = null
    this.stream.stop()
    this.setState('off', '')
    this.setTools([])
  }

  private setState(state: AibotState, message: string): void {
    this.state = state
    this.message = message
    this.emit()
  }

  private boot(): Promise<void> {
    if (this.booting !== undefined) return this.booting
    this.booting = this.bootOnce().finally(() => {
      this.booting = undefined
    })
    return this.booting
  }

  private async bootOnce(): Promise<void> {
    if (!this.running || !this.enabled) {
      this.setState('off', '')
      return
    }
    clearTimeout(this.retryTimer)
    this.retryAt = null
    this.device = ensureAibotDevice(this.deps.db, this.device?.installSecret ?? randomBytes(32).toString('base64url'), this.deps.now())
    if (this.device.disabledAt !== null) {
      this.setState('disabled', DISABLED_TEXT)
      return
    }
    if (this.device.apiKey === '') {
      this.setState('starting', '正在开通 aibot')
      if (!(await this.provision())) return
    }
    await this.refresh()
    if (this.state === 'ready') await this.loadTools()
  }

  /** 用安装码开通（或者取回同一把 Key）。失败时按错误码等一段时间再试。 */
  private async provision(): Promise<boolean> {
    const device = this.device
    if (device === undefined) return false
    try {
      const result = await this.client.provision(device.installSecret, this.deps.version)
      saveAibotKey(this.deps.db, result.apiKey, result.deviceId, this.deps.now())
      this.device = readAibotDevice(this.deps.db)
      this.networkFailures = 0
      this.mcp.reset()
      return true
    } catch (error) {
      if (error instanceof AibotError) {
        if (error.code === DEVICE_DISABLED) {
          this.markDisabled()
          return false
        }
        const seconds = error.retryAfterSeconds ?? (error.status === 503 ? 3600 : error.status === 429 ? 600 : 1800)
        this.schedule(seconds * 1000, 'waiting', signupText(error))
        return false
      }
      this.networkTrouble(error)
      return false
    }
  }

  private networkTrouble(error: unknown): void {
    const delay = NETWORK_RETRY_MS[Math.min(this.networkFailures, NETWORK_RETRY_MS.length - 1)] ?? 3_600_000
    this.networkFailures += 1
    this.schedule(delay, 'error', t('{reason}，稍后自动重试', { reason: networkText(error) }))
  }

  private schedule(delayMs: number, state: AibotState, message: string): void {
    clearTimeout(this.retryTimer)
    this.retryAt = this.deps.now() + delayMs
    this.retryTimer = setTimeout(() => void this.boot(), delayMs)
    this.retryTimer.unref?.()
    this.setState(state, message)
  }

  /** 停用：停掉事件流和自动调用；只在你点“重试”时查一次。 */
  private markDisabled(): void {
    setAibotDisabled(this.deps.db, this.deps.now(), this.deps.now())
    this.device = readAibotDevice(this.deps.db)
    clearTimeout(this.retryTimer)
    clearTimeout(this.refreshTimer)
    this.retryAt = null
    this.stream.stop()
    this.setTools([])
    this.setState('disabled', DISABLED_TEXT)
  }

  /**
   * 带 Key 的调用：Key 失效（401）时用原来的安装码重新取一次 Key 再试一回（10 分钟内最多一次）；
   * 设备停用（403）时转成停用状态。
   */
  private async authed<T>(work: (key: string) => Promise<T>): Promise<T> {
    const key = this.key()
    if (key === undefined) throw new Error(this.state === 'disabled' ? t(DISABLED_TEXT) : t('aibot 还没开通'))
    try {
      return await work(key)
    } catch (error) {
      if (!(error instanceof AibotError)) throw error
      if (error.code === DEVICE_DISABLED) this.markDisabled()
      if ((error.code === INVALID_KEY || error.status === 401) && this.deps.now() - this.reprovisionedAt > REPROVISION_GAP_MS) {
        this.reprovisionedAt = this.deps.now()
        if (await this.provision()) {
          const fresh = this.key()
          if (fresh !== undefined) return work(fresh)
        }
      }
      throw error
    }
  }

  /** 读一次设备状态（额度、监控数、能不能绑定），顺便决定连不连事件流。 */
  private async refresh(): Promise<void> {
    clearTimeout(this.refreshTimer)
    try {
      const data = await this.authed((key) => this.client.device(key))
      this.info = parseInfo(data)
      this.checkedAt = this.deps.now()
      this.networkFailures = 0
      const paused = this.info.dailyFree?.pausedReason
      const blocked = this.quotaBlock !== undefined && this.deps.now() < this.quotaBlock.until ? quotaText(this.quotaBlock.code) : undefined
      this.setState('ready', paused === 'fuse' ? 'aibot 今天的免费额度已经发完，明早 8 点恢复' : paused === 'disabled' ? 'aibot 免费额度暂时不可用' : (blocked ?? ''))
      this.syncStream()
    } catch (error) {
      if (this.state === 'disabled') return
      if (error instanceof AibotError) {
        this.schedule((error.retryAfterSeconds ?? 600) * 1000, 'error', t('aibot 返回错误：{message}', { message: error.message }))
        return
      }
      this.networkTrouble(error)
      return
    }
    this.refreshTimer = setTimeout(() => void this.refresh(), REFRESH_MS)
    this.refreshTimer.unref?.()
  }

  /** 调用以后过一会儿再读一次额度（几次调用合成一次）。 */
  private refreshSoon(): void {
    if (this.state !== 'ready') return
    clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => void this.refresh(), AFTER_CALL_REFRESH_MS)
    this.refreshTimer.unref?.()
  }

  private syncStream(wanted = false): void {
    const monitors = this.info?.monitor?.activeSubscriptionCount ?? 0
    if (this.state === 'ready' && this.enabled && (monitors > 0 || wanted)) this.stream.start()
    else if (monitors === 0 && !wanted) this.stream.stop()
  }

  private async loadTools(): Promise<void> {
    try {
      const tools = await this.authed(() => this.mcp.listTools())
      this.setTools(tools)
    } catch (error) {
      this.deps.warn(`拉 aibot 的工具列表失败：${error instanceof AibotError ? error.message : reasonOf(error)}`)
    }
  }

  private setTools(tools: readonly McpTool[]): void {
    const changed = toolSignature(tools) !== toolSignature(this.tools)
    this.tools = tools
    this.definitions = xTools(tools, (name, args) => this.call(name, args))
    if (changed) {
      this.emit()
      this.deps.toolsChanged()
    }
  }

  /** 哪些会话装 X 工具：X 情报员、主管、标签里提到 X 或推特的 bot，以及「X 监控」群里的会话。 */
  toolsFor(session: PodSession): readonly ToolDefinition[] {
    if (this.definitions.length === 0 || this.state === 'disabled' || !this.enabled) return []
    return this.coversX(session) ? this.definitions : []
  }

  /** 会话在不在用 X 的范围里（不管 aibot 开没开）：x_ 工具也按它装。 */
  coversX(session: PodSession): boolean {
    if (session.kind !== 'chat' && session.kind !== 'task' && session.kind !== 'coord') return false
    const bot = this.deps.bots.get(session.botId)
    if (bot === undefined) return false
    const inRoom = session.roomId !== null && session.roomId === this.roomId()
    return bot.role === 'lead' || bot.id === xBot(this.deps.db, this.deps.bots)?.id || wantsX(bot) || inRoom
  }

  /** 会不会装 X 工具：toolsFor 的简化版，给重新装工具时挑会话用。 */
  wantsTools(botId: string): boolean {
    const bot = this.deps.bots.get(botId)
    return bot !== undefined && (bot.role === 'lead' || bot.id === xBot(this.deps.db, this.deps.bots)?.id || wantsX(bot))
  }

  private roomId(): string | null {
    const record = readState<{ readonly roomId?: string } | null>(this.deps.db, 'aibot.seed', null)
    return record?.roomId ?? null
  }

  /** bot 调一个 X 工具。 */
  async call(name: string, args: unknown): Promise<XToolValue> {
    if (!this.enabled) return { ok: false, message: t('aibot 接入在设置里关掉了，X 工具暂时不能用。') }
    if (this.state === 'disabled') return { ok: false, message: toolErrorText(DEVICE_DISABLED, DISABLED_TEXT) }
    const blocked = this.quotaBlock
    if (blocked !== undefined && this.deps.now() < blocked.until && !isFreeTool(name)) {
      return { ok: false, message: toolErrorText(blocked.code, quotaText(blocked.code) ?? '') }
    }
    try {
      const result = await this.authed(() => this.mcp.callTool(name, args))
      const body = result.content
        .map((block) => (block.type === 'text' ? text(block.text) : ''))
        .filter((part) => part !== '')
        .join('\n')
      const structured = body === '' && result.structured !== undefined ? JSON.stringify(result.structured) : body
      // 按 annotations 认：只增不删的写操作（加监控）马上连事件流；删改监控的等下面刷新完，按剩下的监控数决定连不连。
      const tool = this.tools.find((item) => item.name === name)
      if (tool !== undefined && !tool.readOnly && !tool.destructive && !result.isError) this.syncStream(true)
      this.refreshSoon()
      return result.isError ? { ok: false, message: structured || t('aibot 返回了错误') } : { ok: true, message: '', text: structured }
    } catch (error) {
      if (error instanceof AibotError) {
        if (isQuotaCode(error.code)) this.quotaHit(error)
        return { ok: false, message: toolErrorText(error.code, error.message) }
      }
      return { ok: false, message: t('{networkText}，这次没查到，稍后再试。', { networkText: networkText(error) }) }
    }
  }

  /** 额度用完：记到明早恢复，状态页显示原因；监控照常。 */
  private quotaHit(error: AibotError): void {
    const until = toTime(error.details.resetAt) ?? this.info?.dailyFree?.resetAt ?? this.deps.now() + 3_600_000
    this.quotaBlock = { code: error.code, until }
    if (this.info?.dailyFree !== undefined && this.info.dailyFree !== null) {
      this.info = { ...this.info, dailyFree: { ...this.info.dailyFree, remaining: 0, resetAt: until } }
    }
    this.setState('ready', quotaText(error.code) ?? '')
  }

  // ---------- 用登录的 X 账号读写 X ----------

  /**
   * 访问 X 前扣次数（读 1 次，写 4 次，每个文件另加 2 次）：额度用完时返回给 bot 的话；
   * aibot 没开、还没开通好、停用了、连不上或还不支持时照常做、不扣。
   */
  async chargeLocal(usage: XUsage): Promise<XCharge> {
    const blocked = this.localBlocked()
    if (blocked !== undefined) return { blocked }
    if (!this.enabled || this.state !== 'ready') return {}
    try {
      const data = await this.authed((key) => this.client.chargeLocal(key, usage))
      this.updateDaily(data)
      const receipt = text(data.receipt)
      return receipt === '' ? {} : { receipt }
    } catch (error) {
      if (!(error instanceof AibotError) || !isQuotaCode(error.code)) return {}
      this.quotaHit(error)
      return { blocked: localQuotaText(error.code) }
    }
  }

  /** X 那边没做成：把扣的次数退回去。不等结果，退不成就算了。 */
  refundLocal(receipt: string | undefined, reason: string): void {
    if (receipt === undefined || !this.enabled) return
    void this.authed((key) => this.client.refundLocal(key, receipt, reason))
      .then((data) => this.updateDaily(data))
      .catch((error: unknown) => this.deps.warn(`退回读写 X 扣的次数失败：${error instanceof AibotError ? error.message : reasonOf(error)}`))
  }

  /** 今天的额度已经用完（看记下的，不发请求）时给 bot 的话。 */
  localBlocked(): string | undefined {
    const blocked = this.quotaBlock
    if (!this.enabled || this.state !== 'ready' || blocked === undefined || this.deps.now() >= blocked.until) return undefined
    return localQuotaText(blocked.code)
  }

  /** 扣次数、退次数的回复里带着现在每天的免费额度：设置页和用量页跟着变。 */
  private updateDaily(data: Json): void {
    const dailyFree = parseDaily(data.dailyFree)
    if (dailyFree === null || this.info === undefined) return
    this.info = { ...this.info, dailyFree }
    this.emit()
  }

  /** 事件流连接被拒。 */
  private async refused(error: AibotError): Promise<'stop' | 'retry'> {
    if (error.code === DEVICE_DISABLED) {
      this.markDisabled()
      return 'stop'
    }
    if (error.code === INVALID_KEY || error.status === 401) {
      if (this.deps.now() - this.reprovisionedAt <= REPROVISION_GAP_MS) return 'stop'
      this.reprovisionedAt = this.deps.now()
      return (await this.provision()) ? 'retry' : 'stop'
    }
    return 'retry'
  }

  // ---------- 设置页 ----------

  status(): AibotStatus {
    const info = this.info
    const key = this.device?.apiKey ?? ''
    return {
      enabled: this.enabled,
      state: this.enabled ? this.state : 'off',
      // 固定的提示存的是中文原文，读的时候按现在的语言翻；带参数的在写进来时已经翻好了。
      message: t(this.message),
      keyTail: key.length > 8 ? key.slice(-4) : '',
      accountKind: info?.accountKind ?? null,
      accountDisplay: info?.accountDisplay ?? null,
      dailyFree: info?.dailyFree ?? null,
      monitor: info?.monitor ?? null,
      bindAvailable: (info?.bindAvailable ?? false) || process.env.POD_AIBOT_BIND === '1',
      tools: this.tools.length,
      stream: this.enabled ? (this.stream.active ? (this.streamState === 'idle' ? 'retrying' : this.streamState) : 'idle') : 'off',
      retryAt: this.retryAt,
      roomId: this.roomId(),
      checkedAt: this.checkedAt,
    }
  }

  /** 设置页打开时读一次最新的额度（30 秒内读过就不再读）。 */
  async latest(): Promise<AibotStatus> {
    if (this.state === 'ready' && (this.checkedAt === null || this.deps.now() - this.checkedAt > 30_000)) await this.refresh()
    return this.status()
  }

  /** 你点“重试”：停用了就查一次设备状态，恢复了就接着用；别的情况马上重来一遍。 */
  async retry(): Promise<AibotStatus> {
    if (!this.enabled) return this.status()
    const device = this.device
    if (device !== undefined && device.disabledAt !== null && device.apiKey !== '') {
      try {
        const data = await this.client.device(device.apiKey)
        setAibotDisabled(this.deps.db, null, this.deps.now())
        this.device = readAibotDevice(this.deps.db)
        this.info = parseInfo(data)
        this.checkedAt = this.deps.now()
      } catch (error) {
        this.setState('disabled', error instanceof AibotError && error.code === DEVICE_DISABLED ? DISABLED_TEXT : t('{text}（检查失败：{reason}）', { text: t(DISABLED_TEXT), reason: reasonOf(error) }))
        return this.status()
      }
    }
    this.networkFailures = 0
    await this.boot()
    return this.status()
  }

  /** 绑定账号：申请一个码，在 aibot 网页上核对。 */
  async bindStart(): Promise<AibotBind> {
    const data = await this.authed((key) => this.client.bindStart(key))
    return {
      id: text(data.id),
      code: text(data.code),
      url: `${AIBOT_SITE}${text(data.verificationPath) || '/pod/bind'}`,
      expiresAt: toTime(data.expiresAt),
      pollIntervalSeconds: Math.max(2, count(data.pollIntervalSeconds) || 3),
    }
  }

  /** 查绑定结果；通过了就重连事件流、重新拉工具和设备状态。 */
  async bindPoll(id: string): Promise<AibotBindResult> {
    const data = await this.authed((key) => this.client.bindPoll(key, id))
    const status = text(data.status)
    const account = isJson(data.account) ? data.account : {}
    const result: AibotBindResult = { status: status === 'approved' || status === 'denied' || status === 'expired' ? status : 'pending', accountDisplay: text(account.display) || null }
    if (result.status === 'approved') {
      this.mcp.reset()
      if (this.stream.active) this.stream.restart()
      await this.refresh()
      await this.loadTools()
    }
    return result
  }
}
