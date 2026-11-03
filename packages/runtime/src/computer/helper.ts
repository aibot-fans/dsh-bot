import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { homedir, release } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { t, type ComputerHelperState } from 'pod-domain'

const run = promisify(execFile)

export const HELPER_NAME = 'dsh-bot Computer Use'
export const HELPER_EXECUTABLE = 'CommaComputerUseDaemon'

const EXECUTABLE_FILE = `Contents/MacOS/${HELPER_EXECUTABLE}`
/** 这几个文件都一样就是同一份小助手，不用再拷（只为省得重拷，不是校验身份）。 */
const CODE_FILES = [EXECUTABLE_FILE, 'Contents/Info.plist', 'Contents/_CodeSignature/CodeResources']

/**
 * 随 dsh-bot 一起发的小助手：开源项目 Comma（AGPL-3.0）的 macOS 应用，源码原样在仓库的 vendor/comma-computer-use，
 * 发版前编好（pnpm build:computer-use）放在 pod-runtime 包的 assets/computer-use 里：构建后从 lib/ 往上一层，直接跑源码时往上两层。
 */
export function bundledApp(): string | undefined {
  for (const relative of ['../assets/computer-use/', '../../assets/computer-use/']) {
    const app = join(fileURLToPath(new URL(relative, import.meta.url)), `${HELPER_NAME}.app`)
    if (existsSync(join(app, EXECUTABLE_FILE))) return app
  }
  return undefined
}

/**
 * 用的时候先拷到用户目录下固定的位置再拉起：开发环境和正式环境共用一份，路径不随 dsh-bot 升级变，
 * 系统授权给这一份（重新编译过的小助手签名会变，授权要重给）。
 */
export function helperHome(): string {
  return join(homedir(), 'Library', 'Application Support', 'dsh-bot', 'Computer Use')
}

export function helperApp(): string {
  return join(helperHome(), `${HELPER_NAME}.app`)
}

export function helperExecutable(): string {
  return join(helperApp(), EXECUTABLE_FILE)
}

/** 小助手要 macOS 14（Darwin 23）以上。 */
export function computerSupported(): boolean {
  return process.platform === 'darwin' && Number(release().split('.')[0]) >= 23
}

function sameCode(left: string, right: string): boolean {
  return CODE_FILES.every((file) => {
    const a = join(left, file)
    const b = join(right, file)
    return existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b))
  })
}

/** 小助手随 dsh-bot 一起装：在不在包里、拷到固定位置。 */
export class ComputerHelper {
  state(): ComputerHelperState {
    if (!computerSupported()) return 'unsupported'
    return bundledApp() !== undefined || existsSync(helperExecutable()) ? 'ready' : 'missing'
  }

  message(): string {
    switch (this.state()) {
      case 'unsupported':
        return t('用电脑只支持 macOS 14 以上')
      case 'missing':
        return t('这份 dsh-bot 里没带用电脑的小助手（从源码装的先运行 pnpm build:computer-use）')
      case 'ready':
        return t('小助手随 dsh-bot 一起装好了')
    }
  }

  /**
   * 拉起前确认固定位置上是包里这一份：没有或者不一样（换了版本）就拷过去。
   * 先拷到旁边的临时目录，拷完再换上，拷到一半出错旧的还在。包里没带时用已经在固定位置上的那份。
   */
  async prepare(): Promise<string> {
    const source = bundledApp()
    const target = helperApp()
    if (source === undefined) {
      if (existsSync(helperExecutable())) return target
      throw new Error(this.message())
    }
    if (sameCode(source, target)) return target
    const staging = join(helperHome(), `.staging-${randomUUID()}`)
    await mkdir(staging, { recursive: true })
    try {
      const copy = join(staging, `${HELPER_NAME}.app`)
      // ditto 原样保留签名和扩展属性。
      await run('ditto', [source, copy], { timeout: 60_000 })
      await rm(target, { recursive: true, force: true })
      await rename(copy, target)
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
    return target
  }
}
