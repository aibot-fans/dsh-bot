import { existsSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { PRIORITY, addressToUrl, fail, ok, readBool, readId, readString, type PodResult, type PodSession, type PodSettings, type TabInfo } from 'pod-domain'
import type { Dispatcher } from '../agents/dispatcher.ts'
import { noticeSource } from '../agents/messages.ts'
import type { SessionRegistry } from '../agents/registry.ts'
import type { Auditor } from '../core/audit.ts'
import type { WaitService } from '../waits/service.ts'
import type { SharedBrowser } from './browser.ts'
import { checkReachable } from './guard.ts'
import { HIT, SELECT, SELECTION } from './scripts.ts'
import type { BrowserTab } from './tab.ts'

export interface OwnerBrowserDeps {
  readonly browser: SharedBrowser
  readonly waits: WaitService
  readonly registry: SessionRegistry
  readonly dispatcher: Dispatcher
  readonly audit: Auditor
  readonly settings: () => PodSettings
  readonly workspaceRoot: string
  /** 标签页归属的任务文件夹：文件选择框从这里选。 */
  readonly folderOfTab: (tab: BrowserTab) => string
}

/** 你在画面上的操作：鼠标、滚轮、按键、组好字的文字。 */
type InputEvent =
  | { readonly type: 'mouse'; readonly action: 'move' | 'down' | 'up'; readonly x: number; readonly y: number; readonly button?: string; readonly clickCount?: number; readonly modifiers?: number }
  | { readonly type: 'wheel'; readonly x: number; readonly y: number; readonly deltaX: number; readonly deltaY: number }
  | { readonly type: 'key'; readonly action: 'down' | 'up'; readonly key: string; readonly code: string; readonly keyCode: number; readonly modifiers?: number; readonly text?: string }
  | { readonly type: 'text'; readonly text: string }

const MOUSE_TYPES = { move: 'mouseMoved', down: 'mousePressed', up: 'mouseReleased' } as const

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readEvents(input: unknown): readonly InputEvent[] {
  const raw = (input as { readonly events?: unknown }).events
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 200).filter((event): event is InputEvent => typeof event === 'object' && event !== null && typeof (event as { type?: unknown }).type === 'string')
}

/**
 * 你在浏览器视图里的操作：打开网页、地址栏、前进后退、接管和交还、把画面上的输入转给页面，
 * 以及原生控件的浮层（下拉框、对话框、选择文件）。你接管的标签页上 bot 的浏览器工具暂停。
 */
export class OwnerBrowser {
  private readonly deps: OwnerBrowserDeps

  constructor(deps: OwnerBrowserDeps) {
    this.deps = deps
  }

  private tab(input: unknown): BrowserTab | undefined {
    const id = readId(input, 'tabId')
    return id === undefined ? undefined : this.deps.browser.get(id)
  }

  private tell(tab: BrowserTab, text: string): void {
    if (tab.owner.kind !== 'bot' || this.deps.registry.get(tab.owner.sessionId) === undefined) return
    this.deps.dispatcher.enqueue({ sessionId: tab.owner.sessionId, mode: 'followup', priority: PRIORITY.owner, text, source: noticeSource('共用浏览器') })
  }

  /** 你开一个标签页：地址先补全（没写 https:// 的补上，搜索词用必应搜）再检查；roomId 是在哪个群里开的。 */
  async open(input: unknown): Promise<PodResult<TabInfo>> {
    const raw = addressToUrl(readString(input, 'url'))
    let url = ''
    if (raw !== '' && raw !== 'about:blank') {
      const checked = await checkReachable(raw, this.deps.settings().allowedHosts)
      if (!checked.ok) return fail('invalid-input', checked.reason)
      url = checked.url.toString()
    }
    const roomId = readId(input, 'roomId')
    const owner = roomId === undefined ? { kind: 'owner' as const } : { kind: 'owner' as const, roomId }
    const tab = await this.deps.browser.open({ url, owner, incognito: readBool(input, 'incognito') === true })
    tab.controller = 'owner'
    this.deps.browser.emit(tab.id)
    return ok(tab.info())
  }

