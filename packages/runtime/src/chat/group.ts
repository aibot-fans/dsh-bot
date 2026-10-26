import { LEAD_ALIASES, oneLine, truncate, type Bot, type RoomMessage } from 'pod-domain'

/** 转给群成员时附带的最近几条群消息：它上一次在群里说话之后别人说的，最多这么多条。 */
const RECENT_MAX = 6

/**
 * 这个 bot 还没看到的最近几条群消息：它上一次发言之后别人说的话（文字和折叠的咨询），每条截短。
 * 正在转给它的那条消息不算在里面。
 */
export function recentLines(messages: readonly RoomMessage[], bot: Bot, nameOf: (author: string) => string, skipId: string | undefined): readonly string[] {
  const lastOwn = messages.reduce((seq, message) => (message.author === bot.id ? Math.max(seq, message.seq) : seq), 0)
  return messages
    .filter((message) => message.seq > lastOwn && message.id !== skipId && message.author !== bot.id && (message.kind === 'text' || message.kind === 'folded'))
    .slice(-RECENT_MAX)
    .map((message) => `- ${nameOf(message.author)}：${truncate(oneLine(message.body), 160)}`)
}

/**
 * 转给群成员的一条消息：谁在群里说的、有没有 @ 它，再附上它没看到的最近几条和现在的成员。
 * 是别的 bot @ 了它时，提醒它直接回复，不用 @ 回去；没点名、按分工转给它的，告诉它这件事归它来接。
 */
export function groupFrame(input: {
  readonly roomTitle: string
  readonly speaker: string
  readonly mentioned: boolean
  readonly fromBot?: boolean
  /** 用户没点名，Pod 按分工挑了它来接。 */
  readonly routed?: boolean
  readonly body: string
  readonly recent: readonly string[]
  readonly members: readonly string[]
  readonly snapshot: string | undefined
}): string {
  const hint =
    input.fromBot === true
      ? `\n（直接回复就行：你的回复会发在群里，${input.speaker}和用户都看得到，不用再 @ ${input.speaker}。）`
      : input.routed === true
        ? '\n（用户没有点名，dsh-bot 按分工把这句话交给你来接：直接回答，或者动手做完。）'
        : ''
  return [
    `[${input.speaker}在群聊「${input.roomTitle}」里${input.mentioned ? '@了你' : '说'}]\n${input.body}${hint}`,
    input.recent.length === 0 ? '' : `[最近的群聊，你还没看到的]\n${input.recent.join('\n')}`,
    `[群成员] ${input.members.join('、')}`,
    input.snapshot === undefined ? '' : `[进度快照]\n${input.snapshot}`,
  ]
    .filter((part) => part !== '')
    .join('\n\n')
}

/**
 * 按名字在群成员里找人：去掉前面的 @ 和空白；“主管”“管理员”也指主管。
 * 返回找到的成员（去重、不含说话的人自己）和不在群里的名字。
 */
export function resolveMembers(names: readonly string[], members: readonly Bot[], speaker: Bot): { readonly found: readonly Bot[]; readonly missing: readonly string[] } {
  const found: Bot[] = []
  const missing: string[] = []
  for (const raw of names) {
    const name = raw.replace(/^[@＠\s]+/, '').trim()
    if (name === '') continue
    const bot = members.find((member) => member.name === name) ?? (LEAD_ALIASES.includes(name) ? members.find((member) => member.role === 'lead') : undefined)
    if (bot === undefined) missing.push(name)
    else if (bot.id !== speaker.id && !found.some((item) => item.id === bot.id)) found.push(bot)
  }
  return { found, missing }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 去掉 bot 自己写进话里的 @点名对象：Pod 会在前面统一加上 @，不去掉就会出现“@写手 @写手”。
 * 按名字从长到短匹配，提到不是点名对象的成员（比如“写手二号”）原样保留；“主管”“管理员”算主管。
 */
export function stripMentions(message: string, targets: readonly Bot[], members: readonly Bot[]): string {
  const ids = new Set(targets.map((bot) => bot.id))
  const lead = members.find((bot) => bot.role === 'lead')
  const names = [...new Set([...members.map((bot) => bot.name), ...LEAD_ALIASES])].sort((left, right) => right.length - left.length)
  if (names.length === 0) return message.trim()
  const pattern = new RegExp(`[@＠](${names.map(escapeRegExp).join('|')})[\\s,，:：]*`, 'g')
  const owner = (name: string): Bot | undefined => members.find((bot) => bot.name === name) ?? (LEAD_ALIASES.includes(name) ? lead : undefined)
  return message.replace(pattern, (match, name: string) => (ids.has(owner(name)?.id ?? '') ? '' : match)).trim()
}
