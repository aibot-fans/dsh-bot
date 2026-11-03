#!/usr/bin/env node
/**
 * 编用电脑的小助手：vendor/comma-computer-use 里 Comma 的源码（AGPL-3.0，原样），用它自带的打包脚本编成
 * packages/runtime/assets/computer-use/dsh-bot Computer Use.app（本机临时签名），旁边放上它的许可和源码在哪；
 * 打 npm 包时跟着 runtime/assets 一起发，装上 dsh-bot 就有，不用另外装。
 * 只能在 macOS 上编，要 Xcode 命令行工具。命令行工具里新版 SDK 缺 SwiftUI 的宏插件时，换旧一点的 SDK 再编。
 */
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { repo } from './version.mjs'

const VENDOR = join(repo, 'vendor/comma-computer-use')
const OUT = join(repo, 'packages/runtime/assets/computer-use')
const APP = join(OUT, 'dsh-bot Computer Use.app')
const BUNDLE_ID = 'fun.onebot.dsh-bot.computer-use'
const DISPLAY_NAME = 'dsh-bot Computer Use'
const MACRO_PROBLEM = /plugin for module '\w+' not found|external macro implementation/

const NOTE = `dsh-bot Computer Use.app 是用 Comma（https://github.com/AFK-surf/Comma，提交 66ab3dc92475005aea9afd123df36a28e4ef86ab）
的源码原样编成的，按 GNU Affero General Public License v3.0 授权，全文见同目录的 LICENSE。
对应的源码在 dsh-bot 仓库（https://github.com/aibot-fans/dsh-bot）同一版本标签下的 vendor/comma-computer-use/。

dsh-bot Computer Use.app is built unmodified from the source of Comma (https://github.com/AFK-surf/Comma,
commit 66ab3dc92475005aea9afd123df36a28e4ef86ab) and is licensed under the GNU Affero General Public License v3.0
(see LICENSE next to it). The corresponding source is in vendor/comma-computer-use/ of the dsh-bot repository
(https://github.com/aibot-fans/dsh-bot) at the same version tag.
`

function stop(message) {
  console.error(message)
  process.exit(1)
}

/** 先试默认的 SDK；装的只是命令行工具时，再从新到旧试带版本号的 SDK（跳过默认的那个）。 */
function sdkCandidates() {
  const developer = execFileSync('xcode-select', ['-p'], { encoding: 'utf8' }).trim()
  if (developer.includes('.app/')) return [undefined]
  const dir = join(developer, 'SDKs')
  if (!existsSync(dir)) return [undefined]
  const resolved = realpathSync(execFileSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim())
  const versioned = readdirSync(dir)
    .map((name) => ({ name, match: /^MacOSX(\d+)\.(\d+)\.sdk$/.exec(name) }))
    .filter((entry) => entry.match !== null)
    .sort((a, b) => Number(b.match[1]) - Number(a.match[1]) || Number(b.match[2]) - Number(a.match[2]))
    .map((entry) => join(dir, entry.name))
    .filter((path) => realpathSync(path) !== resolved)
  return [undefined, ...versioned].slice(0, 3)
}

/** 跑打包脚本，输出照常打出来，同时留一份看是不是宏插件的问题。 */
function build(sdk) {
  const script = join(VENDOR, 'scripts/package-computer-use-helper.sh')
  const args = [script, '--configuration', 'release', '--app-path', APP, '--bundle-id', BUNDLE_ID, '--display-name', DISPLAY_NAME]
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', args, { cwd: VENDOR, env: { ...process.env, ...(sdk === undefined ? {} : { SDKROOT: sdk }) }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
      process.stderr.write(chunk)
    })
    child.on('close', (code) => resolve({ code, output }))
  })
}

if (process.platform !== 'darwin') stop('用电脑的小助手只能在 macOS 上编。')
try {
  execFileSync('xcrun', ['--find', 'swift'], { stdio: 'ignore' })
} catch {
  stop('找不到 Swift 编译器：先装 Xcode 命令行工具（xcode-select --install）。')
}
mkdirSync(OUT, { recursive: true })
let built = false
for (const sdk of sdkCandidates()) {
  console.log(sdk === undefined ? '用默认的 SDK 编译用电脑的小助手' : `换 ${sdk} 再编`)
  const { code, output } = await build(sdk)
  if (code === 0) {
    built = true
    break
  }
  if (!MACRO_PROBLEM.test(output)) break
}
if (!built) stop('用电脑的小助手没编出来，原因见上面的输出。')
copyFileSync(join(VENDOR, 'LICENSE'), join(OUT, 'LICENSE'))
writeFileSync(join(OUT, 'README.txt'), NOTE)
console.log(`编好了：${APP}`)
