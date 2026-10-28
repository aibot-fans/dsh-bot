import type { DatabaseSync } from 'node:sqlite'
import { TAB_IDLE_MS, newId, sameUrl, t, type PodSettings, type TabInfo, type TabOwner } from 'pod-domain'
import { readState, writeState } from 'pod-store'
import type { PodBus } from '../core/bus.ts'
import type { CdpEvent } from './cdp.ts'
import { findChrome, startChrome, type LaunchedChrome, type RememberedAgent } from './chrome.ts'
import { SiteThrottle, enableGuard, handlePaused } from './guard.ts'
import { BrowserTab, type ScreencastFrame } from './tab.ts'

export interface SharedBrowserDeps {
  readonly db: DatabaseSync
  readonly profileDir: string
  /** 下载先落在这里，完成后按标签页的归属移到任务文件夹。 */
  readonly downloadDir: string
  readonly settings: () => PodSettings
  readonly bus: PodBus
  readonly now: () => number
  readonly warn: (message: string, error?: unknown) => void
  readonly onDownload: (tab: BrowserTab, tempPath: string, filename: string) => Promise<void>
  /** 浏览器崩溃时（重启前）调用：正在执行的写操作标为“状态未知”。 */
  readonly onCrash: () => void
}

/** 记下来的标签页：dsh web 重启或浏览器崩溃后，按原网址恢复。 */
interface TabRecord {
  readonly id: string
  readonly url: string
  readonly owner: TabOwner
}

export interface FrameSubscriber {
  readonly frame: (frame: ScreencastFrame) => void
  readonly closed: () => void
}

const RECORDS_KEY = 'browser.tabs'
/** 上次启动用的 UA，下次同一个浏览器同一个版本直接用。 */
const AGENT_KEY = 'browser.agent'
const MAX_RESTARTS = 3
const RESTART_WINDOW_MS = 10 * 60_000

/**
 * 共用浏览器：所有 bot 共用一个无头 Chrome 和一份登录状态，按标签页分工。
 * 第一次用到时才启动；崩溃后自动重启并按原网址恢复标签页；没人看的标签页不推画面。
 */
export class SharedBrowser {
  private chrome: LaunchedChrome | undefined
  private starting: Promise<LaunchedChrome> | undefined
  private tabs: ReadonlyMap<string, BrowserTab> = new Map()
  private subscribers: ReadonlyMap<string, ReadonlySet<FrameSubscriber>> = new Map()
  private downloads: ReadonlyMap<string, { readonly tabId: string; readonly filename: string }> = new Map()
  private slotWaiters: (() => void)[] = []
  private crashes: readonly number[] = []
  private disposed = false
  private lastError = ''
  private readonly emitTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly throttle = new SiteThrottle()
  private readonly deps: SharedBrowserDeps
  /** 关掉空闲标签页前先存一份快照（由动作层设置）。 */
  beforeClose: (tab: BrowserTab) => Promise<void> = async () => {}

  constructor(deps: SharedBrowserDeps) {
    this.deps = deps
  }

  get executable(): string | undefined {
    return findChrome(this.deps.settings().chromePath)
  }

  status(): { readonly available: boolean; readonly running: boolean; readonly version: string; readonly tabs: number; readonly error: string } {
    return { available: this.executable !== undefined, running: this.chrome !== undefined, version: this.chrome?.version ?? '', tabs: this.tabs.size, error: this.lastError }
  }

  list(): readonly TabInfo[] {
    return [...this.tabs.values()].map((tab) => tab.info())
  }

  get(id: string): BrowserTab | undefined {
    return this.tabs.get(id)
  }

  tabsOf(sessionId: string): readonly BrowserTab[] {
    return [...this.tabs.values()].filter((tab) => tab.owner.kind === 'bot' && tab.owner.sessionId === sessionId)
  }

  findByUrl(url: string): BrowserTab | undefined {
    return [...this.tabs.values()].find((tab) => sameUrl(tab.url, url))
  }

  /** 取标签页；不在了但记录还在（重启过），就按原网址重新打开。 */
  async resolve(id: string): Promise<BrowserTab | undefined> {
    const live = this.tabs.get(id)
    if (live !== undefined) return live
    const record = this.records().find((item) => item.id === id)
    if (record === undefined) return undefined
    return this.open({ id: record.id, url: record.url, owner: record.owner })
  }

  /**
   * 共用浏览器里某个网站的一个 cookie 的值，没有就是 undefined；浏览器没启动时先启动。
   * 只用来判断登录了没有、登录的是谁，值不要记日志也不要存。
   */
  async cookie(domain: string, name: string): Promise<string | undefined> {
    const chrome = await this.ensure()
    const { cookies } = await chrome.connection.send<{ readonly cookies: readonly { readonly name: string; readonly value: string; readonly domain: string }[] }>('Storage.getCookies', {})
    const host = domain.replace(/^\./, '')
    return cookies.find((cookie) => cookie.name === name && cookie.domain.replace(/^\./, '') === host)?.value
  }

