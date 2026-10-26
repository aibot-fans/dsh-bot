import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { SHELL_TOOLS } from './exposure.ts'

export interface DataGuardOptions {
  /** dsh 自己的目录（$DSH_HOME，默认 ~/.dsh）：设置、会话、日志和 Pod 的数据都在这里。 */
  readonly dshHome: string
  /** Pod 的数据目录：pod.db、search.db（和它们的 -wal、-shm）、备份、共用浏览器的资料。 */
  readonly dataRoot: string
  readonly home?: string
}

/** 文件工具和它们写路径的参数（dsh 的 read、write、edit、glob、grep 等）。 */
const FILE_TOOLS: Readonly<Record<string, string>> = {
  read: 'file_path',
  read_image: 'file_path',
  write: 'file_path',
  edit: 'file_path',
  str_replace_editor: 'path',
  glob: 'path',
  grep: 'path',
}

/** 命令里提到 Pod 的库文件：pod.db、search.db，连同 -wal、-shm、-journal（pod.db.md 这种别的文件不算）。 */
const DATABASE = /(?:^|[^\w.-])(?:pod|search)\.db(?:-wal|-shm|-journal)?(?![\w.-])/i

/** dsh 目录里 bot 可以用的地方：技能（技能说明里会让 bot 读或者运行技能目录里的文件）。 */
const ALLOWED_INSIDE = /^\/skills(?:\/|$|[^\w.-])/

const DENIED =
  'Pod 和 dsh 的数据（pod.db、search.db 和 dsh 目录里的文件）不能直接读写：直接改库会绕过校验，界面也不会刷新，还可能把数据弄坏。' +
  '改例程用 update_routine（改时间、改内容、换人、改发到哪、暂停和恢复），看例程用 list_routines；别的 Pod 设置请用户在界面里改，或者问用户。工具返回的结果就是改好后的状态，不用另外验证。'

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function args(raw: unknown): Readonly<Record<string, unknown>> {
  if (typeof raw === 'string') {
    try {
      return args(JSON.parse(raw) as unknown)
    } catch {
      return {}
    }
  }
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Readonly<Record<string, unknown>>) : {}
}

function inside(path: string, root: string): string | undefined {
  const rest = relative(root, path)
  return rest === '' || (!rest.startsWith('..') && !isAbsolute(rest)) ? `/${rest}` : undefined
}

/**
 * 挡住 bot 直接碰 Pod 和 dsh 的数据：shell 命令里提到库文件或 dsh 目录，文件工具的路径落在 dsh 目录或数据目录里，都拒绝。
 * dsh 目录里只放开技能目录。这是护栏不是沙箱：防的是 bot 图省事绕过 Pod 的工具去改库，不防成心绕过。
 * @param cwd - 这条会话的工作目录：文件工具的相对路径按它算。
 * @returns 拒绝的理由；不拦返回 undefined。
 */
export function dataGuard(options: DataGuardOptions): (call: { readonly name: string; readonly arguments?: unknown }, cwd: string) => string | undefined {
  const home = options.home ?? homedir()
  const dshHome = resolve(options.dshHome)
  const dataRoot = resolve(options.dataRoot)
  const homeRefs = ['~', '$HOME', '${HOME}', home].map((prefix) => `${escape(prefix)}/\\.dsh(?![\\w.-])`)
  const roots = [...homeRefs, '\\$DSH_HOME\\b', '\\$\\{DSH_HOME\\}', `${escape(dshHome)}(?![\\w.-])`, `${escape(dataRoot)}(?![\\w.-])`]
  const reference = new RegExp(`(?:${roots.join('|')})(\\S*)`, 'g')

  const commandTouches = (command: string): boolean => {
    if (DATABASE.test(command)) return true
    for (const match of command.matchAll(reference)) {
      const rest = match[1] ?? ''
      if (!ALLOWED_INSIDE.test(rest) || rest.includes('..')) return true
    }
    return false
  }

  const pathTouches = (raw: string, cwd: string): boolean => {
    if (raw === '') return false
    const expanded = raw === '~' ? home : raw.startsWith('~/') ? join(home, raw.slice(2)) : raw
    const path = resolve(cwd, expanded)
    if (inside(path, dataRoot) !== undefined) return true
    const rest = inside(path, dshHome)
    return rest !== undefined && !ALLOWED_INSIDE.test(rest)
  }

  return (call, cwd) => {
    const input = args(call.arguments)
    if (SHELL_TOOLS.has(call.name)) return typeof input.command === 'string' && commandTouches(input.command) ? DENIED : undefined
    const key = FILE_TOOLS[call.name]
    if (key === undefined) return undefined
    const value = input[key]
    return typeof value === 'string' && pathTouches(value.trim(), cwd) ? DENIED : undefined
  }
}
