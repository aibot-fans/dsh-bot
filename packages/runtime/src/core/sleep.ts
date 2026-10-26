import { spawn, type ChildProcess } from 'node:child_process'

/**
 * 有任务运行时阻止电脑休眠（设置里可选，默认关闭）。
 * macOS 用 caffeinate -i，Linux 用 systemd-inhibit；都跟着 dsh web 进程走，进程退出自动解除。
 */
export class SleepGuard {
  private child: ChildProcess | undefined
  private readonly warn: (message: string) => void

  constructor(warn: (message: string) => void) {
    this.warn = warn
  }

  get active(): boolean {
    return this.child !== undefined
  }

  /** 需要时开、不需要时关；重复调用没有副作用。 */
  set(wanted: boolean): void {
    if (wanted && this.child === undefined) this.start()
    if (!wanted && this.child !== undefined) this.stop()
  }

  private start(): void {
    const command =
      process.platform === 'darwin'
        ? ['caffeinate', ['-i', '-w', String(process.pid)]]
        : process.platform === 'linux'
          ? ['systemd-inhibit', ['--what=idle:sleep', '--why=dsh-bot 有任务在运行', 'sleep', 'infinity']]
          : undefined
    if (command === undefined) return
    try {
      const child = spawn(command[0] as string, command[1] as string[], { stdio: 'ignore' })
      child.on('error', (error) => {
        this.warn(`阻止休眠失败：${error.message}`)
        this.child = undefined
      })
      child.on('exit', () => {
        if (this.child === child) this.child = undefined
      })
      child.unref()
      this.child = child
    } catch (error) {
      this.warn(`阻止休眠失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  stop(): void {
    this.child?.kill()
    this.child = undefined
  }
}
