import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isRecord, type UpdateJob, type UpdateOutcome, type UpdateStep } from 'pod-domain'
import type { PluginChangeResult, PluginManagerLike } from '../dsh.ts'

/**
 * 一键更新的记录放在数据目录的一个文件里，不进数据库：卸旧版那一步会关掉旧版的数据库，
 * 新版（或者装回来的旧版）启动后从这里读到结果。
 */
const FILE = 'update-job.json'

const STEPS: readonly UpdateStep[] = ['removing', 'installing', 'restoring']
const OUTCOMES: readonly UpdateOutcome[] = ['done', 'restart', 'failed']

export function readJob(dataRoot: string): UpdateJob | null {
  const file = join(dataRoot, FILE)
  if (!existsSync(file)) return null
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!isRecord(raw) || typeof raw.from !== 'string' || typeof raw.to !== 'string' || typeof raw.startedAt !== 'number') return null
    return {
      from: raw.from,
      to: raw.to,
      startedAt: raw.startedAt,
      step: STEPS.includes(raw.step as UpdateStep) ? (raw.step as UpdateStep) : null,
      outcome: OUTCOMES.includes(raw.outcome as UpdateOutcome) ? (raw.outcome as UpdateOutcome) : null,
      message: typeof raw.message === 'string' ? raw.message : '',
      finishedAt: typeof raw.finishedAt === 'number' ? raw.finishedAt : null,
    }
  } catch {
    return null
  }
}

/** 先写临时文件再改名，读的一方不会读到写了一半的。 */
export function writeJob(dataRoot: string, job: UpdateJob): void {
  const file = join(dataRoot, FILE)
  writeFileSync(`${file}.tmp`, `${JSON.stringify(job)}\n`, { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
}

export function clearJob(dataRoot: string): void {
  rmSync(join(dataRoot, FILE), { force: true })
}

const ERRORS: Readonly<Record<string, string>> = {
  'incompatible-version': '新版本要求的 dsh 版本和你装的对不上，先升级 dsh',
  'already-installed': 'dsh 说已经装着 dsh-bot，不能直接装新版',
  'not-removable': 'dsh 不让卸载 dsh-bot',
  'bundle-in-use': 'dsh 说 dsh-bot 正被别的插件用着',
  'management-required': 'dsh 的插件管理不让改 dsh-bot',
  'operation-error': 'dsh 的插件管理出错了',
}

const FAILURES: Readonly<Record<string, string>> = {
  network: '连不上 npm（所有安装源都试过了）',
  timeout: '下载超时',
  'not-found': '安装源里找不到这个包',
  'no-matching-version': '安装源里还没有这个版本（镜像可能还没同步，或者发布不满一天）',
  'disk-full': '磁盘满了',
  permission: '没有权限写 dsh 的 profile 目录',
  'build-blocked': 'pnpm 拦下了构建脚本',
  integrity: '下载下来的文件校验不对',
  'pnpm-missing': '找不到 pnpm',
}

/** 改动没成的原因；成了返回 undefined。被更高层的配置覆盖也算装上了。 */
export function problemOf(result: PluginChangeResult): string | undefined {
  if (result.application !== 'failed' && result.application !== 'cancelled' && result.error === undefined) return undefined
  if (result.application === 'cancelled') return '安装被取消了'
  const kind = result.packageResult?.kind
  if (kind !== undefined && FAILURES[kind] !== undefined) return FAILURES[kind]
  const code = result.error?.code
  if (code !== undefined) return ERRORS[code] ?? result.error?.diagnostic?.slice(0, 200) ?? code
  const output = result.packageResult?.output.trim().split('\n').at(-1)
  return output === undefined || output === '' ? '安装没成功，详情见 dsh 日志' : output.slice(0, 200)
}

async function attempt(work: () => Promise<PluginChangeResult>): Promise<PluginChangeResult> {
  try {
    return await work()
  } catch (error) {
    return { changed: false, application: 'failed', error: { code: 'thrown', diagnostic: error instanceof Error ? error.message : String(error) } }
  }
}

export interface UpdatePlan {
  readonly name: string
  readonly from: string
  readonly to: string
}

export type JobPatch = Partial<Pick<UpdateJob, 'step' | 'outcome' | 'message'>>

/**
 * 照 dsh 插件页更新官方插件的做法先卸再装：开了 HMR 的 profile 卸掉旧版、装上新版，新版当场接着跑，不用重启；
 * 没开 HMR 的卸不掉正在跑的包（stop-profile），就直接装在上面，重启 dsh web 后生效。新版没装上就装回原来的版本。
 * 卸掉旧版以后，dsh-bot 自己（也就是跑着这段代码的插件）已经停了：之后只调插件管理、写记录文件，不碰数据库和事件。
 */
export async function runUpdate(manager: PluginManagerLike, plan: UpdatePlan, record: (patch: JobPatch) => void): Promise<void> {
  const spec = (version: string): string => `${plan.name}@${version}`
  record({ step: 'removing' })
  const removed = await attempt(() => manager.removeBundle(plan.name))
  if (removed.error?.code === 'stop-profile') {
    record({ step: 'installing' })
    const problem = problemOf(await attempt(() => manager.installBundle(spec(plan.to), { saveExact: true })))
    record(problem === undefined ? { outcome: 'restart' } : { outcome: 'failed', message: `${problem}。旧版照常在用。` })
    return
  }
  const removeProblem = problemOf(removed)
  if (removeProblem !== undefined) {
    // 卸到一半停下时可能已经取消选中了，选回来，旧版接着用。
    await attempt(() => manager.setBundleEnabled(plan.name, true))
    record({ outcome: 'failed', message: `卸载旧版时出错：${removeProblem}。` })
    return
  }
  record({ step: 'installing' })
  const installed = await attempt(() => manager.installBundle(spec(plan.to), { saveExact: true }))
  const problem = problemOf(installed)
  if (problem === undefined) {
    record({ outcome: installed.application === 'restart-required' ? 'restart' : 'done' })
    return
  }
  record({ step: 'restoring', message: problem })
  const restoreProblem = problemOf(await attempt(() => manager.installBundle(spec(plan.from), { saveExact: true })))
  record({
    outcome: 'failed',
    message:
      restoreProblem === undefined
        ? `${problem}。已经装回 ${plan.from}。`
        : `${problem}。装回 ${plan.from} 也没成：${restoreProblem}。在 dsh 的插件页重新装 ${plan.name} 就好，数据都还在。`,
  })
}