  private async ensure(): Promise<LaunchedChrome> {
    if (this.chrome !== undefined) return this.chrome
    if (this.disposed) throw new Error(t('共用浏览器已关闭'))
    if (this.starting !== undefined) return this.starting
    const executable = this.executable
    if (executable === undefined) throw new Error(t('没找到本机的 Chrome：请安装 Chrome，或在设置里填 Chrome 的路径'))
    this.starting = this.launch(executable).finally(() => {
      this.starting = undefined
    })
    return this.starting
  }

  private async launch(executable: string): Promise<LaunchedChrome> {
    try {
      const chrome = await startChrome(executable, this.deps.profileDir, readState<RememberedAgent | undefined>(this.deps.db, AGENT_KEY, undefined))
      writeState(this.deps.db, AGENT_KEY, { executable, version: chrome.version, userAgent: chrome.userAgent } satisfies RememberedAgent)
      this.lastError = ''
      chrome.connection.on((event) => this.route(event))
      chrome.child.once('exit', () => this.onExit(chrome))
      await chrome.connection.send('Target.setDiscoverTargets', { discover: true })
      await chrome.connection.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: this.deps.downloadDir, eventsEnabled: true })
      this.chrome = chrome
      return chrome
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  private onExit(chrome: LaunchedChrome): void {
    if (this.chrome !== chrome) return
    this.chrome = undefined
    const lost = [...this.tabs.values()]
    this.tabs = new Map()
    for (const tab of lost) this.closedSubscribers(tab.id)
    this.emit(null)
    if (this.disposed) return
    this.deps.onCrash()
    const now = this.deps.now()
    this.crashes = [...this.crashes.filter((time) => now - time < RESTART_WINDOW_MS), now]
    if (this.crashes.length > MAX_RESTARTS) {
      this.lastError = t('浏览器 10 分钟内崩溃了好几次，先不自动重启；下次用到时再启动')
      this.deps.warn(this.lastError)
      return
    }
    this.deps.warn('共用浏览器意外退出，正在重启并恢复标签页')
    void this.restore(lost.filter((tab) => tab.owner.kind !== 'pod' && tab.browserContextId === undefined))
  }

  private async restore(tabs: readonly BrowserTab[]): Promise<void> {
    for (const tab of tabs) {
      try {
        const restored = await this.open({ id: tab.id, url: tab.url, owner: tab.owner })
        restored.controller = tab.controller
        restored.waitId = tab.waitId
        restored.note('浏览器崩溃后重启过，这个标签页按原网址恢复了；页面里没提交的内容可能丢了')
      } catch (error) {
        this.deps.warn(`恢复标签页 ${tab.url} 失败`, error)
      }
    }
  }

  private route(event: CdpEvent): void {
    if (event.sessionId !== undefined) {
      const tab = [...this.tabs.values()].find((item) => item.sessionId === event.sessionId)
      if (tab === undefined) return
      if (event.method === 'Fetch.requestPaused') {
        void handlePaused(tab, event, this.deps.settings().allowedHosts).then((blocked) => {
          if (blocked !== undefined) tab.note(`拦下了一个指向本机或局域网的请求：${blocked.slice(0, 80)}`)
        })
        return
      }
      if (tab.handle(event)) {
        if (event.method === 'Page.frameNavigated') this.saveRecords()
        this.emit(tab.id)
      }
      // 无头模式下标题变化不一定有 targetInfoChanged，加载完自己读一次。
      if (event.method === 'Page.loadEventFired' || event.method === 'Page.domContentEventFired') {
        void tab
          .evaluate<string>('document.title')
          .then((title) => {
            if (typeof title === 'string' && title !== '' && title !== tab.title) {
              tab.title = title
              this.emit(tab.id)
            }
          })
          .catch(() => undefined)
      }
      return
    }
    const params = event.params as Record<string, unknown>
    switch (event.method) {
      case 'Target.targetCreated':
        void this.adoptPopup(params.targetInfo as { readonly targetId: string; readonly type: string; readonly openerId?: string; readonly browserContextId?: string } | undefined)
        return
      case 'Target.targetInfoChanged': {
        const info = params.targetInfo as { readonly targetId: string; readonly url?: string; readonly title?: string } | undefined
        const tab = [...this.tabs.values()].find((item) => item.targetId === info?.targetId)
        if (tab === undefined || info === undefined) return
        tab.url = info.url ?? tab.url
        // 页面还没有标题时 Chrome 用网址顶着，这种不算标题。
        if (info.title !== undefined && info.title !== '' && !(info.url ?? '').includes(info.title)) tab.title = info.title
        this.emit(tab.id)
        return
      }
      case 'Target.targetDestroyed': {
        const tab = [...this.tabs.values()].find((item) => item.targetId === params.targetId)
        if (tab !== undefined) this.forget(tab)
        return
      }
      case 'Browser.downloadWillBegin': {
        const tab = [...this.tabs.values()].find((item) => item.targetId === params.frameId) ?? this.mostRecent()
        if (tab === undefined) return
        this.downloads = new Map([...this.downloads, [String(params.guid), { tabId: tab.id, filename: String(params.suggestedFilename ?? 'download') }]])
        tab.downloadAt = this.deps.now()
        tab.note(`开始下载：${String(params.suggestedFilename ?? '')}`)
        return
      }
      case 'Browser.downloadProgress':
        if (params.state === 'completed' || params.state === 'canceled') void this.finishDownload(String(params.guid), params.state === 'completed')
        return
      default:
    }
  }

