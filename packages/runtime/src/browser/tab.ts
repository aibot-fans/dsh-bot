import { t, type TabAction, type TabController, type TabDialog, type TabInfo, type TabOwner } from 'pod-domain'
import { CdpTimeout, type CdpConnection, type CdpEvent } from './cdp.ts'
import { NavigationError, describeNetError } from './navigation.ts'
import { invoke } from './scripts.ts'

export interface ScreencastFrame {
  readonly data: string
  readonly width: number
  readonly height: number
  /** 页面视口的 CSS 像素尺寸，画面上的点击按它换算。 */
  readonly viewportWidth: number
  readonly viewportHeight: number
}

/** 常用按键的 CDP 定义。 */
const KEYS: Readonly<Record<string, { readonly code: string; readonly keyCode: number; readonly text?: string }>> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  Space: { code: 'Space', keyCode: 32, text: ' ' },
}

export const KEY_NAMES: readonly string[] = Object.keys(KEYS)

const NAVIGATION_TIMEOUT_MS = 30_000
const RECENT_ACTIONS = 20
/** 导航报 ERR_ABORTED 后再等这么久，看是不是开始下载了、或者别的跳转接手了。 */
const ABORT_SETTLE_MS = 400

/** 标签页对网站自称的身份：换掉无头 Chrome 的 UA 和 Client Hints（见 chrome.ts 的 browserIdentity）。 */
export interface TabIdentity {
  readonly userAgent: string
  readonly acceptLanguage: string
  readonly platform: string
  readonly userAgentMetadata: Readonly<Record<string, unknown>>
}

/** 一个标签页：一个 CDP page 目标加上 Pod 的归属、控制权和原生控件状态。 */
export class BrowserTab {
  readonly id: string
  readonly targetId: string
  readonly sessionId: string
  readonly browserContextId: string | undefined
  readonly createdAt: number
  owner: TabOwner
  controller: TabController = 'bot'
  url = 'about:blank'
  title = ''
  loading = false
  dialog: TabDialog | null = null
  fileChooser: { readonly backendNodeId: number; readonly multiple: boolean } | null = null
  waitId: string | null = null
  lastUsedAt: number
  /** 最近一次开始下载的时间：导航变成下载时 Chrome 也报 ERR_ABORTED，靠它区分。 */
  downloadAt = 0
  /** 自上次工具调用以来发生的事：弹窗、新标签页、下载、被拦下的请求。下一次工具结果里告诉 bot。 */
  notices: readonly string[] = []
  actions: readonly TabAction[] = []
  private readonly cdp: CdpConnection
  private loadWaiters: (() => void)[] = []
  /** Pod 发起的导航（地址栏、bot、前进后退刷新）的序号：旧的一次被新的顶掉时不算出错。 */
  private navigations = 0
  /** 主框架最近一次换了网页的时间。 */
  private committedAt = 0
  private frameListener: ((frame: ScreencastFrame) => void) | undefined
  private readonly now: () => number

  constructor(spec: { readonly id: string; readonly targetId: string; readonly sessionId: string; readonly browserContextId: string | undefined; readonly owner: TabOwner; readonly cdp: CdpConnection; readonly now: () => number }) {
    this.id = spec.id
    this.targetId = spec.targetId
    this.sessionId = spec.sessionId
    this.browserContextId = spec.browserContextId
    this.owner = spec.owner
    this.cdp = spec.cdp
    this.now = spec.now
    this.createdAt = spec.now()
    this.lastUsedAt = spec.now()
  }

  info(): TabInfo {
    return {
      id: this.id,
      url: this.url,
      title: this.title,
      owner: this.owner,
      controller: this.controller,
      loading: this.loading,
      incognito: this.browserContextId !== undefined,
      dialog: this.dialog,
      fileChooser: this.fileChooser !== null,
      waitId: this.waitId,
      actions: this.actions,
      createdAt: this.createdAt,
      lastUsedAt: this.lastUsedAt,
    }
  }

  send<T = Record<string, unknown>>(method: string, params: Readonly<Record<string, unknown>> = {}, timeoutMs?: number): Promise<T> {
    return this.cdp.send<T>(method, params, this.sessionId, timeoutMs)
  }

