/** Pod 的全局设置：默认值、校验和部分修改。 */

import { parseModelChoice, type ModelChoice } from './bots.ts'
import { asRecord } from './input.ts'
import { isLanguageSetting, t, type LanguageSetting } from './i18n.ts'
import { DEFAULT_SITE_RULES, type SiteMode, type SiteRule } from './policy.ts'
import { fail, ok, type PodResult } from './result.ts'
import { isRecord } from './text.ts'

/** 授权档位：放手是发完开工说明直接开工；谨慎是开工前先给你看计划。 */
export type Autonomy = 'hands-off' | 'careful'

export interface ClockRange {
  readonly enabled: boolean
  /** HH:MM，按设置里的时区解析。 */
  readonly start: string
  readonly end: string
}

export interface DailyBrief {
  readonly enabled: boolean
  readonly time: string
}

export interface PodSettings {
  /** 例程，以及“明天”“下周”这类说法按这个时区解析。 */
  readonly timezone: string
  readonly autonomy: Autonomy
  /** Pod 全局默认模型；null 表示跟随 dsh。 */
  readonly defaultModel: ModelChoice | null
  /** 轻量调用（摘要、提取、交接笔记）用的模型；null 表示用默认模型。 */
  readonly liteModel: ModelChoice | null
  /** 任务通道并发数：超出的排队，不拒绝任务。 */
  readonly taskConcurrency: number
  /** 聊天通道保留的并发数，任务再多你说话也不用排队。 */
  readonly chatConcurrency: number
  /** 共用浏览器同时打开的标签页数。 */
  readonly browserTabs: number
  readonly dailyBrief: DailyBrief
  readonly quietHours: ClockRange
  /** 有任务运行时阻止电脑休眠，默认关闭。 */
  readonly preventSleep: boolean
  /** 用 DeepSeek 模型时，不急的例程、夜间整理和复盘放到非高峰时段。 */
  readonly offPeak: boolean
  /** 工作上下文的软上限（token），超过就换段。 */
  readonly softContextTokens: number
  /** 自动从对话里提取记忆。 */
  readonly memoryExtraction: boolean
  /** dsh web 标签页开着时发浏览器系统通知（需要你在浏览器里允许）。 */
  readonly browserNotifications: boolean
  /** 首次引导是否已完成。 */
  readonly onboarded: boolean
  /** 站点规则：禁止、只读、写操作需审批、免审批。默认带一份禁止清单。 */
  readonly siteRules: readonly SiteRule[]
  /** 允许访问的本机或局域网地址（本地开发服务），例如 localhost:5173。 */
  readonly allowedHosts: readonly string[]
  /** 本机 Chrome 的路径；空表示自动查找。 */
  readonly chromePath: string
  /** aibot（X 数据和监控）接入；关掉后不调 aibot、不连事件流，Key 和安装码保留。 */
  readonly aibotEnabled: boolean
  /** 每隔几小时问一次 npm 有没有新版本；只发包名。 */
  readonly checkUpdates: boolean
  /** 界面、系统消息和 bot 回答用的语言；auto 跟随 dsh 的界面语言。 */
  readonly language: LanguageSetting
}

