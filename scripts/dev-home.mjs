#!/usr/bin/env node
/**
 * 开发用：在独立的 DSH_HOME 里跑一份 dsh web，装上本仓库的 Pod。
 * 不碰 ~/.dsh，也不占用平时的 3080 端口。
 *
 *   node scripts/dev-home.mjs install   把 packages/bundle 和开发用的脚本化模型（dev/mock-llm）以 link: 装进开发 home 的 web profile
 *   node scripts/dev-home.mjs web       用开发 home 启动 dsh web
 *
 * 环境变量：POD_DEV_ROOT 是开发目录（默认 <仓库>/.dev），POD_DEV_PORT 是端口（默认 3190）。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const devRoot = resolve(process.env.POD_DEV_ROOT ?? join(repo, '.dev'))
const dshHome = join(devRoot, 'dsh-home')
const port = process.env.POD_DEV_PORT ?? '3190'
const env = { ...process.env, DSH_HOME: dshHome }

function dsh(args) {
  return new Promise((done, failed) => {
    const child = spawn('dsh', args, { env, stdio: 'inherit' })
    child.on('error', failed)
    child.on('exit', (code) => (code === 0 ? done() : failed(new Error(`dsh ${args.join(' ')} 退出码 ${code}`))))
  })
}

/** 开发覆盖层：Pod 的数据库和 bot 工作目录都放进开发目录。 */
function writeDevPatch() {
  const file = join(devRoot, 'pod-dev.patch.yml')
  const lines = [
    '# 由 scripts/dev-home.mjs 生成：开发时 dsh-bot 的数据和工作区都在这个目录里。',
    '- id: pod-runtime',
    '  config:',
    `    dataRoot: ${JSON.stringify(join(dshHome, 'pod'))}`,
    `    workspaceRoot: ${JSON.stringify(join(devRoot, 'pod-workspace'))}`,
    '',
  ]
  writeFileSync(file, lines.join('\n'))
  return file
}

const commands = {
  async install() {
    mkdirSync(dshHome, { recursive: true })
    await dsh(['plugin', '--profile', 'web', 'add', `link:${join(repo, 'packages', 'bundle')}`])
    // 脚本化模型只装进开发环境：没有模型账号时也能跑通委派和任务流程。
    await dsh(['plugin', '--profile', 'web', 'add', `link:${join(repo, 'dev', 'mock-llm')}`])
  },
  async web() {
    mkdirSync(devRoot, { recursive: true })
    // --patch 是启动器的选项，必须在 web 自己的参数之前。
    await dsh(['--profile', 'web', '--patch', writeDevPatch(), '--no-open', '--port', port])
  },
}

const command = commands[process.argv[2] ?? '']
if (command === undefined) {
  console.error('用法：node scripts/dev-home.mjs <install|web>')
  process.exit(1)
}
await command()
