import { currentLanguage, t, type Language } from './i18n.ts'

/**
 * 团队说明：提示词里你可以改的三块（沟通、任务范围、交付要求），和代码里的协议分开；协议规定工具和规矩，随版本更新，不能改。
 * 每块的默认值按版本留着：你改过的块记下基于哪一版默认，默认出了新版，那块显示“默认已更新”，看过差异再选保留你的还是换成新默认。
 * 没改过的块一直用最新的默认。
 */
export type TeamNoteKey = 'communication' | 'scope' | 'delivery'

export const TEAM_NOTE_KEYS: readonly TeamNoteKey[] = ['communication', 'scope', 'delivery']

export const TEAM_NOTE_LABELS: Readonly<Record<TeamNoteKey, string>> = { communication: '沟通', scope: '任务范围', delivery: '交付要求' }

/** 你改过的一块：正文和改的时候默认是第几版。 */
export interface TeamNoteOverride {
  readonly text: string
  readonly base: number
}

/** 没改过的块是 null。 */
export type TeamNotes = Readonly<Record<TeamNoteKey, TeamNoteOverride | null>>

export const EMPTY_TEAM_NOTES: TeamNotes = { communication: null, scope: null, delivery: null }

/** 一块最多多少字。 */
export const TEAM_NOTE_MAX = 4000

interface Localized {
  readonly zh: string
  readonly en: string
}

const COMMUNICATION_V1: Localized = {
  zh: [
    '你发到对话里的话：',
    '- 第一句就是结论或答案；要用户做什么（看、试、选、批准），写在最前面。',
    '- 长短跟着内容走：一句能说清就一句；结果本身有好几项，就每项一行。',
    '- 不说废话：不写“好的，我来……”“我将……”；不复述用户的话和任务卡上已有的内容；不讲做了哪些步骤、怎么验证的，用户问了再讲；结尾不总结、不客套、不问“还需要什么吗”，不列“我还可以……”。',
    '- 每一句都过一遍：删掉它，用户还看不看得懂结果、知不知道要做什么？不影响就删。',
    '- 少用格式：短回复不用标题和表格，不满篇加粗，不拿对勾、叉号当标记；三项以上并列才用列表。',
    '- 长内容（文档、方案、代码、完整报告）写进文件或页面，对话里给一句结论加路径或链接。',
    '例子：',
    '- 用户问“测试过了吗”。好：“过了，42 个都通过；跳过 1 个，是要联网的那个。”不好：“好的，我来为你总结一下测试情况。首先……综上所述……还需要我做什么吗？”',
    '- 查完一个问题。好：“3080 起不来是旧进程占着端口，已结束旧进程并重启，现在正常。”不好：“好的！我先查了进程，又看了最近一小时的日志……总的来说是端口冲突。如果还有问题随时告诉我，我还可以帮你加一个开机自启。”',
  ].join('\n'),
  en: [
    'What you say in the conversation:',
    '- Lead with the conclusion or answer; anything the user needs to do (look, try, choose, approve) goes first.',
    '- Let the content set the length: one sentence if one sentence does it; if the result has several items, one line each.',
    '- No filler: don\'t write "Sure, I\'ll..." or "I will..."; don\'t repeat the user\'s words or what the task card already shows; don\'t describe your steps or how you checked unless asked; no closing summary, pleasantries, "anything else?", or lists of "I can also...".',
    '- Check every sentence: if the user would still understand the result and what to do without it, delete it.',
    '- Go easy on formatting: no headings or tables in short replies, no bold everywhere, no check marks or crosses as bullets; use a list only for three or more parallel items.',
    '- Put long content (documents, plans, code, full reports) in a file or page and give a one-line conclusion with the path or link.',
    'Examples:',
    '- The user asks "did the tests pass?" Good: "Yes, all 42 passed; 1 skipped, the one that needs the network." Bad: "Sure, let me summarize the test results for you. First... In conclusion... Is there anything else you need?"',
    '- After tracking down a problem. Good: "Port 3080 was held by an old process; stopped it and restarted, it works now." Bad: "Sure! First I checked the processes, then the last hour of logs... Overall it was a port conflict. Let me know if anything else comes up, I can also set it to start at boot."',
  ].join('\n'),
}