  private mostRecent(): BrowserTab | undefined {
    return [...this.tabs.values()].sort((left, right) => right.lastUsedAt - left.lastUsedAt)[0]
  }

  private async finishDownload(guid: string, completed: boolean): Promise<void> {
    const entry = this.downloads.get(guid)
    if (entry === undefined) return
    this.downloads = new Map([...this.downloads].filter(([key]) => key !== guid))
    const tab = this.tabs.get(entry.tabId)
    if (tab === undefined || !completed) return
    await this.deps.onDownload(tab, `${this.deps.downloadDir}/${guid}`, entry.filename).catch((error: unknown) => this.deps.warn('处理下载文件失败', error))
  }

  /** 页面弹出的新窗口（比如第三方登录）变成新标签页，归属跟着打开它的标签页。 */
  private async adoptPopup(info: { readonly targetId: string; readonly type: string; readonly openerId?: string; readonly browserContextId?: string } | undefined): Promise<void> {
    if (info === undefined || info.type !== 'page' || info.openerId === undefined) return
    const opener = [...this.tabs.values()].find((tab) => tab.targetId === info.openerId)
    if (opener === undefined || [...this.tabs.values()].some((tab) => tab.targetId === info.targetId)) return
    const tab = await this.attach(info.targetId, opener.owner, opener.browserContextId, newId('tab'))
    tab.controller = opener.controller
    opener.note(`页面打开了新标签页 ${tab.id}（用 browser_tabs 切换过去）`)
    this.emit(tab.id)
  }