  async navigate(input: unknown): Promise<PodResult<TabInfo>> {
    const tab = this.tab(input)
    if (tab === undefined) return fail('not-found', '标签页已经关了')
    if (tab.controller !== 'owner') return fail('conflict', '先接管这个标签页')
    const checked = await checkReachable(addressToUrl(readString(input, 'url')), this.deps.settings().allowedHosts)
    if (!checked.ok) return fail('invalid-input', checked.reason)
    await this.deps.browser.navigate(tab, checked.url.toString())
    tab.record(`你打开了 ${checked.url.hostname}`)
    return ok(tab.info())
  }

  async history(input: unknown): Promise<PodResult<TabInfo>> {
    const tab = this.tab(input)
    if (tab === undefined) return fail('not-found', '标签页已经关了')
    if (tab.controller !== 'owner') return fail('conflict', '先接管这个标签页')
    const action = readString(input, 'action')
    if (action !== 'back' && action !== 'forward' && action !== 'reload') return fail('invalid-input', '只能后退、前进或刷新')
    await tab.history(action)
    this.deps.browser.emit(tab.id)
    return ok(tab.info())
  }

  async close(input: unknown): Promise<PodResult<null>> {
    const tab = this.tab(input)
    if (tab === undefined) return ok(null)
    await this.deps.browser.close(tab.id)
    this.tell(tab, `[用户关掉了你的标签页 ${tab.id}（${tab.url}）] 需要的话重新打开。`)
    return ok(null)
  }

  takeover(input: unknown): PodResult<TabInfo> {
    const tab = this.tab(input)
    if (tab === undefined) return fail('not-found', '标签页已经关了')
    tab.controller = 'owner'
    tab.record('你接管了')
    this.deps.audit.record('browser.takeover', 'owner', tab.id, { url: tab.url })
    this.deps.browser.emit(tab.id)
    return ok(tab.info())
  }

  /** 交还：可以附一句话（例如“已登录”），bot 带着这句话继续。 */
  handback(input: unknown): PodResult<TabInfo> {
    const tab = this.tab(input)
    if (tab === undefined) return fail('not-found', '标签页已经关了')
    if (tab.owner.kind !== 'bot') return fail('conflict', '这是你自己开的标签页')
    const note = readString(input, 'note')
    tab.controller = 'bot'
    tab.record(note === '' ? '你交还了' : `你交还了：${note}`)
    const waitId = tab.waitId
    tab.waitId = null
    if (waitId !== null && this.deps.waits.get(waitId)?.status === 'open') this.deps.waits.answer({ waitId, answer: note === '' ? '已处理好，标签页交还给你了' : note })
    else this.tell(tab, `[用户交还了标签页 ${tab.id}] ${note === '' ? '可以接着操作了。' : `用户原话：${note}`}`)
    this.deps.browser.emit(tab.id)
    return ok(tab.info())
  }

  /** 画面上的输入：只在你接管时转给页面。点到下拉框时不点下去，返回选项给浮层。 */
  async input(input: unknown): Promise<PodResult<{ readonly overlay: unknown }>> {
    const tab = this.tab(input)
    if (tab === undefined) return fail('not-found', '标签页已经关了')
    if (tab.controller !== 'owner') return fail('conflict', '先点“接管”再操作')
    tab.touch()
    for (const event of readEvents(input)) {
      if (event.type === 'mouse') {
        const x = num(event.x)
        const y = num(event.y)
        if (event.action === 'down') {
          const hit = await tab.call<{ readonly kind: string }>(HIT, x, y).catch(() => ({ kind: 'other' }))
          if (hit.kind === 'select') return ok({ overlay: hit })
        }
        await tab.mouse({ type: MOUSE_TYPES[event.action] ?? 'mouseMoved', x, y, button: event.action === 'move' ? 'none' : (event.button ?? 'left'), clickCount: num(event.clickCount, 1), modifiers: num(event.modifiers) })
      } else if (event.type === 'wheel') {
        await tab.mouse({ type: 'mouseWheel', x: num(event.x), y: num(event.y), deltaX: num(event.deltaX), deltaY: num(event.deltaY) })
      } else if (event.type === 'key') {
        const text = typeof event.text === 'string' && event.text.length > 0 ? event.text : undefined
        await tab.key({
          type: event.action === 'up' ? 'keyUp' : text === undefined ? 'rawKeyDown' : 'keyDown',
          key: String(event.key),
          code: String(event.code),
          windowsVirtualKeyCode: num(event.keyCode),
          modifiers: num(event.modifiers),
          ...(text === undefined || event.action === 'up' ? {} : { text }),
        })
      } else if (event.type === 'text' && typeof event.text === 'string') {
        await tab.insertText(event.text.slice(0, 20_000))
      }
    }
    return ok({ overlay: tab.dialog === null ? null : { kind: 'dialog', ...tab.dialog } })
  }

