import { existsSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** pnpm 11 的默认：新发布的版本要满一天（1440 分钟）才装，防供应链投毒。 */
const DEFAULT_MINIMUM_RELEASE_AGE = 24 * 60

/**
 * 从 npm 装的 dsh-bot 在 dsh 的 profile 目录下的 node_modules 里，第一个 node_modules 之前就是 profile 目录。
 * 源码装的（link: 到仓库）不在 node_modules 里，返回 undefined。
 */
export function profileDirOf(moduleUrl: string): string | undefined {
  const path = fileURLToPath(moduleUrl)
  const index = path.indexOf(`${sep}node_modules${sep}`)
  if (index === -1) return undefined
  const dir = path.slice(0, index)
  return existsSync(join(dir, 'package.json')) ? dir : undefined
}

export interface ReleaseAgePolicy {
  /** 发布后要等的分钟数。 */
  readonly minutes: number
  /** minimumReleaseAgeExclude 里放行的包名或 包名@版本，可以带 *。 */
  readonly exclude: readonly string[]
}

function unquote(text: string): string {
  const value = text.trim()
  return /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value
}

/**
 * 读 profile 的 pnpm-workspace.yaml 里的 minimumReleaseAge 和 minimumReleaseAgeExclude。
 * 只认这两个顶层键（数字、行内列表或下面一行一项的列表），读不到按 pnpm 的默认。
 */
export function releaseAgePolicy(profileDir: string | undefined): ReleaseAgePolicy {
  const file = profileDir === undefined ? undefined : join(profileDir, 'pnpm-workspace.yaml')
  if (file === undefined || !existsSync(file)) return { minutes: DEFAULT_MINIMUM_RELEASE_AGE, exclude: [] }
  let minutes = DEFAULT_MINIMUM_RELEASE_AGE
  const exclude: string[] = []
  let inExclude = false
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const age = /^minimumReleaseAge:\s*(\d+)\s*(?:#.*)?$/.exec(line)
    if (age !== null) minutes = Number(age[1])
    const list = /^minimumReleaseAgeExclude:\s*(.*)$/.exec(line)
    if (list !== null) {
      const inline = /^\[(.*)\]\s*(?:#.*)?$/.exec(list[1] ?? '')
      if (inline !== null) exclude.push(...(inline[1] ?? '').split(',').map(unquote).filter((item) => item !== ''))
      inExclude = inline === null
      continue
    }
    if (!inExclude) continue
    const item = /^\s+-\s+(.+?)\s*(?:#.*)?$/.exec(line)
    if (item !== null) exclude.push(unquote(item[1] ?? ''))
    else if (/^\S/.test(line)) inExclude = false
  }
  return { minutes, exclude }
}

function matches(pattern: string, text: string): boolean {
  const source = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*')
  return new RegExp(`^${source}$`).test(text)
}

/** 这个版本什么时候能装：放行了就是发布时间，否则发布时间加上要等的时间。不知道发布时间的当作早就能装。 */
export function installableAt(policy: ReleaseAgePolicy, name: string, version: string, publishedAt: number | null): number {
  if (publishedAt === null) return 0
  const excluded = policy.exclude.some((entry) => {
    const at = entry.lastIndexOf('@')
    return at > 0 ? entry.slice(0, at) === name && entry.slice(at + 1) === version : matches(entry, name)
  })
  return excluded ? publishedAt : publishedAt + policy.minutes * 60_000
}
