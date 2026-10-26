/**
 * 版本号的读法，set-version.mjs 和 pack-npm.mjs 共用。
 * 源头是 POD_VERSION（packages/domain/src/version.ts）；各包 package.json 的 version 跟着它，npm 包的版本也取它。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const VERSION_FILE = 'packages/domain/src/version.ts'

const POD_VERSION = /export const POD_VERSION = '([^']+)'/

/** 工作区里各包的 package.json，相对仓库的路径。 */
export function packageFiles() {
  return readdirSync(join(repo, 'packages'))
    .map((name) => `packages/${name}/package.json`)
    .filter((path) => existsSync(join(repo, path)))
    .sort()
}

export function podVersion() {
  const match = POD_VERSION.exec(readFileSync(join(repo, VERSION_FILE), 'utf8'))
  if (match === null) throw new Error(`${VERSION_FILE} 里找不到 POD_VERSION`)
  return match[1]
}

/** 版本号和 version 对不上的包：[路径, 它写的版本]。 */
export function mismatchedPackages(version) {
  return packageFiles().flatMap((path) => {
    const own = JSON.parse(readFileSync(join(repo, path), 'utf8')).version
    return own === version ? [] : [[path, own]]
  })
}
