import { t } from 'pod-domain'
import type { DaemonResponse } from './daemon.ts'

/**
 * computer_use 工具的动作。只用后台模式：读一个应用窗口的辅助功能树和截图，按元素编号操作，
 * 不占用你的鼠标键盘，也不切换前台应用。
 */
export const COMPUTER_ACTIONS = ['help', 'list_apps', 'start', 'open_app', 'get_app_state', 'click', 'type_text', 'set_value', 'press_key', 'scroll', 'perform_secondary_action', 'drag', 'stop'] as const
export type ComputerAction = (typeof COMPUTER_ACTIONS)[number]

/** 要先 start（用户批准过）才能用的动作：都针对某个应用的窗口。 */
export const SESSION_ACTIONS: ReadonlySet<ComputerAction> = new Set(['get_app_state', 'click', 'type_text', 'set_value', 'press_key', 'scroll', 'perform_secondary_action', 'drag'])

export type Args = Readonly<Record<string, unknown>>

export interface DaemonCall {
  readonly name: string
  readonly payload: Readonly<Record<string, unknown>>
}

function integer(args: Args, key: string): number | undefined | 'bad' {
  const value = args[key]
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'string' ? Number(value.trim()) : value
  return typeof parsed === 'number' && Number.isInteger(parsed) ? parsed : 'bad'
}

function word(args: Args, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** 读几个整数参数：必填的缺了或者不是整数就返回错误。 */
function integers(args: Args, required: readonly string[], optional: readonly string[] = []): Readonly<Record<string, number>> | string {
  let picked: Readonly<Record<string, number>> = {}
  for (const key of [...required, ...optional]) {
    const value = integer(args, key)
    if (value === 'bad') return `${key} 要是整数`
    if (value === undefined) {
      if (required.includes(key)) return `要写 ${key}`
      continue
    }
    picked = { ...picked, [key]: value }
  }
  return picked
}

/** 把窗口动作的参数换成小助手的请求；参数不对返回原因。每个动作都要 get_app_state 给的 snapshot_id。 */
export function toDaemonCall(action: ComputerAction, args: Args): DaemonCall | string {
  if (action === 'get_app_state') {
    const app = word(args, 'app')
    if (app === '') return '要写 app（应用名或 bundle id）'
    const title = word(args, 'window_title')
    return { name: 'get_app_state', payload: { app, ...(title === '' ? {} : { window_title: title }) } }
  }
  const snapshot = word(args, 'snapshot_id')
  if (snapshot === '') return '要写 snapshot_id：先用 get_app_state 看窗口'
  const withSnapshot = (name: string, payload: Readonly<Record<string, unknown>> | string): DaemonCall | string => (typeof payload === 'string' ? payload : { name, payload: { snapshot_id: snapshot, ...payload } })
  switch (action) {
    case 'click':
      return withSnapshot('click', args.element_index !== undefined ? integers(args, ['element_index']) : integers(args, ['x', 'y']))
    case 'type_text': {
      // 要输入的文字原样给：空格和换行都算。
      const text = typeof args.text === 'string' ? args.text : ''
      if (text === '') return '要写 text'
      const index = integers(args, [], ['element_index'])
      return withSnapshot('type_text', typeof index === 'string' ? index : { ...index, text })
    }
    case 'set_value': {
      // 空字符串表示清空。
      if (typeof args.value !== 'string') return '要写 value（清空就写空字符串）'
      const index = integers(args, ['element_index'])
      return withSnapshot('set_value', typeof index === 'string' ? index : { ...index, value: args.value })
    }
    case 'press_key': {
      const key = word(args, 'key')
      return key === '' ? '要写 key，比如 return、cmd+a' : withSnapshot('press_key', { key })
    }
    case 'scroll': {
      const direction = word(args, 'direction')
      if (!['up', 'down', 'left', 'right'].includes(direction)) return 'direction 只能是 up、down、left、right'
      const numbers = integers(args, ['element_index'], ['pages'])
      return withSnapshot('scroll', typeof numbers === 'string' ? numbers : { ...numbers, direction })
    }
    case 'perform_secondary_action': {
      const name = word(args, 'action')
      if (name === '') return '要写 action（元素上列出的动作名）'
      const index = integers(args, ['element_index'])
      return withSnapshot('perform_secondary_action', typeof index === 'string' ? index : { ...index, action: name })
    }
    case 'drag':
      return withSnapshot('drag', integers(args, ['from_x', 'from_y', 'to_x', 'to_y']))
    default:
      return `${action} 不是窗口动作`
  }
}

/** bot 这一步做了什么：电脑面板画面下面那行字。bot 写了 thinking 就用它。 */
export function labelOf(action: ComputerAction, args: Args, thinking: string): string {
  const said = thinking.trim()
  if (said !== '') return said.length > 120 ? `${said.slice(0, 120)}…` : said
  const index = String(args.element_index ?? '')
  switch (action) {
    case 'get_app_state':
      return t('看「{app}」的窗口', { app: word(args, 'app') })
    case 'click':
      return index === '' ? t('点 ({x}, {y})', { x: String(args.x ?? ''), y: String(args.y ?? '') }) : t('点 #{index}', { index })
    case 'type_text':
      return t('输入文字')
    case 'set_value':
      return t('填写 #{index}', { index })
    case 'press_key':
      return t('按 {key}', { key: word(args, 'key') })
    case 'scroll':
      return t('滚动 #{index}', { index })
    case 'perform_secondary_action':
      return t('{action} #{index}', { action: word(args, 'action'), index })
    case 'drag':
      return t('拖动')
    default:
      return action
  }
}

// ---------- 不让 bot 碰的应用 ----------

type Kind = 'browser' | 'terminal' | 'system'

const BLOCKED: readonly (readonly [Kind, readonly string[]])[] = [
  [
    'browser',
    [
      'com.apple.safari',
      'com.google.chrome',
      'com.google.chrome.canary',
      'com.google.chrome.for.testing',
      'org.chromium.chromium',
      'org.mozilla.firefox',
      'com.microsoft.edgemac',
      'company.thebrowser.browser',
      'com.brave.browser',
      'com.operasoftware.opera',
      'com.vivaldi.vivaldi',
      'safari',
      'safari浏览器',
      'google chrome',
      'chrome',
      'google chrome for testing',
      'chromium',
      'firefox',
      'microsoft edge',
      'arc',
      'brave browser',
      'opera',
      'vivaldi',
    ],
  ],
  ['terminal', ['com.apple.terminal', 'com.googlecode.iterm2', 'dev.warp.warp-stable', 'com.mitchellh.ghostty', 'net.kovidgoyal.kitty', 'org.alacritty', 'com.github.wez.wezterm', 'terminal', '终端', 'iterm', 'iterm2', 'warp', 'ghostty', 'kitty', 'alacritty', 'wezterm']],
  [
    'system',
    [
      'com.apple.systempreferences',
      'com.apple.keychainaccess',
      'com.apple.passwords',
      'com.1password.1password',
      'com.bitwarden.desktop',
      'com.apple.scripteditor2',
      'com.apple.automator',
      'fun.onebot.dsh-bot.computer-use',
      'system settings',
      'system preferences',
      '系统设置',
      '系统偏好设置',
      'keychain access',
      '钥匙串访问',
      'passwords',
      '密码',
      '1password',
      'bitwarden',
      'script editor',
      '脚本编辑器',
      'automator',
      '自动操作',
      'dsh-bot computer use',
    ],
  ],
]

const REASONS: Readonly<Record<Kind, string>> = {
  browser: '网页用 browser_ 工具（dsh-bot 自己的浏览器，写操作有审批），不在用户的浏览器里点',
  terminal: '命令行用 shell 工具，不通过终端窗口打字',
  system: '系统设置、钥匙串、密码管理和脚本类应用不让 bot 碰，需要时请用户自己操作',
}

export function normalizeApp(app: string): string {
  return app.trim().toLowerCase()
}

/** 这些名字（应用名或 bundle id）里有不让碰的，返回原因。 */
export function blockedReason(names: readonly string[]): string | undefined {
  const keys = names.map(normalizeApp).filter((name) => name !== '')
  const hit = BLOCKED.find(([, list]) => keys.some((key) => list.includes(key)))
  return hit === undefined ? undefined : REASONS[hit[0]]
}

// ---------- 正在运行的应用 ----------

export interface RunningApp {
  readonly name: string
  readonly bundle: string
}

/** list_applications 的每一行是“名字 (bundle id)”，隐藏的后面带 [hidden]。 */
export function parseApps(text: string): readonly RunningApp[] {
  return text
    .split('\n')
    .map((line) => /^(.*) \(([^()]*)\)( \[hidden\])?$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ name: match[1] ?? '', bundle: match[2] ?? '' }))
}

