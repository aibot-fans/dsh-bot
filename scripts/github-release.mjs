#!/usr/bin/env node
/**
 * 给还没有 GitHub Release 的版本标签（v<版本>）建一个：标题就是标签，正文是 release-notes.mjs 从提交生成的更新说明，
 * 版本号最大的正式版标成 Latest。已有的 Release 不动，在网页上改过的正文也留着。重复跑也没事。
 * 推送标签后由 .github/workflows/release.yml 运行，用工作流自带的令牌（GH_TOKEN）。
 * 本机加 --dry 只打印要建哪些和正文，打好标签、推送前用来预览。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { releaseNotes, versionTags } from './release-notes.mjs'
import { repo } from './version.mjs'

const dry = process.argv.includes('--dry')

const run = (command, args) => execFileSync(command, args, { cwd: repo, encoding: 'utf8' }).trim()

/** 已经有 Release 的标签。 */
function released() {
  return new Set(
    run('gh', ['api', '--paginate', 'repos/{owner}/{repo}/releases', '--jq', '.[].tag_name'])
      .split('\n')
      .filter((line) => line !== ''),
  )
}

const tags = versionTags()
const existing = released()
const latest = tags.filter((tag) => !tag.prerelease).at(-1)?.name
const dir = mkdtempSync(join(tmpdir(), 'release-notes-'))
try {
  // 从旧到新建，最新的最后建，Latest 也明确指给它
  for (const tag of tags.filter((item) => !existing.has(item.name))) {
    const notes = releaseNotes(tag.version)
    const file = join(dir, `${tag.name}.md`)
    writeFileSync(file, `${notes}\n`)
    const args = [
      'release', 'create', tag.name, '--title', tag.name, '--notes-file', file, '--verify-tag', `--latest=${tag.name === latest}`,
      ...(tag.prerelease ? ['--prerelease'] : []),
    ]
    if (dry) console.log(`gh ${args.join(' ')}\n${notes}\n`)
    else console.log(run('gh', args))
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
