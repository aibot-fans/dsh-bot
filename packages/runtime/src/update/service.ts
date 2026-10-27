import { readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { PACKAGE_NAME, POD_VERSION, compareVersions, fail, isRecord, ok, t, type PodResult, type PodSettings, type ReleaseNote, type UpdateInstall, type UpdateJob, type UpdateStatus } from 'pod-domain'
import { readState, writeState } from 'pod-store'
import type { PodBus } from '../core/bus.ts'
import { later } from '../core/timers.ts'
import type { HostContext, PluginManagerLike } from '../dsh.ts'
import { clearJob, readJob, runUpdate, writeJob, type JobPatch } from './job.ts'
import { installableAt, profileDirOf, releaseAgePolicy } from './pnpm.ts'
import { fetchPublished, updateRegistries } from './registry.ts'

const CHECK_KEY = 'update.check'
/** 启动后等一会儿再查，避开 dsh 启动时的忙碌期。 */
const FIRST_CHECK_MS = 60_000
const TICK_MS = 60 * 60_000
/** 查成了隔 6 小时再查；没查成下一拍（1 小时后）再试。 */
const CHECK_EVERY_MS = 6 * 60 * 60_000
/** 一键更新最多做这么久；过了还没结果，多半是 dsh web 中途重启了。 */
const JOB_TIMEOUT_MS = 15 * 60_000
/** 记下的版本个数，够看更新内容就行。 */
const KEEP_RELEASES = 20

interface CheckRecord {
  readonly latest: string | null
  readonly releases: readonly ReleaseNote[]
  readonly checkedAt: number | null
  readonly error: string | null
}

const EMPTY: CheckRecord = { latest: null, releases: [], checkedAt: null, error: null }

const ORIGINAL = Symbol.for('cordis.original')

/**
 * dsh 的插件管理服务。ctx 上拿到的是绑着 dsh-bot 自己上下文的代理，卸掉旧版时这个上下文就没了，
 * 一键更新卸完还要接着装新版，所以用代理背后的原对象。
 */
export function pluginManagerOf(ctx: HostContext): PluginManagerLike | undefined {
  const service = ctx.get('pluginManager')
  if (typeof service !== 'object' || service === null) return undefined
  const raw: unknown = (service as { readonly [ORIGINAL]?: unknown })[ORIGINAL] ?? service
  if (!isRecord(raw)) return undefined
  const methods = ['listBundles', 'removeBundle', 'installBundle', 'setBundleEnabled']
  return methods.every((method) => typeof raw[method] === 'function') ? (raw as unknown as PluginManagerLike) : undefined
}

/** 从 npm 装的，运行文件（runtime/lib 下）往上两级就是 dsh-bot 包自己的 package.json；源码装的那里不是这个包。 */
function installedFromNpm(): boolean {
  try {
    const manifest: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    return isRecord(manifest) && manifest.name === PACKAGE_NAME
  } catch {
    return false
  }
}

function asRecord(raw: unknown): CheckRecord {
  if (!isRecord(raw) || !Array.isArray(raw.releases)) return EMPTY
  return {
    latest: typeof raw.latest === 'string' ? raw.latest : null,
    releases: raw.releases.filter((item): item is ReleaseNote => isRecord(item) && typeof item.version === 'string'),
    checkedAt: typeof raw.checkedAt === 'number' ? raw.checkedAt : null,
    error: typeof raw.error === 'string' ? raw.error : null,
  }
}

/** 按正在跑的版本看记录：新版已经在跑就算更新完了；做太久没结果的算失败；后来又自己换过版本的，记录过时了，不算。 */
function settle(job: UpdateJob | null, current: string, now: number): UpdateJob | null {
  if (job === null || (current !== job.from && current !== job.to)) return null
  if (current === job.to) return job.outcome === 'done' ? job : { ...job, step: null, outcome: 'done', message: '', finishedAt: job.finishedAt ?? now }
  // 下面跑的都还是旧版。说装好了，跑的却还是旧版：要重启才换过来。
  if (job.outcome === 'done') return { ...job, outcome: 'restart' }
  if (job.outcome === null && now - job.startedAt > JOB_TIMEOUT_MS) {
    return { ...job, step: null, outcome: 'failed', message: job.message === '' ? t('更新没有做完，可能 dsh web 中途重启了。') : job.message, finishedAt: now }
  }
  return job
}

export interface UpdateDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly dataRoot: string
  readonly settings: () => PodSettings
  readonly manager: () => PluginManagerLike | undefined
  /** 正在干活的会话数。 */
  readonly busy: () => number
  readonly now: () => number
  readonly warn: (message: string) => void
}

