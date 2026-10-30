/** 新版本提醒和一键更新：宿主查到的新版本、更新内容和更新进度，页面照着显示。 */

/** 发到 npm 上的包名；一键更新就是让 dsh 的插件管理重装这个包。 */
export const PACKAGE_NAME = '@aibot_fans/dsh-bot'

/** 每个版本的更新说明，和 npm 包里带的一样，都是从上一个版本以来的提交生成的。 */
export const RELEASES_URL = 'https://github.com/aibot-fans/dsh-bot/releases'

/** 比当前新的一个版本。 */
export interface ReleaseNote {
  readonly version: string
  /** 发布时间（毫秒）；注册表没给就是 null。 */
  readonly publishedAt: number | null
  /** 这一版的更新说明（Markdown）；早期版本发包时没带，是 null。 */
  readonly notes: string | null
}

/**
 * 这份 dsh-bot 是怎么装的：
 * npm：从 npm 装的，能一键更新；source：从源码装的（link: 到仓库），要自己拉代码构建；
 * manual：dsh 没给插件管理服务（比如桌面版），要在 dsh 的插件页里卸了重装。
 */
export type UpdateInstall = 'npm' | 'source' | 'manual'

/** 一键更新做到哪了。卸旧版那一步以后 dsh-bot 会暂时不在，新版装好才回来。 */
export type UpdateStep = 'removing' | 'installing' | 'restoring'

/** 一键更新的结果：done 是新版已经在跑；restart 是装好了、重启 dsh web 才生效；failed 是没更新成。 */
export type UpdateOutcome = 'done' | 'restart' | 'failed'

export interface UpdateJob {
  readonly from: string
  readonly to: string
  readonly startedAt: number
  /** 还在做时是当前这一步；做完是 null。 */
  readonly step: UpdateStep | null
  readonly outcome: UpdateOutcome | null
  /** 没更新成的原因，或者装回旧版的结果。 */
  readonly message: string
  readonly finishedAt: number | null
}

export interface UpdateStatus {
  /** 正在跑的版本。 */
  readonly current: string
  /** npm 上最新的正式版；没查过或没查到是 null。 */
  readonly latest: string | null
  /** 现在能一键更新到的版本：比当前新、发布时间也够 pnpm 的安全期了。没有就是 null。 */
  readonly target: string | null
  /** 比当前新、但发布还不满 pnpm 的安全期（默认一天）的版本，到 installableAt 才能装。 */
  readonly waiting: { readonly version: string; readonly installableAt: number } | null
  /** 比当前新的各版本，新的在前，到 latest 为止。 */
  readonly releases: readonly ReleaseNote[]
  /** 正在跑的这一版：更新完以后给你看更新了什么。记录里没有是 null。 */
  readonly installed: ReleaseNote | null
  readonly checkedAt: number | null
  readonly checking: boolean
  /** 上次没查成的原因。 */
  readonly error: string | null
  readonly install: UpdateInstall
  /** 正在干活的会话数：一键更新会打断它们，新版起来后任务会接着做。 */
  readonly busy: number
  /** 最近一次一键更新；用户看过结果、点了知道了就清掉。 */
  readonly job: UpdateJob | null
}

type Version = readonly [number, number, number, string]

function parseVersion(text: string): Version | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim())
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? '']
}

/** 是不是一个合法的正式版版本号（不带预发布后缀）。 */
export function isReleaseVersion(text: string): boolean {
  const version = parseVersion(text)
  return version !== undefined && version[3] === ''
}

/** 按版本号比大小：a 比 b 新返回正数。预发布版排在同号正式版前面；不认识的写法当最小。 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === undefined || right === undefined) return (left === undefined ? 0 : 1) - (right === undefined ? 0 : 1)
  for (const index of [0, 1, 2] as const) {
    const diff = left[index] - right[index]
    if (diff !== 0) return diff
  }
  if (left[3] === right[3]) return 0
  if (left[3] === '') return 1
  if (right[3] === '') return -1
  return left[3].localeCompare(right[3], 'en', { numeric: true })
}