  async select(input: unknown): Promise<PodResult<null>> {
    const tab = this.tab(input)
    if (tab === undefined) return fail('not-found', '标签页已经关了')
    if (tab.controller !== 'owner') return fail('conflict', '先接管这个标签页')
    const result = await tab.call<{ readonly error?: string }>(SELECT, readString(input, 'ref'), readString(input, 'value'))
    return result.error === undefined ? ok(null) : fail('invalid-input', '这一项选不了')
  }

  async dialog(input: unknown): Promise<PodResult<null>> {
    const tab = this.tab(input)
    if (tab === undefined || tab.dialog === null) return fail('not-found', '对话框已经关了')
    if (tab.controller !== 'owner') return fail('conflict', '先接管这个标签页')
    await tab.handleDialog(readBool(input, 'accept') === true, tab.dialog.type === 'prompt' ? readString(input, 'text') : undefined)
    this.deps.browser.emit(tab.id)
    return ok(null)
  }

  /** 选择文件的浮层：列出这个标签页对应任务文件夹里的文件。 */
  async files(input: unknown): Promise<PodResult<readonly string[]>> {
    const tab = this.tab(input)
    if (tab === undefined) return fail('not-found', '标签页已经关了')
    const folder = this.deps.folderOfTab(tab)
    const found: string[] = []
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 3 || found.length >= 300) return
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) await walk(full, depth + 1)
        else found.push(relative(this.deps.workspaceRoot, full))
      }
    }
    await walk(folder, 0)
    return ok(found.sort())
  }

  /** 只能选工作区里的文件。 */
  resolveWorkspaceFile(path: string, base: string): string | undefined {
    const full = isAbsolute(path) ? resolve(path) : resolve(base, path)
    const root = resolve(this.deps.workspaceRoot)
    if (full !== root && !full.startsWith(`${root}/`)) return undefined
    return existsSync(full) && statSync(full).isFile() ? full : undefined
  }

  async chooseFile(input: unknown): Promise<PodResult<null>> {
    const tab = this.tab(input)
    if (tab === undefined) return fail('not-found', '标签页已经关了')
    if (tab.fileChooser === null) return fail('conflict', '页面没有在等选择文件')
    const file = this.resolveWorkspaceFile(readString(input, 'path'), this.deps.workspaceRoot)
    if (file === undefined) return fail('invalid-input', '只能选工作区里已有的文件')
    await tab.setFiles([file])
    this.deps.browser.emit(tab.id)
    return ok(null)
  }

  async selection(input: unknown): Promise<PodResult<string>> {
    const tab = this.tab(input)
    if (tab === undefined) return fail('not-found', '标签页已经关了')
    return ok(await tab.call<string>(SELECTION))
  }

  /** bot 遇到登录、验证码、两步验证或付款：请你接管这个标签页；子任务等你，其他照常。 */
  requestTakeover(session: PodSession, tab: BrowserTab, reason: string): string {
    const wait = this.deps.waits.ask({
      session,
      kind: 'login',
      title: `接管浏览器：${reason}`,
      detail: `${tab.title}\n${tab.url}\n在 dsh-bot 的浏览器视图里打开这个标签页，点“接管”操作，完成后点“交还”。`,
      bypassed: false,
      data: { tabId: tab.id, url: tab.url },
    })
    tab.waitId = wait.id
    tab.record(`请你接管：${reason}`)
    this.deps.browser.emit(tab.id)
    return wait.id
  }
}
