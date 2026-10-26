#!/usr/bin/env node
/**
 * 给还没有 GitHub Release 的版本标签（v<版本>）建 Release：标题就是标签，正文是 CHANGELOG.md 里这个版本的一节，
 * 版本号最大的正式版标成 Latest。已经有 Release 的标签不动，重复跑也没事。
 * 推送后由 .github/workflows/release.yml 运行，用工作流自带的令牌（GH_TOKEN）；本机加 --dry 只打印要建哪些、正文是什么。
 *
 * 正文取 main 上最新的 CHANGELOG（origin/main，取不到就用工作区里的），旧版本的说明后来改过也按改过的发。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repo } from './version.mjs'

const TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
const dry = process.argv.includes('--dry')

const run = (command, args) => execFileSync(command, args, { cwd: repo, encoding: 'utf8' }).trim()

function changelog() {
  try {
    return run('git', ['show', 'origin/main:CHANGELOG.md'])
  } catch {
    const file = join(repo, 'CHANGELOG.md')
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  }
}

/** CHANGELOG 里「## <版本> - <日期>」那一节的正文，不含标题；没有这一节返回 undefined。 */
function section(text, version) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line === `## ${version}` || line.startsWith(`## ${version} `))
  if (start === -1) return undefined
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

/** 按版本号从小到大：0.1.10 排在 0.1.9 后面，预发布版排在同号正式版前面。 */
function byVersion(a, b) {
  for (const index of [1, 2, 3]) {
    const diff = Number(a.match[index]) - Number(b.match[index])
    if (diff !== 0) return diff
  }
  if (a.match[4] === b.match[4]) return 0
  if (a.match[4] === undefined) return 1
  if (b.match[4] === undefined) return -1
  return a.match[4].localeCompare(b.match[4], 'en', { numeric: true })
}

const tags = run('git', ['tag', '--list', 'v*'])
  .split('\n')
  .flatMap((name) => {
    const match = TAG.exec(name)
    return match === null ? [] : [{ name, version: name.slice(1), match, prerelease: match[4] !== undefined }]
  })
  .sort(byVersion)
const released = new Set(run('gh', ['release', 'list', '--limit', '1000', '--json', 'tagName', '--jq', '.[].tagName']).split('\n'))
const latest = tags.filter((tag) => !tag.prerelease).at(-1)?.name
const notesSource = changelog()
const pending = tags.filter((tag) => !released.has(tag.name)).map((tag) => ({ ...tag, notes: section(notesSource, tag.version) }))
const missing = pending.filter((tag) => tag.notes === undefined).map((tag) => tag.name)
const dir = mkdtempSync(join(tmpdir(), 'release-notes-'))
try {
  // 从旧到新建，最新的最后建，Latest 也明确指给它
  for (const tag of pending.filter((item) => item.notes !== undefined)) {
    const file = join(dir, `${tag.name}.md`)
    writeFileSync(file, `${tag.notes}\n`)
    const args = [
      'release', 'create', tag.name, '--title', tag.name, '--notes-file', file, '--verify-tag', `--latest=${tag.name === latest}`,
      ...(tag.prerelease ? ['--prerelease'] : []),
    ]
    if (dry) console.log(`gh ${args.join(' ')}\n${tag.notes}\n`)
    else console.log(run('gh', args))
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
if (missing.length > 0) {
  console.error(`CHANGELOG.md 里没有这些版本的一节，没建 Release：${missing.join('、')}`)
  process.exit(1)
}
