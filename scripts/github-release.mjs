#!/usr/bin/env node
/**
 * 按 CHANGELOG.md 建和更新版本标签（v<版本>）的 GitHub Release：没有 Release 的标签建一个，标题就是标签，
 * 正文是 CHANGELOG 里这个版本的一节，版本号最大的正式版标成 Latest；已有的 Release 正文和那一节不一样时改成那一节
 * （在网页上手改的正文会被覆盖），标题和 Latest 不动。重复跑也没事。
 * 推送后由 .github/workflows/release.yml 运行，用工作流自带的令牌（GH_TOKEN）。
 *
 * 正文取 main 上最新的 CHANGELOG（origin/main，取不到就用工作区里的），旧版本的说明后来改过也按改过的发。
 * 本机加 --dry 只打印要建、要改哪些，正文按工作区里的 CHANGELOG，推送前用来预览。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changelogSection } from './changelog.mjs'
import { repo } from './version.mjs'

const TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
const dry = process.argv.includes('--dry')

const run = (command, args) => execFileSync(command, args, { cwd: repo, encoding: 'utf8' }).trim()

function localChangelog() {
  const file = join(repo, 'CHANGELOG.md')
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

function changelog() {
  try {
    return run('git', ['show', 'origin/main:CHANGELOG.md'])
  } catch {
    return localChangelog()
  }
}

/** 已有的 Release：标签 → 正文（换行统一成 \n，去掉首尾空白，方便和 CHANGELOG 比）。 */
function releases() {
  return new Map(
    run('gh', ['api', '--paginate', 'repos/{owner}/{repo}/releases', '--jq', '.[] | [.tag_name, .body] | @json'])
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line))
      .map(([tag, body]) => [tag, (body ?? '').replaceAll('\r\n', '\n').trim()]),
  )
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

const notesSource = dry ? localChangelog() : changelog()
const tags = run('git', ['tag', '--list', 'v*'])
  .split('\n')
  .flatMap((name) => {
    const match = TAG.exec(name)
    return match === null ? [] : [{ name, version: name.slice(1), match, prerelease: match[4] !== undefined }]
  })
  .sort(byVersion)
  .map((tag) => ({ ...tag, notes: changelogSection(notesSource, tag.version) }))
const existing = releases()
const latest = tags.filter((tag) => !tag.prerelease).at(-1)?.name
const missing = tags.filter((tag) => !existing.has(tag.name) && tag.notes === undefined).map((tag) => tag.name)
const dir = mkdtempSync(join(tmpdir(), 'release-notes-'))
try {
  // 从旧到新处理，最新的最后建，Latest 也明确指给它
  for (const tag of tags.filter((item) => item.notes !== undefined && existing.get(item.name) !== item.notes)) {
    const file = join(dir, `${tag.name}.md`)
    writeFileSync(file, `${tag.notes}\n`)
    const args = existing.has(tag.name)
      ? ['release', 'edit', tag.name, '--notes-file', file]
      : [
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
