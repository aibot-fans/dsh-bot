#!/usr/bin/env node
/**
 * 打 npm 包：把构建好的宿主插件、浏览器插件和组合包拼成一个包 @aibot_fans/dsh-bot，输出 dist/aibot_fans-dsh-bot-<版本>.tgz。
 * 先跑 pnpm build（pnpm pack:npm 会先构建）。
 *
 * 开发时是三个包（pod-runtime、pod-ui、pod-bundle），发出去合成一个，不带任何依赖：
 *   @aibot_fans/dsh-bot          浏览器插件那一行：dsh 只按精确的包名找 ./client，宿主半边什么都不做
 *   @aibot_fans/dsh-bot/runtime  宿主插件
 *   @aibot_fans/dsh-bot/agent    agent 预设里的 pod-agent
 * 各行的 id 不变，profile 里按 id 写的覆盖照样生效。
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = '@aibot_fans/dsh-bot'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(repo, 'dist')
const out = join(dist, NAME)

const read = (path) => readFileSync(join(repo, path), 'utf8')
const readJson = (path) => JSON.parse(read(path))

/** 版本号只有一处：POD_VERSION。 */
function podVersion() {
  const match = /export const POD_VERSION = '([^']+)'/.exec(read('packages/domain/src/version.ts'))
  if (match === null) throw new Error('packages/domain/src/version.ts 里找不到 POD_VERSION')
  return match[1]
}

/** 原样替换；次数对不上就停下，说明组合包或构建产物换了写法，这里要跟着改。 */
function replaceExactly(text, [from, to, times], what) {
  const parts = text.split(from)
  if (parts.length - 1 !== times) throw new Error(`${what}：${JSON.stringify(from)} 出现 ${parts.length - 1} 次，应为 ${times} 次`)
  return parts.join(to)
}

const PATCH_NAMES = [
  ['# 安装：dsh plugin --profile web add link:<仓库>/packages/bundle\n', `# 安装：dsh plugin --profile web add ${NAME}\n`, 1],
  ["name: 'pod-runtime'\n", `name: '${NAME}/runtime'\n`, 1],
  ["name: 'pod-ui'\n", `name: '${NAME}'\n`, 1],
  ["name: 'pod-runtime/agent'\n", `name: '${NAME}/agent'\n`, 3],
]

function patch() {
  return PATCH_NAMES.reduce((text, rule) => replaceExactly(text, rule, 'cordis.patch.yml'), read('packages/bundle/cordis.patch.yml'))
}

/** 浏览器模块的身份必须等于包名。 */
function client() {
  const rule = ['window.__ModuleLoader__.load({\n\tid: "pod-ui",', `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(NAME)},`, 1]
  const text = read('packages/ui/lib/client.js')
  if (!text.startsWith(rule[0])) throw new Error('packages/ui/lib/client.js 的开头不是预期的模块注册，先跑 pnpm build')
  return replaceExactly(text, rule, 'packages/ui/lib/client.js')
}

function manifest(version) {
  const root = readJson('package.json')
  const bundle = readJson('packages/bundle/package.json')
  const ui = readJson('packages/ui/package.json')
  return {
    name: NAME,
    version,
    description: root.description,
    keywords: ['dsh', 'dsh-bot', 'dsh-plugin', 'deepseek', 'deepseek-harness', 'multi-agent', 'agents'],
    license: 'Apache-2.0',
    ...(root.repository === undefined ? {} : { repository: root.repository, homepage: root.homepage, bugs: root.bugs }),
    type: 'module',
    icon: bundle.icon,
    main: './ui/index.js',
    exports: {
      '.': './ui/index.js',
      './client': './ui/client.js',
      './runtime': './runtime/lib/index.js',
      './agent': './runtime/lib/agent.js',
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json',
    },
    files: ['ui', 'runtime', 'cordis.patch.yml', 'icon.svg', 'NOTICE'],
    // 带作用域的包默认私有，发成公开的。
    publishConfig: { access: 'public' },
    engines: bundle.engines,
    dsh: { ...bundle.dsh, client: ui.dsh.client },
  }
}

const version = podVersion()
rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'ui'), { recursive: true })
cpSync(join(repo, 'packages/runtime/lib'), join(out, 'runtime/lib'), { recursive: true })
cpSync(join(repo, 'packages/runtime/assets'), join(out, 'runtime/assets'), { recursive: true })
cpSync(join(repo, 'packages/ui/lib/index.js'), join(out, 'ui/index.js'))
writeFileSync(join(out, 'ui/client.js'), client())
writeFileSync(join(out, 'cordis.patch.yml'), patch())
cpSync(join(repo, 'packages/bundle/icon.svg'), join(out, 'icon.svg'))
for (const file of ['README.md', 'LICENSE', 'NOTICE']) cpSync(join(repo, file), join(out, file))
writeFileSync(join(out, 'package.json'), `${JSON.stringify(manifest(version), null, 2)}\n`)
execFileSync('npm', ['pack', '--pack-destination', dist], { cwd: out, stdio: 'inherit' })
