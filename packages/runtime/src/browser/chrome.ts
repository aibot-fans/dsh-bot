import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { t } from 'pod-domain'
import { CdpConnection } from './cdp.ts'
import { readScreen, screenInfoArg } from './screen.ts'

/** 按平台找本机的 Chrome 系浏览器；都用 Pod 自己的 profile，不碰你日常 Chrome 的数据。 */
function candidates(): readonly string[] {
  if (process.platform === 'darwin') {
    const apps = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Chromium.app/Contents/MacOS/Chromium', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'Brave Browser.app/Contents/MacOS/Brave Browser']
    return [...apps.map((app) => `/Applications/${app}`), ...apps.map((app) => join(homedir(), 'Applications', app))]
  }
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter((root): root is string => root !== undefined)
    return roots.flatMap((root) => [join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')])
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge']
}

export function findChrome(custom: string): string | undefined {
  if (custom !== '') return existsSync(custom) ? custom : undefined
  return candidates().find((path) => existsSync(path))
}

export interface LaunchedChrome {
  readonly child: ChildProcess
  readonly connection: CdpConnection
  readonly executable: string
  readonly version: string
  /** 对网站自称的 UA：启动时统一去掉了“无头”字样，标签页、iframe、Service Worker 和弹窗都一样。 */
  readonly userAgent: string
}

/** 上次启动用的 UA：同一个浏览器、同一个版本就直接用它启动，不用先读一遍。 */
export interface RememberedAgent {
  readonly executable: string
  readonly version: string
  readonly userAgent: string
}

const ARGS = [
  '--headless',
  '--remote-debugging-pipe',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-sync',
  '--disable-features=Translate,MediaRouter,OptimizationHints',
  '--password-store=basic',
  '--use-mock-keychain',
  '--mute-audio',
  '--window-size=1280,800',
  '--lang=zh-CN',
  // 只写语言，权重（q=0.9 这些）由 Chrome 自己加；写了会变成 zh;q=0.9;q=0.9，一看就不是正常浏览器。
  '--accept-lang=zh-CN,zh,en',
  // 不让 navigator.webdriver 变成 true：网站靠它一眼认出“这是自动化浏览器”。
  '--disable-blink-features=AutomationControlled',
]

const STARTUP_TIMEOUT_MS = 20_000
const CLOSE_TIMEOUT_MS = 3000

/**
 * 启动共用浏览器。无头 Chrome 的 UA 写着 HeadlessChrome，很多网站（X、各种风控）一看就拦；
 * 只改标签页的 UA 盖不住跨站 iframe、Service Worker 和页面弹出的窗口，所以用 --user-agent 在启动时统一换掉，
 * 版本号、品牌和系统这些 Client Hints 都用 Chrome 自己的，不手写。
 * 记过这个浏览器这个版本的 UA 就直接用它启动；没记过或者 Chrome 升级了，先读出 Chrome 自己的 UA，去掉“无头”字样再重启一次。
 */
export async function startChrome(executable: string, profileDir: string, remembered: RememberedAgent | undefined): Promise<LaunchedChrome> {
  const screen = screenInfoArg(await readScreen())
  const known = remembered?.executable === executable ? remembered : undefined
  if (known !== undefined) {
    const chrome = await launchChrome(executable, profileDir, [screen, `--user-agent=${known.userAgent}`])
    if (chrome.version === known.version) return chrome
    await closeChrome(chrome)
  }
  const plain = await launchChrome(executable, profileDir, [screen])
  const userAgent = plain.userAgent.replace(/HeadlessChrome/g, 'Chrome')
  if (userAgent === plain.userAgent) return plain
  await closeChrome(plain)
  return launchChrome(executable, profileDir, [screen, `--user-agent=${userAgent}`])
}

/** 关掉 Chrome 并等进程真的退出：同一个 profile 同时只能有一个 Chrome 在用，没退干净就重启会被它接走。 */
async function closeChrome(chrome: LaunchedChrome): Promise<void> {
  const exited = new Promise<void>((resolve) => {
    if (chrome.child.exitCode !== null || chrome.child.signalCode !== null) resolve()
    else chrome.child.once('exit', () => resolve())
  })
  await chrome.connection.send('Browser.close', {}, undefined, CLOSE_TIMEOUT_MS).catch(() => undefined)
  chrome.connection.close()
  const timer = setTimeout(() => chrome.child.kill(), CLOSE_TIMEOUT_MS)
  await exited
  clearTimeout(timer)
}

/** 启动无头 Chrome，等它能响应 CDP 再返回；启动失败时带上 Chrome 最后的输出。 */
async function launchChrome(executable: string, profileDir: string, extra: readonly string[]): Promise<LaunchedChrome> {
  await mkdir(profileDir, { recursive: true })
  const child = spawn(executable, [...ARGS, ...extra, `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000)
  })
  const connection = new CdpConnection(child.stdio[3] as Writable, child.stdio[4] as Readable)
  const exited = new Promise<never>((_, reject) => {
    child.once('error', (error) => reject(new Error(t('Chrome 启动失败：{message}', { message: error.message }))))
    child.once('exit', (code) => reject(new Error(t('Chrome 启动后退出了（{code}）：{output}', { code: code ?? t('信号'), output: stderr.trim().split('\n').slice(-3).join(' ') }))))
  })
  exited.catch(() => undefined)
  try {
    const info = await Promise.race([connection.send<{ product?: string; userAgent?: string }>('Browser.getVersion', {}, undefined, STARTUP_TIMEOUT_MS), exited])
    return { child, connection, executable, version: info.product ?? '', userAgent: info.userAgent ?? '' }
  } catch (error) {
    connection.close()
    child.kill()
    throw error
  }
}
