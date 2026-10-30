import type { DatabaseSync } from 'node:sqlite'
import { XError, connect, pageProblem, startedUp, viewer, type XClient, type XHost } from 'aibot-x-post'
import { UNCHECKED_X_ACCOUNT, X_SITE, type XAccountStatus } from 'pod-domain'
import { readState, writeState } from 'pod-store'
import type { SharedBrowser } from '../browser/browser.ts'
import type { BrowserTab } from '../browser/tab.ts'
import { xErrorText } from './errors.ts'

export interface XAccountDeps {
  readonly db: DatabaseSync
  readonly browser: SharedBrowser
  readonly now: () => number
}

interface Page {
  readonly tab: BrowserTab
  readonly client: XClient
}

const STATUS_KEY = 'x.account'
const HOME = 'https://x.com/home'
/** 打开 x.com 以后等页面准备好最多等多久。 */
const STARTUP_TIMEOUT_MS = 30_000
/** 复用开着的标签页时，确认页面还能用。 */
const ALIVE_TIMEOUT_MS = 5_000
/** 单次求值最多等多久：读加密聊天要等一阵。 */
const EVALUATE_TIMEOUT_MS = 120_000

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return ''
  }
}

/** twid cookie 里是 URL 编码过的 u=数字 id。 */
function userIdOf(twid: string | undefined): string {
  if (twid === undefined) return ''
  try {
    return /u=(\d+)/.exec(decodeURIComponent(twid))?.[1] ?? ''
  } catch {
    return ''
  }
}

/** aibot-x-post 要宿主提供的三样，都作用在这个标签页的网页主环境上。 */
function hostOf(tab: BrowserTab, browser: SharedBrowser): XHost {
  return {
    addInitScript: (source) => tab.addInitScript(source),
    evaluate: (expression) => tab.evaluateMain(expression, EVALUATE_TIMEOUT_MS),
    goto: (url) => browser.navigate(tab, url),
  }
}

/**
 * dsh-bot 浏览器里登录的 X 账号。读写 X 交给 aibot-x-post，用一个不在浏览器面板里列出、停在 x.com 的标签页。
 * 先看 cookie 判断登录了没有，没登录就不开网页；标签页 10 分钟没用会被共用浏览器收掉，下次用时再开。
 * 一次只做一件事。
 */
export class XAccount {
  private page: Page | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private readonly deps: XAccountDeps

  constructor(deps: XAccountDeps) {
    this.deps = deps
  }

  status(): XAccountStatus {
    return readState<XAccountStatus>(this.deps.db, STATUS_KEY, UNCHECKED_X_ACCOUNT)
  }

  private save(status: Omit<XAccountStatus, 'checkedAt'>): void {
    writeState(this.deps.db, STATUS_KEY, { ...status, checkedAt: this.deps.now() })
  }

  /** 用登录的账号做一件事：排队，前一件做完才开始。 */
  use<T>(work: (client: XClient) => Promise<T>): Promise<T> {
    return this.enqueue(() => this.withPage(work, false))
  }

  /** 只看 cookie 判断登录了没有，不开网页。 */
  async signedIn(): Promise<boolean> {
    return (await this.deps.browser.cookie(X_SITE, 'auth_token')) !== undefined
  }

  /** 重新看一遍登录的是谁（设置页的“检查”和 x_account）。没登录、被锁已经由 remember 记下了，别的错记成 error。 */
  async check(): Promise<XAccountStatus> {
    try {
      await this.enqueue(() => this.withPage(async () => undefined, true))
    } catch (error) {
      const code = error instanceof XError ? error.code : undefined
      if (code !== 'not-logged-in' && code !== 'locked' && code !== 'suspended') this.save({ ...this.status(), state: 'error', message: xErrorText(error) })
    }
    return this.status()
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async withPage<T>(work: (client: XClient) => Promise<T>, refresh: boolean): Promise<T> {
    let page: Page
    try {
      page = await this.prepare(refresh)
    } catch (error) {
      await this.remember(error)
      // 还没开始做事就失败了（浏览器起不来、网页打不开）：都算没做成，调用方可以放心重试。
      throw error instanceof XError ? error : new XError('not-ready', xErrorText(error))
    }
    try {
      const result = await work(page.client)
      page.tab.touch()
      return result
    } catch (error) {
      await this.remember(error)
      throw error
    }
  }

  /** 做事之前：确认登录着，拿到就绪的标签页；第一次用、换了账号或者要求重新看时，读一次登录的是谁。 */
  private async prepare(refresh: boolean): Promise<Page> {
    if (!(await this.signedIn())) {
      await this.closePage()
      throw new XError('not-logged-in', '')
    }
    const uid = userIdOf(await this.deps.browser.cookie(X_SITE, 'twid'))
    const page = await this.ready()
    page.tab.touch()
    const known = this.status()
    if (refresh || known.state !== 'ready' || (uid !== '' && uid !== known.id)) {
      const user = await viewer(page.client, uid)
      this.save({ state: 'ready', id: user.id, handle: user.handle, name: user.name, message: '' })
    }
    return page
  }

  /** 登录失效、被锁记到账号状态上，设置页看得到；网页也关掉，下次重开。 */
  private async remember(error: unknown): Promise<void> {
    if (!(error instanceof XError)) return
    if (error.code === 'not-logged-in') this.save({ ...UNCHECKED_X_ACCOUNT, state: 'signed-out' })
    else if (error.code === 'locked' || error.code === 'suspended') this.save({ ...this.status(), state: 'locked', message: xErrorText(error) })
    else return
    await this.closePage()
  }

  /** 停在 x.com 上、已经准备好的标签页；没有或者不对了就重开一个。 */
  private async ready(): Promise<Page> {
    const current = this.page
    if (current !== undefined && this.deps.browser.get(current.tab.id) === current.tab) {
      const problem = pageProblem(pathOf(current.tab.url))
      if (problem.code !== 'not-ready') {
        await this.closePage()
        throw problem
      }
      if (await startedUp(current.client, ALIVE_TIMEOUT_MS).catch(() => false)) return current
      await this.closePage()
    }
    const page = await this.open()
    this.page = page
    return page
  }

  private async open(): Promise<Page> {
    const browser = this.deps.browser
    const tab = await browser.open({ url: '', owner: { kind: 'pod', hidden: true } })
    try {
      const client = await connect(hostOf(tab, browser))
      await browser.navigate(tab, HOME)
      if (!(await startedUp(client, STARTUP_TIMEOUT_MS))) throw pageProblem(pathOf(tab.url))
      return { tab, client }
    } catch (error) {
      // 打开时网页跳去了登录页或解锁页，按停在哪儿说原因。
      const problem = pageProblem(pathOf(tab.url))
      await browser.close(tab.id)
      throw problem.code === 'not-ready' ? error : problem
    }
  }

  private async closePage(): Promise<void> {
    const page = this.page
    this.page = undefined
    if (page !== undefined) await this.deps.browser.close(page.tab.id)
  }
}
