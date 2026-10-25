import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { arch, homedir, release } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { CdpConnection } from './cdp.ts'
import type { TabIdentity } from './tab.ts'

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
  /** 每个标签页对网站自称的身份：同版本的普通 Chrome。 */
  readonly identity: TabIdentity
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
  // 不让 navigator.webdriver 变成 true：网站靠它一眼认出“这是自动化浏览器”。
  '--disable-blink-features=AutomationControlled',
]

// 只写语言，权重（q=0.9 这些）由 Chrome 自己加；写了会变成 zh;q=0.9;q=0.9，一看就不是正常浏览器。
const ACCEPT_LANGUAGE = 'zh-CN,zh,en'

/** Client Hints 里的系统版本：macOS 按 Darwin 内核版本推（Darwin 20 是 macOS 11，25 起是 macOS 26），推不出来留空。 */
function platformVersion(): string {
  const major = Number(release().split('.')[0])
  if (process.platform === 'darwin' && Number.isFinite(major)) return major >= 25 ? `${major + 1}.0.0` : major >= 20 ? `${major - 9}.0.0` : '10.15.7'
  if (process.platform === 'win32') return '10.0.0'
  return ''
}

function brandOf(executable: string): string | undefined {
  if (executable.includes('Edge') || executable.includes('msedge')) return 'Microsoft Edge'
  if (executable.includes('Brave')) return 'Brave'
  if (executable.toLowerCase().includes('chromium')) return undefined
  return 'Google Chrome'
}

/**
 * 无头 Chrome 的 UA 和 Client Hints 里写着 HeadlessChrome，很多网站（X、各种风控）一看就拦。
 * 换成同一版本的普通 Chrome：版本号、系统、架构都照实填，只去掉“无头”的字样。
 */
export function browserIdentity(executable: string, product: string, userAgent: string): TabIdentity {
  const fullVersion = product.split('/')[1] ?? ''
  const major = fullVersion.split('.')[0] ?? ''
  const brand = brandOf(executable)
  const brands = (version: (full: string) => string) => [
    { brand: 'Not)A;Brand', version: version('8.0.0.0') },
    { brand: 'Chromium', version: version(fullVersion) },
    ...(brand === undefined ? [] : [{ brand, version: version(fullVersion) }]),
  ]
  const platform = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'
  return {
    userAgent: userAgent.replace(/HeadlessChrome/g, 'Chrome'),
    acceptLanguage: ACCEPT_LANGUAGE,
    platform: process.platform === 'darwin' ? 'MacIntel' : process.platform === 'win32' ? 'Win32' : 'Linux x86_64',
    userAgentMetadata: {
      brands: brands((full) => full.split('.')[0] ?? major),
      fullVersionList: brands((full) => full),
      fullVersion,
      platform,
      platformVersion: platformVersion(),
      architecture: arch().startsWith('arm') ? 'arm' : 'x86',
      bitness: '64',
      model: '',
      mobile: false,
      wow64: false,
    },
  }
}

const STARTUP_TIMEOUT_MS = 20_000

/** 启动无头 Chrome，等它能响应 CDP 再返回；启动失败时带上 Chrome 最后的输出。 */
export async function launchChrome(executable: string, profileDir: string): Promise<LaunchedChrome> {
  await mkdir(profileDir, { recursive: true })
  const child = spawn(executable, [...ARGS, `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000)
  })
  const connection = new CdpConnection(child.stdio[3] as Writable, child.stdio[4] as Readable)
  const exited = new Promise<never>((_, reject) => {
    child.once('error', (error) => reject(new Error(`Chrome 启动失败：${error.message}`)))
    child.once('exit', (code) => reject(new Error(`Chrome 启动后退出了（${code ?? '信号'}）：${stderr.trim().split('\n').slice(-3).join(' ')}`)))
  })
  exited.catch(() => undefined)
  try {
    const info = await Promise.race([connection.send<{ product?: string; userAgent?: string }>('Browser.getVersion', {}, undefined, STARTUP_TIMEOUT_MS), exited])
    const version = info.product ?? ''
    return { child, connection, executable, version, identity: browserIdentity(executable, version, info.userAgent ?? '') }
  } catch (error) {
    connection.close()
    child.kill()
    throw error
  }
}
