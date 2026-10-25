/** 聊天里的快捷指令：输入框里以 / 开头。房间里保留你的原话，交给 bot 的是展开后的说明。 */

export interface QuickCommand {
  readonly name: string
  readonly usage: string
  readonly description: string
}

export const QUICK_COMMANDS: readonly QuickCommand[] = [
  { name: '任务', usage: '/任务 要做的事', description: '作为任务交给合适的 bot，需要时组队' },
  { name: '评审', usage: '/评审 主题', description: '组织一次内部评审' },
  { name: '建群', usage: '/建群 要做的事', description: '临时组个小组来做' },
  { name: '邀请', usage: '/邀请 bot 名字', description: '把一个 bot 拉进来一起做' },
  { name: '停止', usage: '/停止', description: '停掉这个房间的任务' },
  { name: '总结', usage: '/总结', description: '总结到目前为止的要点' },
]

const PATTERN = /^\/(任务|评审|建群|邀请|停止|总结)(?:[ \t　]+|\n|$)([\s\S]*)$/

export interface ParsedCommand {
  readonly name: string
  readonly rest: string
}

export function parseQuickCommand(text: string): ParsedCommand | undefined {
  const match = PATTERN.exec(text.trim())
  if (match === null) return undefined
  return { name: match[1] as string, rest: (match[2] ?? '').trim() }
}

/** 展开成交给 bot 的说明；/停止 由页面直接停任务，不经过 bot。不是快捷指令返回 undefined。 */
export function expandQuickCommand(text: string): string | undefined {
  const command = parseQuickCommand(text)
  if (command === undefined || command.name === '停止') return undefined
  const quote = `（用户原话：${text.trim()}）`
  switch (command.name) {
    case '任务':
      return command.rest === '' ? undefined : `[快捷指令：派任务]${quote}\n请把下面这件事作为任务交给合适的 bot（需要时组队），不要自己在聊天里做完：\n${command.rest}`
    case '评审':
      return command.rest === '' ? undefined : `[快捷指令：内部评审]${quote}\n请找合适的 bot 组织一次内部评审，主题：${command.rest}`
    case '建群':
      return command.rest === '' ? undefined : `[快捷指令：建群]${quote}\n请为这件事临时组一个小组（你兼任组长）来做：\n${command.rest}`
    case '邀请':
      return command.rest === '' ? undefined : `[快捷指令：邀请]${quote}\n请把「${command.rest.split(/\s+/)[0]}」拉进来一起做这里的事${command.rest.includes(' ') ? `：${command.rest.slice(command.rest.indexOf(' ') + 1)}` : ''}。`
    case '总结':
      return `[快捷指令：总结]${quote}\n请总结到目前为止的要点：已经定下的结论、待办、还没定的事。`
    default:
      return undefined
  }
}
