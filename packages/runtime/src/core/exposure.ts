import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { t } from 'pod-domain'

export interface Exposure {
  readonly exposed: boolean
  readonly reasons: readonly string[]
  /** 开过对外访问、现在没在运行：只提醒，不降级。 */
  readonly note: string | null
}

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|\[::1\]|localhost)$/i

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function argValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index >= 0) return argv[index + 1]
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`))
  return inline?.slice(flag.length + 1)
}

/**
 * dsh web 有没有对外开放：绑定了本机以外的地址、配了公网入口（--public-url、--trusted-host），
 * 或者 dsh 目录里的 web-public.pid 对应的进程还在跑。对外开放时 Pod 默认禁用 shell 和浏览器写操作。
 */
export function detectExposure(options: { readonly argv?: readonly string[]; readonly dshHome?: string } = {}): Exposure {
  const argv = options.argv ?? process.argv
  const dshHome = options.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const reasons: string[] = []
  const host = argValue(argv, '--host')
  if (host !== undefined && !LOOPBACK.test(host)) reasons.push(t('dsh web 绑定在 {host}，不只是本机', { host }))
  if (argValue(argv, '--public-url') !== undefined) reasons.push(t('dsh web 配了公网入口（--public-url）'))
  if (argValue(argv, '--trusted-host') !== undefined) reasons.push(t('dsh web 信任了额外的访问来源（--trusted-host）'))
  const publicPid = join(dshHome, 'web-public.pid')
  let note: string | null = null
  if (existsSync(publicPid)) {
    const pid = Number(readFileSync(publicPid, 'utf8').trim().split(/\s+/)[0])
    if (Number.isInteger(pid) && pid > 0 && alive(pid)) reasons.push(t('dsh 的对外访问正在运行（web-public.pid）'))
    else note = t('dsh 目录里有 web-public.pid，说明以前开过对外访问；现在没在运行')
  }
  return { exposed: reasons.length > 0, reasons, note }
}

/** 对外开放时禁用的工具：shell。浏览器写操作在审批那一步拦。 */
export const SHELL_TOOLS: ReadonlySet<string> = new Set(['bash', 'pwsh', 'bash_persistent', 'pwsh_persistent'])
