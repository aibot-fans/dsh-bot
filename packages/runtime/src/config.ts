import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export interface PodConfig {
  /** 数据库所在目录，默认 $DSH_HOME/pod。 */
  readonly dataRoot: string
  /** bot 会话的工作目录根，默认 ~/Pod。 */
  readonly workspaceRoot: string
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function expandHome(path: string, home: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return join(home, path.slice(2))
  return isAbsolute(path) ? path : resolve(path)
}

/**
 * 读插件配置。组合包里会用 dshHomePath('pod') 传入 dataRoot；单独挂载时走这里的默认值。
 * @param raw - Loader 交给 apply 的配置，可能为空。
 * @param env - 读取 DSH_HOME 的环境变量表。
 */
export function resolveConfig(raw: unknown, env: NodeJS.ProcessEnv = process.env): PodConfig {
  const record = typeof raw === 'object' && raw !== null ? (raw as Readonly<Record<string, unknown>>) : {}
  const home = homedir()
  const dshHome = expandHome(nonEmpty(env.DSH_HOME) ?? join(home, '.dsh'), home)
  return {
    dataRoot: expandHome(nonEmpty(record.dataRoot) ?? join(dshHome, 'pod'), home),
    workspaceRoot: expandHome(nonEmpty(record.workspaceRoot) ?? join(home, 'Pod'), home),
  }
}