/**
 * 新版本提醒和一键更新。启动后查一次 npm，之后每 6 小时查一次，只发包名、不带任何别的信息；
 * 查到的版本和更新内容记在数据库里。一键更新交给 dsh 的插件管理去卸旧装新，过程记在数据目录的文件里（见 job.ts）。
 */
export class UpdateService {
  private readonly deps: UpdateDeps
  private readonly npm = installedFromNpm()
  private readonly profileDir = profileDirOf(import.meta.url)
  private checking: Promise<void> | undefined
  private updating = false
  /** 卸掉旧版时 dsh-bot 的数据库和事件流都关了，之后不再写库、不再发事件。 */
  private alive = true

  constructor(deps: UpdateDeps) {
    this.deps = deps
  }

  private record(): CheckRecord {
    return asRecord(readState<unknown>(this.deps.db, CHECK_KEY, null))
  }

  private emit(): void {
    if (this.alive) this.deps.bus.emit({ type: 'update' })
  }

  private install(): UpdateInstall {
    if (!this.npm) return 'source'
    return this.deps.manager() === undefined ? 'manual' : 'npm'
  }

  status(): UpdateStatus {
    const record = this.record()
    const now = this.deps.now()
    const policy = releaseAgePolicy(this.profileDir)
    const releases = record.releases.filter((release) => compareVersions(release.version, POD_VERSION) > 0)
    const target = releases.find((release) => installableAt(policy, PACKAGE_NAME, release.version, release.publishedAt) <= now)?.version ?? null
    const newest = releases[0]
    return {
      current: POD_VERSION,
      latest: record.latest,
      target,
      waiting:
        newest === undefined || newest.version === target
          ? null
          : { version: newest.version, installableAt: installableAt(policy, PACKAGE_NAME, newest.version, newest.publishedAt) },
      releases,
      installed: record.releases.find((release) => release.version === POD_VERSION) ?? null,
      checkedAt: record.checkedAt,
      checking: this.checking !== undefined,
      error: record.error,
      install: this.install(),
      busy: this.deps.busy(),
      job: settle(readJob(this.deps.dataRoot), POD_VERSION, now),
    }
  }

  /** 现在就查一次；已经在查就等那一次。 */
  async check(): Promise<UpdateStatus> {
    if (this.checking === undefined) {
      this.checking = this.fetch().finally(() => {
        this.checking = undefined
        this.emit()
      })
      this.emit()
    }
    await this.checking
    return this.status()
  }

  private async fetch(): Promise<void> {
    const previous = this.record()
    const at = this.deps.now()
    let next: CheckRecord
    try {
      const published = await fetchPublished(PACKAGE_NAME, updateRegistries())
      next = { latest: published.latest, releases: published.releases.slice(0, KEEP_RELEASES), checkedAt: at, error: null }
    } catch (error) {
      next = { ...previous, checkedAt: at, error: error instanceof Error ? error.message : String(error) }
    }
    if (this.alive) writeState(this.deps.db, CHECK_KEY, next)
  }