  /**
   * 不开 Runtime 域：Pod 只用 Runtime.evaluate，用不着它的事件，开了反而能被网页的检测脚本察觉。
   * 给了 identity 就换掉无头 Chrome 的 UA 和 Client Hints。
   */
  async init(identity?: TabIdentity): Promise<void> {
    await Promise.all([
      this.send('Page.enable'),
      ...(identity === undefined ? [] : [this.send('Emulation.setUserAgentOverride', { ...identity })]),
      this.send('Page.setLifecycleEventsEnabled', { enabled: true }),
      this.send('Page.setInterceptFileChooserDialog', { enabled: true }),
      // 标签页都在后台创建：不模拟焦点的话，无头 Chrome 不处理鼠标事件，接管和 bot 的点击都会卡住。
      this.send('Emulation.setFocusEmulationEnabled', { enabled: true }),
    ])
  }

  touch(): void {
    this.lastUsedAt = this.now()
  }

  record(text: string): void {
    this.actions = [...this.actions, { at: this.now(), text }].slice(-RECENT_ACTIONS)
  }

  note(text: string): void {
    this.notices = [...this.notices, text].slice(-10)
  }

  takeNotices(): readonly string[] {
    const notices = this.notices
    this.notices = []
    return notices
  }

  /** 这个标签页的 CDP 事件。返回 true 表示状态有变化，需要通知页面。 */
  handle(event: CdpEvent): boolean {
    const params = event.params as Record<string, unknown>
    switch (event.method) {
      case 'Page.frameNavigated': {
        const frame = params.frame as { readonly parentId?: string; readonly url?: string } | undefined
        if (frame === undefined || frame.parentId !== undefined) return false
        this.url = frame.url ?? this.url
        this.committedAt = this.now()
        return true
      }
      case 'Page.frameStartedLoading':
        if (params.frameId !== this.targetId) return false
        this.loading = true
        return true
      case 'Page.loadEventFired':
      case 'Page.frameStoppedLoading':
        if (event.method === 'Page.frameStoppedLoading' && params.frameId !== this.targetId) return false
        this.loading = false
        this.flushLoadWaiters()
        return true
      case 'Page.javascriptDialogOpening':
        this.dialog = {
          type: (params.type as TabDialog['type'] | undefined) ?? 'alert',
          message: String(params.message ?? '').slice(0, 1000),
          defaultPrompt: String(params.defaultPrompt ?? ''),
        }
        return true
      case 'Page.javascriptDialogClosed':
        this.dialog = null
        return true
      case 'Page.fileChooserOpened':
        this.fileChooser = { backendNodeId: Number(params.backendNodeId ?? 0), multiple: params.mode === 'selectMultiple' }
        this.note('页面弹出了选择文件的框：用 browser_upload 从工作区选文件')
        return true
      case 'Page.screencastFrame': {
        const metadata = (params.metadata ?? {}) as { readonly deviceWidth?: number; readonly deviceHeight?: number }
        void this.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => undefined)
        this.frameListener?.({
          data: String(params.data ?? ''),
          width: 0,
          height: 0,
          viewportWidth: metadata.deviceWidth ?? 1280,
          viewportHeight: metadata.deviceHeight ?? 800,
        })
        return false
      }
      default:
        return false
    }
  }

  private flushLoadWaiters(): void {
    const waiters = this.loadWaiters
    this.loadWaiters = []
    for (const resolve of waiters) resolve()
  }

  /** 等页面加载完；超时不算错（有的页面一直在加载），返回是否真的加载完了。 */
  waitForLoad(timeoutMs = NAVIGATION_TIMEOUT_MS): Promise<boolean> {
    if (!this.loading) return Promise.resolve(true)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.loadWaiters = this.loadWaiters.filter((waiter) => waiter !== done)
        resolve(false)
      }, timeoutMs)
      const done = (): void => {
        clearTimeout(timer)
        resolve(true)
      }
      this.loadWaiters = [...this.loadWaiters, done]
    })
  }

  /**
   * 打开网址，等加载完。打不开时抛 NavigationError（一句说人话的原因）；
   * 这几种 ERR_ABORTED 不算错：被更新的一次导航顶掉、变成了下载、或者网页自己又跳去了别处。
   */
  async navigate(url: string): Promise<void> {
    this.navigations += 1
    const generation = this.navigations
    const startedAt = this.now()
    this.loading = true
    const result = await this.send<{ readonly errorText?: string }>('Page.navigate', { url }, NAVIGATION_TIMEOUT_MS).catch((error: unknown) => {
      if (error instanceof CdpTimeout) throw new NavigationError(t('等了 30 秒网站还没响应：网络慢或者网站打不开，过一会儿刷新试试'))
      throw error
    })
    const code = result.errorText ?? ''
    if (code === '') {
      await this.waitForLoad()
      return
    }
    if (generation !== this.navigations) return
    if (code === 'net::ERR_ABORTED') {
      await new Promise((resolve) => setTimeout(resolve, ABORT_SETTLE_MS))
      if (generation !== this.navigations) return
      if (this.downloadAt >= startedAt) {
        this.loading = false
        return
      }
      if (this.committedAt >= startedAt) {
        await this.waitForLoad()
        return
      }
    }
    this.loading = false
    throw new NavigationError(t('{reason}（{code}）', { reason: describeNetError(code), code }))
  }

  /** 点了以后可能跳转：等一会儿看看有没有开始加载，开始了就等加载完。 */
  async settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 400))
    if (this.loading) await this.waitForLoad(15_000)
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send<{ readonly result?: { readonly value?: unknown }; readonly exceptionDetails?: { readonly text?: string; readonly exception?: { readonly description?: string } } }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true, userGesture: true },
    )
    if (result.exceptionDetails !== undefined) throw new Error(`页面脚本出错：${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? ''}`.slice(0, 300))
    return result.result?.value as T
  }

  call<T>(script: string, ...args: readonly unknown[]): Promise<T> {
    return this.evaluate<T>(invoke(script, ...args))
  }

  async objectId(expression: string): Promise<string | undefined> {
    const result = await this.send<{ readonly result?: { readonly objectId?: string } }>('Runtime.evaluate', { expression, returnByValue: false })
    return result.result?.objectId
  }

  async click(x: number, y: number, clickCount = 1): Promise<void> {
    await this.mouse({ type: 'mouseMoved', x, y })
    await this.mouse({ type: 'mousePressed', x, y, button: 'left', clickCount })
    await this.mouse({ type: 'mouseReleased', x, y, button: 'left', clickCount })
  }

  mouse(event: Readonly<Record<string, unknown>>): Promise<unknown> {
    return this.send('Input.dispatchMouseEvent', event)
  }

  async press(key: string, modifiers = 0): Promise<void> {
    const known = KEYS[key]
    const definition = known ?? { code: key.length === 1 ? `Key${key.toUpperCase()}` : key, keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 }
    const text = known?.text ?? (key.length === 1 && modifiers === 0 ? key : undefined)
    const base = { key: key === 'Space' ? ' ' : key, code: definition.code, windowsVirtualKeyCode: definition.keyCode, modifiers }
    await this.send('Input.dispatchKeyEvent', { type: text === undefined ? 'rawKeyDown' : 'keyDown', ...base, ...(text === undefined ? {} : { text }) })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  key(event: Readonly<Record<string, unknown>>): Promise<unknown> {
    return this.send('Input.dispatchKeyEvent', event)
  }

  insertText(text: string): Promise<unknown> {
    return this.send('Input.insertText', { text })
  }

  async screenshot(quality = 70): Promise<Buffer> {
    const result = await this.send<{ readonly data: string }>('Page.captureScreenshot', { format: 'jpeg', quality })
    return Buffer.from(result.data, 'base64')
  }

  async startScreencast(listener: (frame: ScreencastFrame) => void): Promise<void> {
    this.frameListener = listener
    await this.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 })
  }

  async stopScreencast(): Promise<void> {
    this.frameListener = undefined
    await this.send('Page.stopScreencast').catch(() => undefined)
  }

  async handleDialog(accept: boolean, promptText?: string): Promise<void> {
    await this.send('Page.handleJavaScriptDialog', { accept, ...(promptText === undefined ? {} : { promptText }) })
    this.dialog = null
  }

  async setFiles(files: readonly string[], objectId?: string): Promise<void> {
    const target = objectId !== undefined ? { objectId } : this.fileChooser !== null ? { backendNodeId: this.fileChooser.backendNodeId } : undefined
    if (target === undefined) throw new Error(t('页面没有要选择文件的地方'))
    await this.send('DOM.setFileInputFiles', { files, ...target })
    this.fileChooser = null
  }

  async history(action: 'back' | 'forward' | 'reload'): Promise<boolean> {
    this.navigations += 1
    if (action === 'reload') {
      this.loading = true
      await this.send('Page.reload')
      await this.waitForLoad()
      return true
    }
    const history = await this.send<{ readonly currentIndex: number; readonly entries: readonly { readonly id: number }[] }>('Page.getNavigationHistory')
    const entry = history.entries[history.currentIndex + (action === 'back' ? -1 : 1)]
    if (entry === undefined) return false
    this.loading = true
    await this.send('Page.navigateToHistoryEntry', { entryId: entry.id })
    await this.waitForLoad()
    return true
  }
}
