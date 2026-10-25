/** bot 的领域模型和校验：只有普通值，不依赖 dsh，也不做 I/O。 */

import { hasAvatar } from './avatars.ts'
import { asRecord, readBool, readEnum, readText, type InputRecord } from './input.ts'
import { fail, ok, type PodResult } from './result.ts'
import { charLength, isRecord } from './text.ts'

/** 主管是默认入口；成员是之后新建的 bot。 */
export type BotRole = 'lead' | 'member'

/**
 * 工具档案。对话：聊天、读记忆、搜聊天记录；研究：再加 web 搜索、浏览器只读、工作区读写；
 * 执行：再加沙箱 shell 和浏览器写操作（写操作要审批）。组织工具只给主管，不算档案。
 */
export type ToolProfile = 'talk' | 'research' | 'exec'

export const TOOL_PROFILES: readonly ToolProfile[] = ['talk', 'research', 'exec']

export const TOOL_PROFILE_LABELS: Readonly<Record<ToolProfile, string>> = {
  talk: '对话',
  research: '研究',
  exec: '执行',
}

/** 指定的模型；null 表示跟随上一级（团队、Pod 全局、dsh 默认）。 */
export interface ModelChoice {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** 角色卡：其他 bot 据此判断什么事该找它。 */
export interface BotCard {
  readonly duties: string
  readonly strengths: string
  readonly notResponsible: string
  readonly askWho: string
}

export const EMPTY_CARD: BotCard = { duties: '', strengths: '', notResponsible: '', askWho: '' }

/** 人设最后一次是谁写的：你亲手写的段落不会被自我优化自动改写。 */
export type PersonaSource = 'seed' | 'user' | 'auto'

export interface Bot {
  readonly id: string
  readonly name: string
  readonly role: BotRole
  /** 卡片上显示的角色，例如“研究员”；可以为空。 */
  readonly title: string
  /** 人设正文，会成为这个 bot 会话的人设前缀。 */
  readonly persona: string
  readonly personaSource: PersonaSource
  /** 头像：小图标（icon:种类）或上传的图片（img:文件名）；空串表示还没定，界面按角色猜一个小图标。 */
  readonly avatar: string
  /** 能力标签，分配任务时用来匹配，例如“调研”“写作”。 */
  readonly capabilities: readonly string[]
  readonly card: BotCard
  readonly model: ModelChoice | null
  readonly toolProfile: ToolProfile
  /** 临时 bot：任务结束就归档，30 天内可恢复。 */
  readonly temporary: boolean
  /** 名字颜色（色板里的名字，见 bot-colors）；不算配置，不进版本记录。老数据可能没有。 */
  readonly color?: string
  readonly createdAt: number
  readonly updatedAt: number
  /** 归档时间。归档的 bot 在回收站里，30 天内可以恢复。 */
  readonly archivedAt: number | null
}

/** 新建 bot 时可以填的内容；没填的用默认值。 */
export interface BotDraft {
  readonly name: string
  readonly title: string
  readonly persona: string
  readonly avatar?: string
  readonly capabilities?: readonly string[]
  readonly card?: BotCard
  readonly model?: ModelChoice | null
  readonly toolProfile?: ToolProfile
  readonly temporary?: boolean
}

/** 部分修改：没带的字段保持不变。 */
export interface BotPatch {
  readonly name?: string
  readonly title?: string
  readonly persona?: string
  readonly avatar?: string
  readonly capabilities?: readonly string[]
  readonly card?: BotCard
  readonly model?: ModelChoice | null
  readonly toolProfile?: ToolProfile
  readonly temporary?: boolean
}

export const BOT_NAME_MAX = 24
export const BOT_TITLE_MAX = 24
export const BOT_PERSONA_MAX = 4000
export const CAPABILITY_MAX = 12
export const CAPABILITY_COUNT_MAX = 12
export const CARD_FIELD_MAX = 200

function checkName(name: string): string | undefined {
  if (name === '') return '名字不能为空'
  if (charLength(name) > BOT_NAME_MAX) return `名字最多 ${BOT_NAME_MAX} 个字`
  return undefined
}

function checkTitle(title: string): string | undefined {
  return charLength(title) > BOT_TITLE_MAX ? `角色最多 ${BOT_TITLE_MAX} 个字` : undefined
}

function checkPersona(persona: string): string | undefined {
  if (persona === '') return '人设不能为空'
  if (charLength(persona) > BOT_PERSONA_MAX) return `人设最多 ${BOT_PERSONA_MAX} 个字`
  return undefined
}

function checkAvatar(avatar: string): string | undefined {
  return avatar === '' || hasAvatar(avatar) ? undefined : '头像只能选一个小图标，或者上传一张图片'
}

type Parsed<T> = { readonly ok: true; readonly value: T | undefined } | { readonly ok: false; readonly message: string }

function parseCapabilities(input: InputRecord): Parsed<readonly string[]> {
  const value = input.capabilities
  if (value === undefined) return { ok: true, value: undefined }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return { ok: false, message: '能力标签必须是文字列表' }
  }
  const tags = [...new Set(value.map((item: string) => item.trim()).filter(Boolean))]
  if (tags.length > CAPABILITY_COUNT_MAX) return { ok: false, message: `能力标签最多 ${CAPABILITY_COUNT_MAX} 个` }
  if (tags.some((tag) => charLength(tag) > CAPABILITY_MAX)) {
    return { ok: false, message: `每个能力标签最多 ${CAPABILITY_MAX} 个字` }
  }
  return { ok: true, value: tags }
}

