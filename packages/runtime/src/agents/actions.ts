import { oneLine, truncate } from 'pod-domain'

/**
 * 把一次工具调用压成一句人话，给任务卡的“最近动作”和进度快照用。
 * 例：bash → “运行命令：npm test”，web_fetch → “打开 b.com/pricing”。不调用模型。
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

const DESCRIBERS: Readonly<Record<string, Describe>> = {
  bash: (args) => `运行命令：${short(text(args.command))}`,
  pwsh: (args) => `运行命令：${short(text(args.command))}`,
  read: (args) => `读取 ${short(text(args.path ?? args.file_path))}`,
  write: (args) => `写入 ${short(text(args.path ?? args.file_path))}`,
  edit: (args) => `修改 ${short(text(args.path ?? args.file_path))}`,
  glob: (args) => `查找文件 ${short(text(args.pattern))}`,
  grep: (args) => `搜索文件内容“${short(text(args.pattern), 24)}”`,
  web_search: (args) => `搜索“${short(text(args.query), 32)}”`,
  web_fetch: (args) => `打开 ${short(host(text(args.url)))}`,
  skill: (args) => `加载技能 ${short(text(args.name))}`,
  todo_write: () => '更新待办',
  update_task: (args) => (Array.isArray(args.check) && args.check.length > 0 ? '勾选验收项' : '写进度说明'),
  complete_task: () => '提交结果',
  ask_owner: () => '请你处理一件事',
  ask_bot: (args) => `咨询 ${short(text(args.bot), 16)}`,
  delegate: (args) => `交给 ${short(text(args.bot), 16)}：${short(text(args.title), 24)}`,
  create_task: () => '提交团队计划',
  create_bot: (args) => `新建 bot ${short(text(args.name), 16)}`,
  find_bots: () => '查找合适的 bot',
  task_status: () => '查看任务进度',
  relay_to_task: () => '转达给任务',
  remember: () => '写记忆',
  recall: (args) => `查记忆“${short(text(args.query), 24)}”`,
  search_history: (args) => `搜聊天记录“${short(text(args.query), 24)}”`,
  browser_open: (args) => `打开 ${short(host(text(args.url)))}`,
  browser_snapshot: () => '读取页面快照',
  browser_click: (args) => `点击 ${short(text(args.ref ?? args.element), 24)}`,
  browser_type: () => '在页面里输入',
  browser_screenshot: () => '截图',
  browser_extract: () => '提取正文',
  browser_press: (args) => `按 ${short(text(args.key), 12)}`,
  browser_select: (args) => `选择“${short(text(args.value), 20)}”`,
  browser_scroll: (args) => (text(args.direction) === 'up' ? '向上滚动' : '向下滚动'),
  browser_back: () => '后退',
  browser_tabs: () => '查看标签页',
  browser_upload: () => '选择要上传的文件',
  browser_dialog: (args) => (args.accept === true ? '在对话框里点确定' : '关闭对话框'),
  browser_handover: (args) => `把标签页交给${short(text(args.to), 12)}`,
  request_takeover: (args) => `请你接管浏览器：${short(text(args.reason), 24)}`,
  review_task: (args) => (args.pass === false ? '打回子任务' : '验收子任务'),
  deliver_task: () => '交付',
  create_routine: (args) => `建例程「${short(text(args.title), 20)}」`,
  update_routine: (args) => (args.enabled === false ? '暂停例程' : args.enabled === true ? '恢复例程' : '改例程'),
  list_routines: () => '查看例程',
  delete_routine: () => '删除例程',
  watch_page: (args) => `盯网页 ${short(host(text(args.url)))}`,
}

export function describeToolCall(name: string, rawArgs: string): string {
  const describe = DESCRIBERS[name]
  const args = parseArgs(rawArgs)
  if (describe !== undefined) {
    const line = describe(args)
    return line.endsWith('：') || line.endsWith(' ') ? `调用 ${name}` : line
  }
  return `调用 ${name}`
}

/** 读过网页或外部内容的工具：用过它们的会话标为受污染。 */
export const TAINTING_TOOLS: ReadonlySet<string> = new Set([
  'web_fetch',
  'web_search',
  'browser_open',
  'browser_snapshot',
  'browser_extract',
  'browser_screenshot',
])
