import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, lstatSync } from 'node:fs'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fnv1a, t, type ComputerPermissions } from 'pod-domain'
import { HELPER_EXECUTABLE } from './helper.ts'

const run = promisify(execFile)

/** 小助手的回答（最后一行）。截图是 base64。 */
export interface DaemonResponse {
  readonly ok: boolean
  readonly error?: string
  readonly interrupted?: boolean
  readonly message?: string
  readonly text?: string
  readonly imageData?: string
  readonly imageContentType?: string
  readonly imageWidth?: number
  readonly imageHeight?: number
  readonly permissions?: ComputerPermissions
  readonly instructions?: string
}

export type DaemonControl = 'hello' | 'open-permission-flow' | 'permissions-status' | 'shutdown'

export interface DaemonRequest {
  readonly action?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly control?: DaemonControl
  readonly thinking?: string
}

export interface DaemonReply {
  readonly response: DaemonResponse
  /** 小助手中途的提示（比如在等用户用完屏幕）。 */
  readonly notices: readonly string[]
}

const HELLO = 'comma-computer-use-daemon'
const ACTION_TIMEOUT = 60_000
const CONTROL_TIMEOUT = 2_000
const READY_TIMEOUT = 15_000

/** 套接字放在临时目录里本实例自己的子目录（开发环境和正式环境各一个）；路径太长就放 /tmp。 */
function socketPathFor(dataRoot: string): string {
  const name = `dsh-bot-cu-${fnv1a(dataRoot)}`
  const preferred = join(tmpdir(), name, 'cu.sock')
  return Buffer.byteLength(preferred) <= 100 ? preferred : join('/tmp', `${name}-${userInfo().uid}`, 'cu.sock')
}

/** 画面怎么推：只推这些应用的窗口（别的窗口挡在上面也推不进来），H.264。 */
export interface StreamOptions {
  readonly apps: readonly string[]
  readonly fps: number
  readonly maxWidth: number
  readonly bitrate: number
  /** 画面里没有窗口的地方填什么颜色（#rrggbb）。 */
  readonly background: string
}

/**
 * 和小助手说话：本机 Unix 套接字，每个请求一行 JSON 带上令牌，回答是一行行 JSON（提示和最后的结果）。
 * 小助手按需用 open 拉起（不抢焦点）；令牌存在 dsh-bot 的数据目录里，dsh web 重启后还能接着用同一个小助手。
 */
export class ComputerDaemon {
  readonly socketPath: string
  private readonly tokenPath: string
  /** 拉起前把小助手放到固定位置，返回应用的路径。 */
  private readonly prepare: () => Promise<string>
  private token: string | undefined
  private launching: Promise<void> | undefined

  constructor(dataRoot: string, prepare: () => Promise<string>) {
    this.socketPath = socketPathFor(dataRoot)
    this.tokenPath = join(dataRoot, 'computer-use', 'token')
    this.prepare = prepare
  }

  /** 小助手在跑就直接用，没跑就拉起来。 */
  async ensure(): Promise<void> {
    if (await this.alive()) return
    this.launching ??= this.launch().finally(() => {
      this.launching = undefined
    })
    return this.launching
  }

  async action(name: string, payload: Readonly<Record<string, unknown>>, thinking?: string): Promise<DaemonReply> {
    await this.ensure()
    return this.call({ action: { [name]: payload }, ...(thinking === undefined || thinking === '' ? {} : { thinking }) }, ACTION_TIMEOUT)
  }

  async control(control: DaemonControl): Promise<DaemonReply> {
    await this.ensure()
    return this.call({ control }, control === 'open-permission-flow' ? ACTION_TIMEOUT : CONTROL_TIMEOUT)
  }

  /**
   * 开一路画面：连接切成画面流，之后两边都是一帧帧的（类型 1 字节、长度 4 字节大端、内容），
   * 小助手发视频（H.264）和状态（JSON），这边能发 JSON（要关键帧、停）。连接断开画面就停。
   * 令牌不对时小助手回一行 JSON 就断开。
   */
  async openStream(options: StreamOptions): Promise<Socket> {
    await this.ensure()
    const token = await this.authToken()
    const stream = { target: 'apps', apps: options.apps, fps: options.fps, max_width: options.maxWidth, bitrate: options.bitrate, control: false, background: options.background }
    return new Promise<Socket>((resolve, reject) => {
      const socket = createConnection({ path: this.socketPath })
      socket.once('error', reject)
      socket.once('connect', () => {
        socket.off('error', reject)
        socket.write(`${JSON.stringify({ control: 'stream', stream, auth_token: token })}\n`)
        resolve(socket)
      })
    })
  }

  /** 结束小助手里的会话；小助手没在跑就算了，不为这个拉起它。 */
  async end(): Promise<void> {
    if (!(await this.alive())) return
    await this.call({ action: { end: {} } }, ACTION_TIMEOUT).catch(() => undefined)
  }