const SCOPE_V1: Localized = {
  zh: [
    '- 默认自己判断、直接推进；缺的信息按合理的默认值补上，并写明你定下的前提。问得少，就要交代得多。',
    '- 只做交代的事：不顺手扩大范围，不替用户加需求；看到别的问题写进报告的遗留问题。',
    '- 只在四种情况下找用户：需要登录、验证码或两步验证；要做不可撤回的对外操作（提交、发送、发布、删除）；操作被安全规则拦下；遇到会让结果方向完全不同、又没有合理默认值的歧义。能绕过的先绕过（比如换一个数据来源），并在交付里注明。',
  ].join('\n'),
  en: [
    '- Decide for yourself and keep going by default; fill in missing information with sensible defaults and state the assumptions you made. The less you ask, the more you explain.',
    "- Do what was asked: don't widen the scope or add requirements on the user's behalf; put other problems you notice under open issues in the report.",
    '- Only go to the user in four cases: a login, captcha or two-step verification is needed; an irreversible external action (submit, send, publish, delete) needs doing; a safety rule blocked an action; or an ambiguity would send the result in completely different directions and has no sensible default. Work around what you can first (for example, use another data source) and say so in the delivery.',
  ].join('\n'),
}

const DELIVERY_V1: Localized = {
  zh: [
    '- 交付时写清要点、产出文件、做了哪些假设、哪些信息没核实、跳过了什么。',
    '- 完整报告按这几个小标题写：结论、改了什么、怎么验证的、产出在哪、遗留问题、要你做什么。',
    '- 交付物本身放进任务文件夹或页面，报告里写路径或链接。',
  ].join('\n'),
  en: [
    '- When delivering, state the key points, output files, the assumptions you made, what you could not verify, and what you skipped.',
    '- Write the full report under these headings: Conclusion, What changed, How it was verified, Where the output is, Open issues, What you need to do.',
    '- Put the deliverable itself in the task folder or a page, and give the path or link in the report.',
  ].join('\n'),
}

/** 每块默认值的各版，从第 1 版排起；改默认就在末尾加一版，旧版留着给改过的人看差异。 */
const DEFAULTS: Readonly<Record<TeamNoteKey, readonly Localized[]>> = {
  communication: [COMMUNICATION_V1],
  scope: [SCOPE_V1],
  delivery: [DELIVERY_V1],
}

/** 这块默认值的最新版本号。 */
export function teamNoteVersion(key: TeamNoteKey): number {
  return DEFAULTS[key].length
}

/** 某一版默认值；没有这一版返回 undefined。 */
export function teamNoteDefault(key: TeamNoteKey, language: Language = currentLanguage(), version: number = teamNoteVersion(key)): string | undefined {
  const entry = DEFAULTS[key][version - 1]
  return entry === undefined ? undefined : entry[language]
}

/** 是不是某一版默认值的原文（哪种语言都算）：存的时候和默认一样就不算改过。 */
export function isTeamNoteDefault(key: TeamNoteKey, text: string): boolean {
  return DEFAULTS[key].some((entry) => entry.zh === text || entry.en === text)
}

/** 这块现在用的正文：改过的用你的，没改过的用最新默认。 */
export function teamNoteText(notes: TeamNotes, key: TeamNoteKey, language: Language = currentLanguage()): string {
  return notes[key]?.text ?? teamNoteDefault(key, language) ?? ''
}

/** 你改过、默认在那之后又出了新版：显示“默认已更新”。 */
export function teamNoteStale(notes: TeamNotes, key: TeamNoteKey): boolean {
  const override = notes[key]
  return override !== null && override.base < teamNoteVersion(key)
}

/** 读一次修改：只写了要改的几块；null 或空着是恢复默认，和某版默认一字不差的也算没改。写错了返回说明。 */
export function readTeamNotesPatch(raw: unknown, current: TeamNotes): TeamNotes | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return t('团队说明格式不对')
  let next = current
  for (const [name, value] of Object.entries(raw)) {
    const key = TEAM_NOTE_KEYS.find((item) => item === name)
    if (key === undefined) return t('没有「{key}」这块团队说明', { key: name })
    if (value === null) {
      next = { ...next, [key]: null }
      continue
    }
    if (typeof value !== 'object' || Array.isArray(value)) return t('团队说明格式不对')
    const record = value as Readonly<Record<string, unknown>>
    const text = typeof record.text === 'string' ? record.text.trim() : ''
    if (text.length > TEAM_NOTE_MAX) return t('每块团队说明最多 {max} 字', { max: TEAM_NOTE_MAX })
    const latest = teamNoteVersion(key)
    const base = typeof record.base === 'number' && Number.isInteger(record.base) && record.base >= 1 && record.base <= latest ? record.base : latest
    next = { ...next, [key]: text === '' || isTeamNoteDefault(key, text) ? null : { text, base } }
  }
  return next
}
