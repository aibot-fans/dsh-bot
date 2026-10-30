/**
 * 一个版本的更新说明，GitHub Release 的正文和 npm 包里的更新说明（package.json 的 releaseNotes）都用它。
 * 这个版本标签上的发版提交（release(...): <版本>）写了正文就用正文；没写就把上一个版本标签到这个标签之间
 * feat、fix、perf 提交的标题列成新功能、修复、性能三节，别的类型（docs、test、refactor、ci、chore、release 这些）不列。
 * 末尾都附上两个标签在 GitHub 上的对比。正式版从上一个正式版算起，预发布版从上一个标签算起。还没有这个版本的标签时返回 undefined。
 *
 * 直接运行（node scripts/release-notes.mjs）打印最新的正式版标签以来按提交标题列的草稿，改好后写进发版提交的正文。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { repo } from './version.mjs'

const TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
const SUBJECT = /^([a-z]+)(?:\([^)]*\))?!?:\s*(.+)$/
const RELEASE = /^release(?:\([^)]*\))?!?:/
const SECTIONS = [
  ['feat', '新功能'],
  ['fix', '修复'],
  ['perf', '性能'],
]

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

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

/** 仓库里的版本标签，从旧到新。 */
export function versionTags() {
  return git('tag', '--list', 'v*')
    .split('\n')
    .flatMap((name) => {
      const match = TAG.exec(name)
      return match === null ? [] : [{ name, version: name.slice(1), match, prerelease: match[4] !== undefined }]
    })
    .sort(byVersion)
}

/** package.json 里的仓库地址，去掉 git+ 和 .git。 */
function repositoryUrl() {
  const { repository } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  const url = typeof repository === 'string' ? repository : (repository?.url ?? '')
  return url.replace(/^git\+/, '').replace(/\.git$/, '')
}

/** 一段提交里 feat、fix、perf 的标题，分成三节。 */
function fromCommits(range) {
  const subjects = git('log', '--no-merges', '--format=%s', range)
    .split('\n')
    .flatMap((subject) => {
      const match = SUBJECT.exec(subject)
      return match === null ? [] : [{ type: match[1], text: match[2] }]
    })
  return SECTIONS.flatMap(([type, title]) => {
    const items = subjects.filter((subject) => subject.type === type).map((subject) => `- ${subject.text}`)
    return items.length === 0 ? [] : [`### ${title}\n\n${items.join('\n')}`]
  }).join('\n\n')
}

/** 标签上的发版提交写的正文；不是发版提交或者没写正文时是空的。 */
function written(tag) {
  return RELEASE.test(git('log', '-1', '--format=%s', tag)) ? git('log', '-1', '--format=%b', tag) : ''
}

export function releaseNotes(version) {
  const tags = versionTags()
  const index = tags.findIndex((tag) => tag.version === version)
  if (index === -1) return undefined
  const tag = tags[index]
  const previous = tags
    .slice(0, index)
    .filter((item) => tag.prerelease || !item.prerelease)
    .at(-1)
  const body = written(tag.name) || fromCommits(previous === undefined ? tag.name : `${previous.name}..${tag.name}`)
  const compare = previous === undefined ? [] : [`完整改动：[${previous.name}...${tag.name}](${repositoryUrl()}/compare/${previous.name}...${tag.name})`]
  return [body, ...compare].filter((part) => part !== '').join('\n\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const latest = versionTags()
    .filter((tag) => !tag.prerelease)
    .at(-1)
  console.log(fromCommits(latest === undefined ? 'HEAD' : `${latest.name}..HEAD`))
}