function parseCard(input: InputRecord): Parsed<BotCard> {
  const value = input.card
  if (value === undefined) return { ok: true, value: undefined }
  if (!isRecord(value)) return { ok: false, message: '角色卡必须是对象' }
  const field = (key: keyof BotCard): string | null => {
    const text = value[key]
    if (text === undefined) return ''
    return typeof text === 'string' ? text.trim() : null
  }
  const card = {
    duties: field('duties'),
    strengths: field('strengths'),
    notResponsible: field('notResponsible'),
    askWho: field('askWho'),
  }
  const texts = Object.values(card)
  if (texts.some((text) => text === null)) return { ok: false, message: '角色卡的每一项都必须是文字' }
  if (texts.some((text) => charLength(text ?? '') > CARD_FIELD_MAX)) {
    return { ok: false, message: `角色卡每一项最多 ${CARD_FIELD_MAX} 个字` }
  }
  return { ok: true, value: card as BotCard }
}

/** 模型选择：null 表示跟随；对象必须带 provider 和 model。 */
export function parseModelChoice(value: unknown): Parsed<ModelChoice | null> {
  if (value === undefined) return { ok: true, value: undefined }
  if (value === null) return { ok: true, value: null }
  if (!isRecord(value)) return { ok: false, message: '模型必须是对象或 null' }
  const provider = typeof value.provider === 'string' ? value.provider.trim() : ''
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  if (provider === '' || model === '') return { ok: false, message: '模型要同时写明 provider 和 model' }
  const effort = typeof value.reasoningEffort === 'string' ? value.reasoningEffort.trim() : ''
  return { ok: true, value: effort === '' ? { provider, model } : { provider, model, reasoningEffort: effort } }
}

interface CommonFields {
  readonly name: string | undefined
  readonly title: string | undefined
  readonly persona: string | undefined
  readonly avatar: string | undefined
  readonly capabilities: readonly string[] | undefined
  readonly card: BotCard | undefined
  readonly model: ModelChoice | null | undefined
  readonly toolProfile: ToolProfile | undefined
  readonly temporary: boolean | undefined
}

