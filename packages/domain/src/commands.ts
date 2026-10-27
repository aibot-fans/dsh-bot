/** 聊天里的快捷指令：输入框里以 / 开头。房间里保留你的原话，交给 bot 的是展开后的说明。 */

import { currentLanguage, translate, type Language } from './i18n.ts'

export type QuickCommandId = 'task' | 'review' | 'group' | 'invite' | 'stop' | 'summary'

export interface QuickCommand {
  readonly id: QuickCommandId
  /** 输入框里打的名字（按当前语言）；中文和英文的名字都认。 */
  readonly name: string
  readonly usage: string
  readonly description: string
  /** 只打指令名就行，后面不用接内容。 */
  readonly bare: boolean
}

interface CommandSpec {
  readonly id: QuickCommandId
  readonly zh: string
  readonly en: string
  /** 后面接什么（空的表示不用接）。 */
  readonly argument: string
  readonly description: string
}

const COMMANDS: readonly CommandSpec[] = [
  { id: 'task', zh: '任务', en: 'task', argument: '要做的事', description: '作为任务交给合适的 bot，需要时组队' },
  { id: 'review', zh: '评审', en: 'review', argument: '主题', description: '组织一次内部评审' },
  { id: 'group', zh: '建群', en: 'group', argument: '要做的事', description: '临时组个小组来做' },
  { id: 'invite', zh: '邀请', en: 'invite', argument: 'bot 名字', description: '把一个 bot 拉进来一起做' },
  { id: 'stop', zh: '停止', en: 'stop', argument: '', description: '停掉这个房间的任务' },
  { id: 'summary', zh: '总结', en: 'summary', argument: '', description: '总结到目前为止的要点' },
]

/** 输入框里提示的指令：名字、用法和说明按语言给。 */
export function quickCommands(language: Language = currentLanguage()): readonly QuickCommand[] {
  return COMMANDS.map((spec) => {
    const name = spec[language]
    return {
      id: spec.id,
      name,
      usage: spec.argument === '' ? `/${name}` : `/${name} ${translate(language, spec.argument)}`,
      description: translate(language, spec.description),
      bare: spec.argument === '',
    }
  })
}

const NAMES = new Map(COMMANDS.flatMap((spec) => [[spec.zh, spec] as const, [spec.en, spec] as const]))
const PATTERN = new RegExp(`^/(${[...NAMES.keys()].join('|')})(?:[ \t\u3000]+|\n|$)([\s\S]*)$`, 'i')

export interface ParsedCommand {
  readonly id: QuickCommandId
  /** 指令的中文名（打的是英文名也给中文名）。 */
  readonly name: string
  readonly rest: string
}

export function parseQuickCommand(text: string): ParsedCommand | undefined {
  const match = PATTERN.exec(text.trim())
  const spec = match === null ? undefined : NAMES.get((match[1] as string).toLowerCase())
  if (match === null || spec === undefined) return undefined
  return { id: spec.id, name: spec.zh, rest: (match[2] ?? '').trim() }
}

/** 展开成交给 bot 的说明；/停止 由页面直接停任务，不经过 bot。不是快捷指令返回 undefined。 */
export function expandQuickCommand(text: string): string | undefined {
  const command = parseQuickCommand(text)
  if (command === undefined || command.id === 'stop') return undefined
  const quote = `（用户原话：${text.trim()}）`
  switch (command.id) {
    case 'task':
      return command.rest === '' ? undefined : `[快捷指令：派任务]${quote}\n请把下面这件事作为任务交给合适的 bot（需要时组队），不要自己在聊天里做完：\n${command.rest}`
    case 'review':
      return command.rest === '' ? undefined : `[快捷指令：内部评审]${quote}\n请找合适的 bot 组织一次内部评审，主题：${command.rest}`
    case 'group':
      return command.rest === '' ? undefined : `[快捷指令：建群]${quote}\n请为这件事临时组一个小组（你兼任组长）来做：\n${command.rest}`
    case 'invite':
      return command.rest === '' ? undefined : `[快捷指令：邀请]${quote}\n请把「${command.rest.split(/\s+/)[0]}」拉进来一起做这里的事${command.rest.includes(' ') ? `：${command.rest.slice(command.rest.indexOf(' ') + 1)}` : ''}。`
    case 'summary':
      return `[快捷指令：总结]${quote}\n请总结到目前为止的要点：已经定下的结论、待办、还没定的事。`
    default:
      return undefined
  }
}
