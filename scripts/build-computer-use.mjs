#!/usr/bin/env node
/**
 * 编用电脑的小助手：vendor/comma-computer-use 里 Comma 的源码（AGPL-3.0，原样），用它自带的打包脚本编成
 * packages/runtime/assets/computer-use/dsh-bot Computer Use.app（本机临时签名），旁边放上它的许可和源码在哪；
 * 打 npm 包时跟着 runtime/assets 一起发，装上 dsh-bot 就有，不用另外装。
 * 只能在 macOS 上编，要 Xcode 命令行工具。命令行工具里新版 SDK 缺 SwiftUI 的宏插件时，换旧一点的 SDK 再编。
 *
 * 每重编一次签名就变，用户在系统设置里给过的授权就对不上了（要删掉那一项重新加）。所以编好后在旁边记下源码的指纹，
 * 源码和编译参数没变时直接沿用编好的应用，各版本带的是同一份；要重编（比如换了编译器）加 --force。
 * 从别的目录拷来编好的应用时连同指纹文件一起拷；确认它就是用现在的源码编的、只是没有指纹文件，加 --adopt 只补指纹。
 */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { repo } from './version.mjs'

const VENDOR = join(repo, 'vendor/comma-computer-use')
const OUT = join(repo, 'packages/runtime/assets/computer-use')
const APP = join(OUT, 'dsh-bot Computer Use.app')
const STAMP = join(OUT, 'source.sha256')
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

/** 源码的指纹：编译参数，加上 vendor/comma-computer-use 里每个文件的路径和内容（编译目录和 Finder 的 .DS_Store 不算）。 */
function fingerprint() {
  const hash = createHash('sha256').update(JSON.stringify({ configuration: 'release', bundleId: BUNDLE_ID, displayName: DISPLAY_NAME }))
  const walk = (dir, prefix) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (['.build', '.swiftpm', '.DS_Store'].includes(entry.name)) continue
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(join(dir, entry.name), relative)
      else if (entry.isFile()) hash.update(`\0${relative}\0`).update(readFileSync(join(dir, entry.name)))
    }
  }
  walk(VENDOR, '')
  return hash.digest('hex')
}

function readStamp() {
  return existsSync(STAMP) ? readFileSync(STAMP, 'utf8').trim() : ''
}

function writeNotes(source) {
  copyFileSync(join(VENDOR, 'LICENSE'), join(OUT, 'LICENSE'))
  writeFileSync(join(OUT, 'README.txt'), NOTE)
  writeFileSync(STAMP, `${source}\n`)
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

const source = fingerprint()
const existing = existsSync(join(APP, 'Contents/MacOS/CommaComputerUseDaemon'))
if (process.argv.includes('--adopt')) {
  if (!existing) stop(`还没有编好的小助手：${APP}`)
  writeNotes(source)
  console.log(`记下了源码指纹，以后源码没变就沿用：${APP}`)
  process.exit(0)
}
if (existing && readStamp() === source && !process.argv.includes('--force')) {
  writeNotes(source)
  console.log(`小助手的源码没变，沿用编好的（要重编加 --force）：${APP}`)
  process.exit(0)
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
writeNotes(source)
console.log(`编好了：${APP}`)