  /**
   * 一键更新到 version（页面上看到的那个版本）。先核对能不能更新，然后在后台卸旧装新，马上返回；
   * 进度和结果从 status().job 看。
   */
  async apply(version: string): Promise<PodResult<UpdateStatus>> {
    const status = this.status()
    if (status.install === 'source') return fail('conflict', t('这份 dsh-bot 是从源码装的：在仓库里拉新代码、重新构建，再重启 dsh web。'))
    const manager = this.deps.manager()
    if (manager === undefined) return fail('conflict', t('这个 dsh 没有插件管理服务：在 dsh 的插件页里卸掉 dsh-bot，再装新版。'))
    if (this.updating || status.job?.outcome === null) return fail('conflict', t('已经在更新了'))
    if (status.target === null) return fail('conflict', status.waiting === null ? t('已经是最新版了') : t('{version} 发布还不满 pnpm 要求的时间，暂时装不了', { version: status.waiting.version }))
    if (version !== '' && version !== status.target) return fail('conflict', t('能更新到的版本变成了 {target}，看一下更新内容再更新', { target: status.target }))
    const bundle = (await manager.listBundles()).find((item) => item.name === PACKAGE_NAME)
    if (bundle?.installed !== true) return fail('conflict', t('dsh 的插件列表里没有 dsh-bot 这一项：在 dsh 的插件页里更新。'))
    if (!bundle.removable) return fail('conflict', t('dsh 不让卸载 dsh-bot：在 dsh 的插件页里更新。'))
    this.launch({ from: POD_VERSION, to: status.target, startedAt: this.deps.now(), step: null, outcome: null, message: '', finishedAt: null }, manager)
    return ok(this.status())
  }

  private launch(first: UpdateJob, manager: PluginManagerLike): void {
    const { dataRoot, warn } = this.deps
    let job = first
    const record = (patch: JobPatch): void => {
      job = { ...job, ...patch, ...(patch.outcome === undefined ? {} : { step: null, finishedAt: this.deps.now() }) }
      try {
        writeJob(dataRoot, job)
      } catch (error) {
        warn(`dsh-bot 写更新记录出错：${error instanceof Error ? error.message : String(error)}`)
      }
      this.emit()
    }
    writeJob(dataRoot, job)
    this.updating = true
    this.emit()
    void runUpdate(manager, { name: PACKAGE_NAME, from: job.from, to: job.to }, record)
      .catch((error: unknown) => record({ outcome: 'failed', message: error instanceof Error ? error.message : String(error) }))
      .finally(() => {
        this.updating = false
      })
  }

  /** 看过结果了，清掉记录。 */
  dismiss(): UpdateStatus {
    clearJob(this.deps.dataRoot)
    this.emit()
    return this.status()
  }

  settingsChanged(next: PodSettings, previous: PodSettings): void {
    if (next.checkUpdates === previous.checkUpdates) return
    if (next.checkUpdates) {
      void this.check().catch((error: unknown) => this.deps.warn(`dsh-bot 查新版本出错：${String(error)}`))
      return
    }
    // 关掉以后不再提醒，下次打开重新查。
    writeState(this.deps.db, CHECK_KEY, EMPTY)
    this.emit()
  }

  /** 定时查新版本；返回停止函数。卸载 dsh-bot（包括一键更新卸旧版）时调用。 */
  start(): () => void {
    const due = (): void => {
      if (!this.alive || !this.deps.settings().checkUpdates) return
      const { checkedAt, error } = this.record()
      // 留半拍余量，免得差几秒就拖到下一拍。
      const wait = (error === null ? CHECK_EVERY_MS : TICK_MS) - TICK_MS / 2
      if (checkedAt !== null && this.deps.now() - checkedAt < wait) return
      void this.check().catch((reason: unknown) => this.deps.warn(`dsh-bot 查新版本出错：${String(reason)}`))
    }
    const cancelFirst = later(FIRST_CHECK_MS, due)
    const timer = setInterval(due, TICK_MS)
    timer.unref()
    return () => {
      this.alive = false
      cancelFirst()
      clearInterval(timer)
    }
  }
}
