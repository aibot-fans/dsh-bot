#!/usr/bin/env node
/**
 * 改版本号：pnpm version:set <版本>，比如 pnpm version:set 0.1.1。
 * 改 POD_VERSION 和各包 package.json 的 version，别的不动。发版的其余步骤见 docs/DEVELOPMENT.md。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { VERSION_FILE, packageFiles, repo } from './version.mjs'

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** 只换一处；找不到就停下，说明文件换了写法，这里要跟着改。 */
function replaceOnce(path, pattern, replacement) {
  const file = join(repo, path)
  const text = readFileSync(file, 'utf8')
  if (!pattern.test(text)) throw new Error(`${path} 里找不到版本号`)
  writeFileSync(file, text.replace(pattern, replacement))
}

const version = process.argv[2] ?? ''
if (!SEMVER.test(version)) {
  console.error('用法：pnpm version:set <版本>，比如 pnpm version:set 0.1.1')
  process.exit(1)
}
replaceOnce(VERSION_FILE, /export const POD_VERSION = '[^']+'/, `export const POD_VERSION = '${version}'`)
// package.json 只改 version 那一行，格式原样保留。
for (const path of packageFiles()) replaceOnce(path, /^(\s*"version": )"[^"]*"/m, `$1"${version}"`)
console.log(`版本号改成了 ${version}：${[VERSION_FILE, ...packageFiles()].join('、')}`)