function parseCommon(input: unknown): PodResult<CommonFields> {
  const record = asRecord(input)
  const name = readText(record, 'name')
  const title = readText(record, 'title')
  const persona = readText(record, 'persona')
  const avatar = readText(record, 'avatar')
  if (name === null || title === null || persona === null || avatar === null) {
    return fail('invalid-input', '名字、角色、人设和头像都必须是文字')
  }
  const capabilities = parseCapabilities(record)
  if (!capabilities.ok) return fail('invalid-input', capabilities.message)
  const card = parseCard(record)
  if (!card.ok) return fail('invalid-input', card.message)
  const model = parseModelChoice(record.model)
  if (!model.ok) return fail('invalid-input', model.message)
  if (record.toolProfile !== undefined && readEnum(record, 'toolProfile', TOOL_PROFILES) === undefined) {
    return fail('invalid-input', '工具档案只能是对话、研究或执行')
  }
  const problem =
    (name === undefined ? undefined : checkName(name)) ??
    (title === undefined ? undefined : checkTitle(title)) ??
    (persona === undefined ? undefined : checkPersona(persona)) ??
    (avatar === undefined ? undefined : checkAvatar(avatar))
  if (problem !== undefined) return fail('invalid-input', problem)
  return ok({
    name,
    title,
    persona,
    avatar,
    capabilities: capabilities.value,
    card: card.value,
    model: model.value,
    toolProfile: readEnum(record, 'toolProfile', TOOL_PROFILES),
    temporary: readBool(record, 'temporary'),
  })
}

/** 只保留给了值的字段，组成不可变的部分对象。 */
function defined<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<T>
}

/** 校验并规整新建内容：去掉首尾空白，检查长度。 */
export function validateDraft(input: unknown): PodResult<BotDraft> {
  const parsed = parseCommon(input)
  if (!parsed.ok) return parsed
  const fields = parsed.value
  const name = fields.name ?? ''
  const persona = fields.persona ?? ''
  const problem = checkName(name) ?? checkPersona(persona)
  if (problem !== undefined) return fail('invalid-input', problem)
  return ok({ ...defined(fields), name, title: fields.title ?? '', persona })
}

/** 校验修改内容：只有请求里带了的字段才进入结果。 */
export function validatePatch(input: unknown): PodResult<BotPatch> {
  const parsed = parseCommon(input)
  return parsed.ok ? ok(defined(parsed.value)) : parsed
}

/** 版本快照里保存的字段：人设、模型、工具档案这些会被改动和回滚的配置。 */
export type BotConfig = Pick<
  Bot,
  'name' | 'title' | 'persona' | 'avatar' | 'capabilities' | 'card' | 'model' | 'toolProfile' | 'temporary'
>

export function botConfig(bot: Bot): BotConfig {
  return {
    name: bot.name,
    title: bot.title,
    persona: bot.persona,
    avatar: bot.avatar,
    capabilities: bot.capabilities,
    card: bot.card,
    model: bot.model,
    toolProfile: bot.toolProfile,
    temporary: bot.temporary,
  }
}

const CONFIG_LABELS: Readonly<Record<keyof BotConfig, string>> = {
  name: '名字',
  title: '角色',
  persona: '人设',
  avatar: '头像',
  capabilities: '能力标签',
  card: '角色卡',
  model: '模型',
  toolProfile: '工具档案',
  temporary: '临时/常驻',
}

/** 两版配置之间改了哪些项，给版本列表和进化日志一行说明。 */
export function describeConfigChange(before: BotConfig, after: BotConfig): readonly string[] {
  const keys = Object.keys(CONFIG_LABELS) as (keyof BotConfig)[]
  return keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map((key) => CONFIG_LABELS[key])
}

/** 显示用的名字：带角色时写成“研究员 · 小研”这种。 */
export function botLabel(bot: Pick<Bot, 'name' | 'title'>): string {
  return bot.title === '' || bot.title === bot.name ? bot.name : `${bot.name}（${bot.title}）`
}