// ---------- 结果 ----------

/** 窗口状态里的辅助功能树太长时截断（模型主要靠它干活，截图只给能看图的模型）。 */
const TEXT_LIMIT = 60_000

export function snapshotIdOf(text: string): string | undefined {
  return /Snapshot: ([^)\s]+)\)/.exec(text)?.[1]
}

/** 小助手的回答整理成给 bot 看的文字：提示、消息、权限、怎么修、窗口状态。 */
export function describeResponse(response: DaemonResponse, notices: readonly string[]): string {
  const missing = response.permissions === undefined ? [] : [...(response.permissions.accessibility ? [] : ['辅助功能']), ...(response.permissions.screenRecording ? [] : ['屏幕录制'])]
  const body = response.text?.trim() ?? ''
  const text = body.length > TEXT_LIMIT ? `${body.slice(0, TEXT_LIMIT)}\n…（太长，后面截断了；用 window_title 指定窗口，或滚动后再看）` : body
  return [
    ...notices,
    response.ok ? (response.message?.trim() ?? '') : (response.error?.trim() || response.message?.trim() || (response.interrupted === true ? '被打断了' : '没做成')),
    missing.length === 0
      ? ''
      : `小助手缺系统权限（${missing.join('、')}）：请用户到 设置 → 用电脑 按页面上的步骤授权，授权好再试。用户说系统设置里已经开了的，告诉用户那是旧版小助手的授权，要在系统设置里删掉再加回来`,
    response.instructions?.trim() ?? '',
    text,
  ]
    .filter((part) => part !== '')
    .join('\n\n')
}
