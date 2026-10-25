import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { HostContext } from '../dsh.ts'

/** Pod 写在组合包 engines.dsh 里的兼容范围；这里只用来提示。 */
export const SUPPORTED_DSH = '>=0.2.1-rc.2 <0.3.0'

export interface CompatReport {
  readonly dshVersion: string
  /** 缺了就进入只读模式的接口。 */
  readonly problems: readonly string[]
  /** 缺了只影响个别功能的接口。 */
  readonly degraded: readonly string[]
  readonly readOnly: boolean
}

/** 从启动脚本的真实路径往上找 @deepseek-ai/dsh 的 package.json，读出版本号。 */
export function detectDshVersion(argv: readonly string[] = process.argv): string {
  const entry = argv[1]
  if (entry === undefined) return 'unknown'
  try {
    let dir = dirname(realpathSync(entry))
    for (let depth = 0; depth < 6; depth += 1) {
      const manifest = join(dir, 'package.json')
      if (existsSync(manifest)) {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { readonly name?: string; readonly version?: string }
        if (parsed.name === '@deepseek-ai/dsh' && typeof parsed.version === 'string') return parsed.version
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {
    // 读不到就当未知。
  }
  return 'unknown'
}

function isFunction(value: unknown): boolean {
  return typeof value === 'function'
}

function probe(read: () => unknown): boolean {
  try {
    return isFunction(read())
  } catch {
    return false
  }
}

/**
 * 启动时检查用到的 dsh 接口还在不在。核心接口缺了就进入只读模式：
 * 页面照常能看，但不再创建会话、不再派活，避免在不兼容的 dsh 上写出半截数据。
 */
export function checkCompat(ctx: HostContext): CompatReport {
  const required: readonly (readonly [string, () => unknown])[] = [
    ['connection.fetch.register', () => ctx.connection.fetch.register],
    ['sessionController.create', () => ctx.sessionController.create],
    ['sessionController.resolveAgent', () => ctx.sessionController.resolveAgent],
    ['workspaceRegistry.create', () => ctx.workspaceRegistry.create],
    ['agents.get', () => ctx.agents.get],
    ['agents.list', () => ctx.agents.list],
    ['on', () => ctx.on],
  ]
  const optional: readonly (readonly [string, () => unknown])[] = [
    ['llm.prepareCall', () => (ctx.get('llm') as { prepareCall?: unknown } | undefined)?.prepareCall],
    ['sessionController.selectModel', () => ctx.sessionController.selectModel],
    ['sessionController.rename', () => ctx.sessionController.rename],
    ['sessionController.modelCatalog', () => ctx.sessionController.modelCatalog],
  ]
  const problems = required.filter(([, read]) => !probe(read)).map(([label]) => label)
  const degraded = optional.filter(([, read]) => !probe(read)).map(([label]) => label)
  return { dshVersion: detectDshVersion(), problems, degraded, readOnly: problems.length > 0 }
}
