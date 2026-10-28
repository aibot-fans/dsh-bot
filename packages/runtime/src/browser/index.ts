import type { DatabaseSync } from 'node:sqlite'
import { mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, basename, join } from 'node:path'
import { t, type PodSession, type PodSettings } from 'pod-domain'
import type { Dispatcher } from '../agents/dispatcher.ts'
import type { SessionRegistry } from '../agents/registry.ts'
import type { Auditor } from '../core/audit.ts'
import type { PodBus } from '../core/bus.ts'
import type { LiteLlm } from '../core/lite.ts'
import type { SearchService } from '../search/service.ts'
import type { WaitService } from '../waits/service.ts'
import { BrowserActions } from './actions.ts'
import { WriteApprovals } from './approvals.ts'
import { SharedBrowser } from './browser.ts'
import { OwnerBrowser } from './owner.ts'
import type { BrowserTab } from './tab.ts'

export interface BrowserKitDeps {
  readonly db: DatabaseSync
  readonly dataRoot: string
  readonly workspaceRoot: string
  readonly bus: PodBus
  readonly settings: () => PodSettings
  readonly registry: SessionRegistry
  readonly dispatcher: Dispatcher
  readonly waits: WaitService
  readonly search: SearchService
  readonly audit: Auditor
  readonly lite: LiteLlm
  readonly now: () => number
  readonly warn: (message: string, error?: unknown) => void
  readonly rootOf: (taskId: string | null) => string | undefined
  /** 会话或任务的文件夹（绝对路径）。 */
  readonly folderOf: (session: PodSession) => string
  readonly folderOfTask: (taskId: string | null) => string | undefined
  readonly brief: (session: PodSession) => string
  readonly privateTexts: () => readonly string[]
  readonly exposed: () => string | undefined
  readonly onOpened?: (session: PodSession, tab: BrowserTab) => void
}

export interface BrowserKit {
  readonly browser: SharedBrowser
  readonly approvals: WriteApprovals
  readonly actions: BrowserActions
  readonly owner: OwnerBrowser
}

/** 下载的文件名去掉路径和奇怪字符；同名的加序号，不覆盖。 */
function freeName(folder: string, filename: string): string {
  const clean = basename(filename).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'download'
  const extension = extname(clean)
  const stem = clean.slice(0, clean.length - extension.length)
  let candidate = clean
  for (let index = 2; existsSync(join(folder, candidate)); index += 1) candidate = `${stem}-${index}${extension}`
  return join(folder, candidate)
}

/** 组装共用浏览器：浏览器进程、bot 的动作、写操作审批和你的操作。 */
export function createBrowserKit(deps: BrowserKitDeps): BrowserKit {
  const folderOfTab = (tab: BrowserTab): string => {
    if (tab.owner.kind === 'bot') {
      const session = deps.registry.get(tab.owner.sessionId)
      if (session !== undefined) return deps.folderOf(session)
      return deps.folderOfTask(tab.owner.taskId) ?? deps.workspaceRoot
    }
    return join(deps.workspaceRoot, '下载')
  }

  let approvals: WriteApprovals | undefined
  const browser = new SharedBrowser({
    db: deps.db,
    profileDir: join(deps.dataRoot, 'browser', 'profile'),
    downloadDir: join(deps.dataRoot, 'browser', 'downloads'),
    settings: deps.settings,
    bus: deps.bus,
    now: deps.now,
    warn: deps.warn,
    onCrash: () => approvals?.markUnknown(),
    onDownload: async (tab, tempPath, filename) => {
      const folder = tab.owner.kind === 'bot' ? join(folderOfTab(tab), 'downloads') : folderOfTab(tab)
      await mkdir(folder, { recursive: true })
      const target = freeName(folder, filename)
      await rename(tempPath, target)
      tab.note(`下载完成：${target}`)
      tab.record(t('下载了 {basename}', { basename: basename(target) }))
      browser.emit(tab.id)
    },
  })
  const actions: { current?: BrowserActions } = {}
  approvals = new WriteApprovals({
    db: deps.db,
    dataRoot: deps.dataRoot,
    browser,
    waits: deps.waits,
    registry: deps.registry,
    dispatcher: deps.dispatcher,
    audit: deps.audit,
    lite: deps.lite,
    now: deps.now,
    brief: deps.brief,
    exposed: deps.exposed,
    glance: (tab) => actions.current?.glance(tab) ?? Promise.resolve(''),
  })
  const kitActions = new BrowserActions({
    browser,
    approvals,
    registry: deps.registry,
    search: deps.search,
    settings: deps.settings,
    now: deps.now,
    rootOf: deps.rootOf,
    folderOf: deps.folderOf,
    privateTexts: deps.privateTexts,
    onOpened: deps.onOpened,
  })
  actions.current = kitActions
  const owner = new OwnerBrowser({
    browser,
    waits: deps.waits,
    registry: deps.registry,
    dispatcher: deps.dispatcher,
    audit: deps.audit,
    settings: deps.settings,
    workspaceRoot: deps.workspaceRoot,
    folderOfTab,
  })

  const written = approvals
  // pod.ts 会重设这个：X 写操作（data.channel 是 x）的审批交给 x/writes.ts。
  deps.waits.setResolver('write', (wait, answer) => written.resolveWrite(wait, answer))
  deps.waits.setResolver('security', (wait, answer) => written.resolveSecurity(wait, answer))
  deps.waits.setResolver('login', (wait) => {
    const tab = typeof wait.data.tabId === 'string' ? browser.get(wait.data.tabId) : undefined
    if (tab !== undefined) {
      tab.controller = 'bot'
      tab.waitId = null
      browser.emit(tab.id)
    }
    return false
  })
  return { browser, approvals: written, actions: kitActions, owner }
}