export const DEFAULT_SETTINGS: PodSettings = {
  timezone: 'Asia/Shanghai',
  autonomy: 'hands-off',
  defaultModel: null,
  liteModel: null,
  taskConcurrency: 4,
  chatConcurrency: 2,
  browserTabs: 10,
  dailyBrief: { enabled: true, time: '08:30' },
  quietHours: { enabled: false, start: '23:00', end: '08:00' },
  preventSleep: false,
  offPeak: true,
  softContextTokens: 128_000,
  memoryExtraction: true,
  browserNotifications: false,
  onboarded: false,
  siteRules: DEFAULT_SITE_RULES,
  allowedHosts: [],
  chromePath: '',
  aibotEnabled: true,
  checkUpdates: true,
  language: 'auto',
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

export function isClock(value: unknown): value is string {
  return typeof value === 'string' && CLOCK.test(value)
}

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

function intIn(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : undefined
}

type Change = { readonly ok: true; readonly value: Partial<PodSettings> } | { readonly ok: false; readonly message: string }

function rangeChange(key: 'quietHours', raw: unknown, current: ClockRange): Change {
  if (!isRecord(raw)) return { ok: false, message: t('勿扰时段格式不对') }
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : current.enabled
  const start = raw.start === undefined ? current.start : raw.start
  const end = raw.end === undefined ? current.end : raw.end
  if (!isClock(start) || !isClock(end)) return { ok: false, message: t('时间要写成 HH:MM') }
  return { ok: true, value: { [key]: { enabled, start, end } } }
}

function briefChange(raw: unknown, current: DailyBrief): Change {
  if (!isRecord(raw)) return { ok: false, message: t('每日简报格式不对') }
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : current.enabled
  const time = raw.time === undefined ? current.time : raw.time
  if (!isClock(time)) return { ok: false, message: t('简报时间要写成 HH:MM') }
  return { ok: true, value: { dailyBrief: { enabled, time } } }
}

const SITE_MODES: readonly SiteMode[] = ['blocked', 'read-only', 'approve-writes', 'free']
const SITE_PATTERN = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/i
const HOST_ENTRY = /^([a-z0-9-]+(\.[a-z0-9-]+)*|\[[0-9a-f:]+\])(:\d{1,5})?$/i

function siteRulesChange(raw: unknown): Change {
  if (!Array.isArray(raw) || raw.length > 300) return { ok: false, message: t('站点规则最多 300 条') }
  const rules: SiteRule[] = []
  for (const item of raw) {
    if (!isRecord(item)) return { ok: false, message: t('站点规则格式不对') }
    const pattern = typeof item.pattern === 'string' ? item.pattern.trim().toLowerCase() : ''
    const mode = item.mode as SiteMode
    if (!SITE_PATTERN.test(pattern)) return { ok: false, message: t('网站“{pattern}”格式不对，写域名，可以用 *. 开头', { pattern }) }
    if (!SITE_MODES.includes(mode)) return { ok: false, message: t('站点规则只能是禁止、只读、写操作需审批或免审批') }
    rules.push({ pattern, mode, note: typeof item.note === 'string' ? item.note.trim().slice(0, 40) : '' })
  }
  return { ok: true, value: { siteRules: rules } }
}

function allowedHostsChange(raw: unknown): Change {
  if (!Array.isArray(raw) || raw.length > 50) return { ok: false, message: t('白名单最多 50 个地址') }
  const hosts = raw.map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
  const bad = hosts.find((host) => !HOST_ENTRY.test(host))
  if (bad !== undefined) return { ok: false, message: t('地址“{bad}”格式不对，写成 localhost:5173 这样', { bad }) }
  return { ok: true, value: { allowedHosts: [...new Set(hosts)] } }
}

const BOOLEAN_KEYS = ['preventSleep', 'offPeak', 'memoryExtraction', 'browserNotifications', 'onboarded', 'aibotEnabled', 'checkUpdates'] as const

function oneChange(key: string, raw: unknown, current: PodSettings): Change {
  switch (key) {
    case 'timezone':
      return isTimeZone(raw) ? { ok: true, value: { timezone: raw } } : { ok: false, message: t('时区不认识') }
    case 'autonomy':
      return raw === 'hands-off' || raw === 'careful'
        ? { ok: true, value: { autonomy: raw } }
        : { ok: false, message: t('授权档位只能是放手或谨慎') }
    case 'defaultModel':
    case 'liteModel': {
      const parsed = parseModelChoice(raw)
      if (!parsed.ok) return { ok: false, message: parsed.message }
      return { ok: true, value: { [key]: parsed.value ?? null } }
    }
    case 'taskConcurrency':
    case 'chatConcurrency':
    case 'browserTabs': {
      const value = intIn(raw, 1, 32)
      return value === undefined ? { ok: false, message: t('并发数和标签页数是 1 到 32 的整数') } : { ok: true, value: { [key]: value } }
    }
    case 'softContextTokens': {
      const value = intIn(raw, 16_000, 2_000_000)
      return value === undefined ? { ok: false, message: t('上下文软上限在 16000 到 2000000 之间') } : { ok: true, value: { softContextTokens: value } }
    }
    case 'quietHours':
      return rangeChange('quietHours', raw, current.quietHours)
    case 'dailyBrief':
      return briefChange(raw, current.dailyBrief)
    case 'siteRules':
      return siteRulesChange(raw)
    case 'allowedHosts':
      return allowedHostsChange(raw)
    case 'language':
      return isLanguageSetting(raw) ? { ok: true, value: { language: raw } } : { ok: false, message: t('语言只能是跟随 dsh、中文或 English') }
    case 'chromePath':
      return typeof raw === 'string' && raw.length <= 500 && (raw === '' || raw.startsWith('/') || /^[a-z]:\\/i.test(raw))
        ? { ok: true, value: { chromePath: raw.trim() } }
        : { ok: false, message: t('Chrome 路径要写绝对路径，留空表示自动查找') }
    default:
      if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
        return typeof raw === 'boolean' ? { ok: true, value: { [key]: raw } } : { ok: false, message: t('{key} 必须是开或关', { key }) }
      }
      return { ok: false, message: t('没有 {key} 这项设置', { key }) }
  }
}

/** 校验一次部分修改，返回合并后的完整设置。 */
export function applySettingsPatch(current: PodSettings, input: unknown): PodResult<PodSettings> {
  const record = asRecord(input)
  let next: PodSettings = current
  for (const [key, raw] of Object.entries(record)) {
    const change = oneChange(key, raw, next)
    if (!change.ok) return fail('invalid-input', change.message)
    next = { ...next, ...change.value }
  }
  return ok(next)
}

/** 从存储里读回的设置可能缺字段（旧版本写的），用默认值补齐，坏字段直接丢掉。 */
export function normalizeSettings(stored: unknown): PodSettings {
  let next = DEFAULT_SETTINGS
  for (const [key, raw] of Object.entries(asRecord(stored))) {
    const change = oneChange(key, raw, next)
    if (change.ok) next = { ...next, ...change.value }
  }
  return next
}