  /** 让小助手退出（dsh web 停下、重装小助手前）；没在跑就算了。 */
  async shutdown(): Promise<void> {
    if (!(await this.alive())) return
    await this.call({ control: 'shutdown' }, CONTROL_TIMEOUT).catch(() => undefined)
    await rm(this.socketPath, { force: true }).catch(() => undefined)
  }

  private async alive(): Promise<boolean> {
    if (!existsSync(this.socketPath)) return false
    try {
      const { response } = await this.call({ control: 'hello' }, CONTROL_TIMEOUT)
      return response.ok && response.message?.trim() === HELLO
    } catch {
      return false
    }
  }

  private async launch(): Promise<void> {
    const executable = join(await this.prepare(), 'Contents', 'MacOS', HELPER_EXECUTABLE)
    if (!existsSync(executable)) throw new Error(t('找不到用电脑的小助手：{path}', { path: executable }))
    const token = await this.authToken()
    await this.prepareSocketDir()
    await rm(this.socketPath, { force: true })
    // 先让小助手确认自己的位置（嵌在别的应用里时它会先装到固定位置），再用 open 拉起：它要以自己的身份拿系统授权。
    const prepared = (await run(executable, ['--prepare-app'], { timeout: READY_TIMEOUT })).stdout.trim()
    if (prepared === '') throw new Error(t('小助手没给出应用位置'))
    await run('open', ['-n', '-g', '--env', `COMMA_COMPUTER_USE_SOCKET_PATH=${this.socketPath}`, '--env', `COMMA_COMPUTER_USE_AUTH_TOKEN=${token}`, prepared], { timeout: READY_TIMEOUT })
    const deadline = Date.now() + READY_TIMEOUT
    while (Date.now() < deadline) {
      if (await this.alive()) return
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    throw new Error(t('小助手 15 秒内没准备好'))
  }

  /** 套接字目录只给自己：已有的必须是自己的真目录，不是链接。 */
  private async prepareSocketDir(): Promise<void> {
    const dir = dirname(this.socketPath)
    if (existsSync(dir)) {
      const info = lstatSync(dir)
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== userInfo().uid) throw new Error(t('小助手的套接字目录不对：{dir}', { dir }))
    } else {
      await mkdir(dir, { recursive: true, mode: 0o700 })
    }
    await chmod(dir, 0o700)
  }

  private async authToken(): Promise<string> {
    if (this.token !== undefined) return this.token
    const saved = await readFile(this.tokenPath, 'utf8').then(
      (value) => value.trim(),
      () => '',
    )
    if (saved.length >= 32) {
      this.token = saved
      return saved
    }
    const fresh = randomBytes(32).toString('base64url')
    await mkdir(dirname(this.tokenPath), { recursive: true, mode: 0o700 })
    await writeFile(this.tokenPath, fresh, { mode: 0o600 })
    this.token = fresh
    return fresh
  }

  /** 发一个请求，读到最后的结果为止；中途有提示就把超时往后推。 */
  private async call(request: DaemonRequest, timeoutMs: number): Promise<DaemonReply> {
    const token = await this.authToken()
    return new Promise<DaemonReply>((resolve, reject) => {
      const socket = createConnection({ path: this.socketPath })
      let notices: readonly string[] = []
      let parts: readonly Buffer[] = []
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const finish = (settle: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.destroy()
        settle()
      }
      const arm = (): void => {
        clearTimeout(timer)
        timer = setTimeout(() => finish(() => reject(new Error(t('小助手 {seconds} 秒没回应', { seconds: Math.round(timeoutMs / 1000) })))), timeoutMs)
      }
      const handle = (line: string): void => {
        let parsed: DaemonResponse & { readonly kind?: string; readonly response?: DaemonResponse }
        try {
          parsed = JSON.parse(line) as typeof parsed
        } catch {
          finish(() => reject(new Error(t('小助手的回答看不懂'))))
          return
        }
        if (parsed.kind === 'notice') {
          if (typeof parsed.message === 'string' && parsed.message.trim() !== '') notices = [...notices, parsed.message.trim()]
          arm()
          return
        }
        const response = parsed.kind === 'final' ? parsed.response : parsed
        finish(() => (response === undefined ? reject(new Error(t('小助手给了空结果'))) : resolve({ response, notices })))
      }
      arm()
      socket.on('connect', () => socket.write(`${JSON.stringify({ ...request, auth_token: token })}\n`))
      socket.on('data', (chunk: Buffer) => {
        let rest = chunk
        for (let end = rest.indexOf(10); end !== -1; end = rest.indexOf(10)) {
          const line = Buffer.concat([...parts, rest.subarray(0, end)]).toString('utf8').trim()
          parts = []
          rest = rest.subarray(end + 1)
          if (line !== '') handle(line)
        }
        parts = [...parts, rest]
      })
      socket.on('error', (error) => finish(() => reject(error)))
      socket.on('close', () => finish(() => reject(new Error(t('小助手没给结果就断开了')))))
    })
  }
}