  private async attach(targetId: string, owner: TabOwner, browserContextId: string | undefined, id: string): Promise<BrowserTab> {
    const chrome = await this.ensure()
    const { sessionId } = await chrome.connection.send<{ readonly sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
    const tab = new BrowserTab({ id, targetId, sessionId, browserContextId, owner, cdp: chrome.connection, now: this.deps.now })
    this.tabs = new Map([...this.tabs, [id, tab]])
    await tab.init()
    await enableGuard(tab)
    return tab
  }

  /** 等一个空位：标签页数到上限时排队，不拒绝。 */
  private async slot(signal?: AbortSignal): Promise<void> {
    while (this.tabs.size >= this.deps.settings().browserTabs) {
      await this.sweep(true)
      if (this.tabs.size < this.deps.settings().browserTabs) return
      if (signal?.aborted === true) throw new Error('已取消')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, 5000)
        function done(): void {
          clearTimeout(timer)
          resolve()
        }
        this.slotWaiters = [...this.slotWaiters, done]
      })
    }
  }

  async open(spec: { readonly url: string; readonly owner: TabOwner; readonly incognito?: boolean; readonly signal?: AbortSignal; readonly id?: string }): Promise<BrowserTab> {
    const chrome = await this.ensure()
    await this.slot(spec.signal)
    let browserContextId: string | undefined
    if (spec.incognito === true) {
      const created = await chrome.connection.send<{ readonly browserContextId: string }>('Target.createBrowserContext', { disposeOnDetach: true })
      browserContextId = created.browserContextId
      await chrome.connection.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: this.deps.downloadDir, eventsEnabled: true, browserContextId })
    }
    // 每个标签页单独开一个后台窗口：后台标签页在无头 Chrome 里没有窗口外框，位置还在屏幕外面，网页一量就知道。
    const { targetId } = await chrome.connection.send<{ readonly targetId: string }>('Target.createTarget', { url: 'about:blank', newWindow: true, background: true, ...(browserContextId === undefined ? {} : { browserContextId }) })
    const tab = await this.attach(targetId, spec.owner, browserContextId, spec.id ?? newId('tab'))
    this.emit(tab.id)
    if (spec.url !== '' && spec.url !== 'about:blank') await this.navigate(tab, spec.url, spec.signal)
    this.saveRecords()
    return tab
  }

  async navigate(tab: BrowserTab, url: string, signal?: AbortSignal): Promise<void> {
    const release = await this.throttle.acquire(url, signal)
    try {
      tab.touch()
      await tab.navigate(url)
    } finally {
      release()
      this.saveRecords()
      this.emit(tab.id)
    }
  }

  async close(id: string): Promise<void> {
    const tab = this.tabs.get(id)
    if (tab === undefined) return
    this.forget(tab)
    await this.chrome?.connection.send('Target.closeTarget', { targetId: tab.targetId }).catch(() => undefined)
    if (tab.browserContextId !== undefined) await this.chrome?.connection.send('Target.disposeBrowserContext', { browserContextId: tab.browserContextId }).catch(() => undefined)
  }

  private forget(tab: BrowserTab): void {
    if (!this.tabs.has(tab.id)) return
    this.tabs = new Map([...this.tabs].filter(([id]) => id !== tab.id))
    this.closedSubscribers(tab.id)
    this.saveRecords()
    this.emit(tab.id)
    const waiters = this.slotWaiters
    this.slotWaiters = []
    for (const wake of waiters) wake()
  }

  /** 关掉空闲的 bot 标签页：10 分钟没人用的先存快照再关；排队等空位时，空闲 2 分钟以上的也先让出来。 */
  async sweep(needSlot = false): Promise<void> {
    const now = this.deps.now()
    const idle = [...this.tabs.values()]
      .filter((tab) => tab.owner.kind !== 'owner' && tab.controller === 'bot' && tab.dialog === null && tab.waitId === null && !this.subscribers.has(tab.id))
      .filter((tab) => now - tab.lastUsedAt > (needSlot ? 2 * 60_000 : TAB_IDLE_MS))
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)
    for (const tab of needSlot ? idle.slice(0, 1) : idle) {
      // Pod 自己的标签页（X 账号、导出页面）不存快照：里面是你的时间线之类，不该进浏览记录。
      if (tab.owner.kind !== 'pod') await this.beforeClose(tab).catch(() => undefined)
      await this.close(tab.id)
    }
  }

  // ---------- 实时画面 ----------

  subscribe(id: string, subscriber: FrameSubscriber): () => void {
    const tab = this.tabs.get(id)
    if (tab === undefined) {
      subscriber.closed()
      return () => {}
    }
    const current = this.subscribers.get(id) ?? new Set<FrameSubscriber>()
    this.subscribers = new Map([...this.subscribers, [id, new Set([...current, subscriber])]])
    if (current.size === 0) {
      void tab
        .startScreencast((frame) => {
          for (const listener of this.subscribers.get(id) ?? []) listener.frame(frame)
        })
        .catch((error: unknown) => this.deps.warn('开始推送画面失败', error))
    }
    return () => {
      const remaining = new Set([...(this.subscribers.get(id) ?? [])].filter((item) => item !== subscriber))
      this.subscribers = remaining.size === 0 ? new Map([...this.subscribers].filter(([key]) => key !== id)) : new Map([...this.subscribers, [id, remaining]])
      if (remaining.size === 0) void this.tabs.get(id)?.stopScreencast()
    }
  }

  private closedSubscribers(id: string): void {
    for (const subscriber of this.subscribers.get(id) ?? []) subscriber.closed()
    this.subscribers = new Map([...this.subscribers].filter(([key]) => key !== id))
  }

  // ---------- 记录和事件 ----------

  private records(): readonly TabRecord[] {
    return readState<readonly TabRecord[]>(this.deps.db, RECORDS_KEY, [])
  }

  private saveRecords(): void {
    const live = [...this.tabs.values()]
      .filter((tab) => tab.owner.kind !== 'pod' && tab.browserContextId === undefined && tab.url.startsWith('http'))
      .map((tab) => ({ id: tab.id, url: tab.url, owner: tab.owner }))
    writeState(this.deps.db, RECORDS_KEY, live)
  }

  /** bot 正要点击的位置：浏览器视图里在画面上标出来。 */
  point(tab: BrowserTab, x: number, y: number, label: string): void {
    this.deps.bus.emit({ type: 'browser', tabId: tab.id, pointer: { x: Math.round(x), y: Math.round(y), label } })
  }

  /** 同一个标签页的变化 300 毫秒内只通知一次，页面标题频繁变化时不刷屏。 */
  emit(tabId: string | null): void {
    const key = tabId ?? ''
    if (this.emitTimers.has(key)) return
    this.emitTimers.set(
      key,
      setTimeout(() => {
        this.emitTimers.delete(key)
        this.deps.bus.emit({ type: 'browser', tabId })
      }, 300),
    )
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const timer of this.emitTimers.values()) clearTimeout(timer)
    const chrome = this.chrome
    this.chrome = undefined
    if (chrome === undefined) return
    await chrome.connection.send('Browser.close', {}, undefined, 3000).catch(() => undefined)
    chrome.connection.close()
    chrome.child.kill()
  }
}
