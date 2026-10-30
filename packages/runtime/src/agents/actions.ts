import { oneLine, t, truncate } from 'pod-domain'

/**
 * 把一次工具调用压成一句人话，给任务卡的“最近动作”、回答时的“正在……”和进度快照用。
 * 例：bash 用模型自己写的说明（“导出 10 月订单”），没写说明才是“运行命令：npm test”；web_fetch → “打开 b.com/pricing”。不调用模型。
 */

function parseArgs(raw: string): Readonly<Record<string, unknown>> {
  try {
    const value = JSON.parse(raw) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : {}
  } catch {
    return {}
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function host(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`
  } catch {
    return url
  }
}

function short(value: string, max = 48): string {
  return truncate(oneLine(value), max)
}

type Describe = (args: Readonly<Record<string, unknown>>) => string

/** 跑命令：dsh 要求模型每次附一句这条命令在做什么，有就用它，原始命令留给 commandOf。 */
const runCommand: Describe = (args) => (text(args.description).trim() === '' ? t('运行命令：{short}', { short: short(text(args.command)) }) : short(text(args.description)))

const DESCRIBERS: Readonly<Record<string, Describe>> = {
  bash: runCommand,
  pwsh: runCommand,
  read: (args) => t('读取 {short}', { short: short(text(args.path ?? args.file_path)) }),
  write: (args) => t('写入 {short}', { short: short(text(args.path ?? args.file_path)) }),
  edit: (args) => t('修改 {short}', { short: short(text(args.path ?? args.file_path)) }),
  glob: (args) => t('查找文件 {short}', { short: short(text(args.pattern)) }),
  grep: (args) => t('搜索文件内容“{short}”', { short: short(text(args.pattern), 24) }),
  web_search: (args) => t('搜索“{short}”', { short: short(text(args.query), 32) }),
  web_fetch: (args) => t('打开 {short}', { short: short(host(text(args.url))) }),
  skill: (args) => t('加载技能 {short}', { short: short(text(args.name)) }),
  todo_write: () => t('更新待办'),
  update_task: (args) => (Array.isArray(args.check) && args.check.length > 0 ? t('勾选验收项') : t('写进度说明')),
  complete_task: () => t('提交结果'),
  ask_owner: () => t('请你处理一件事'),
  ask_bot: (args) => t('咨询 {short}', { short: short(text(args.bot), 16) }),
  delegate: (args) => t('交给 {short}：{short2}', { short: short(text(args.bot), 16), short2: short(text(args.title), 24) }),
  create_task: () => t('提交团队计划'),
  create_bot: (args) => t('新建 bot {short}', { short: short(text(args.name), 16) }),
  find_bots: () => t('查找合适的 bot'),
  task_status: () => t('查看任务进度'),
  relay_to_task: () => t('转达给任务'),
  remember: () => t('写记忆'),
  recall: (args) => t('查记忆“{short}”', { short: short(text(args.query), 24) }),
  search_history: (args) => t('搜聊天记录“{short}”', { short: short(text(args.query), 24) }),
  browser_open: (args) => t('打开 {short}', { short: short(host(text(args.url))) }),
  browser_snapshot: () => t('读取页面快照'),
  browser_click: (args) => t('点击 {short}', { short: short(text(args.ref ?? args.element), 24) }),
  browser_type: () => t('在页面里输入'),
  browser_screenshot: () => t('截图'),
  browser_extract: () => t('提取正文'),
  browser_press: (args) => t('按 {short}', { short: short(text(args.key), 12) }),
  browser_select: (args) => t('选择“{short}”', { short: short(text(args.value), 20) }),
  browser_scroll: (args) => (text(args.direction) === 'up' ? t('向上滚动') : t('向下滚动')),
  browser_back: () => t('后退'),
  browser_tabs: () => t('查看标签页'),
  browser_upload: () => t('选择要上传的文件'),
  browser_dialog: (args) => (args.accept === true ? t('在对话框里点确定') : t('关闭对话框')),
  browser_handover: (args) => t('把标签页交给{short}', { short: short(text(args.to), 12) }),
  request_takeover: (args) => t('请你接管浏览器：{short}', { short: short(text(args.reason), 24) }),
  review_task: (args) => (args.pass === false ? t('打回子任务') : t('验收子任务')),
  deliver_task: () => t('交付'),
  create_routine: (args) => t('建例程「{short}」', { short: short(text(args.title), 20) }),
  update_routine: (args) => (args.enabled === false ? t('暂停例程') : args.enabled === true ? t('恢复例程') : t('改例程')),
  list_routines: () => t('查看例程'),
  delete_routine: () => t('删除例程'),
  watch_page: (args) => t('盯网页 {short}', { short: short(host(text(args.url))) }),
}

/** 跑命令的工具调用里的原始命令（一行、截短），给进度里“当前这一步”下面那行小字；别的工具没有。 */
export function commandOf(name: string, rawArgs: string): string | undefined {
  if (name !== 'bash' && name !== 'pwsh') return undefined
  const command = text(parseArgs(rawArgs).command)
  return command.trim() === '' ? undefined : short(command, 120)
}

export function describeToolCall(name: string, rawArgs: string): string {
  const describe = DESCRIBERS[name]
  const args = parseArgs(rawArgs)
  if (describe !== undefined) {
    const line = describe(args)
    return line.endsWith('：') || line.endsWith(' ') ? t('调用 {name}', { name }) : line
  }
  return t('调用 {name}', { name })
}

/** 读过网页或外部内容的工具：用过它们的会话标为受污染。 */
export const TAINTING_TOOLS: ReadonlySet<string> = new Set([
  'web_fetch',
  'web_search',
  'browser_open',
  'browser_snapshot',
  'browser_extract',
  'browser_screenshot',
  // X 上读回来的推文、私信也是外部内容
  'x_filter_response',
  'x_chats',
  'x_chat',
])
