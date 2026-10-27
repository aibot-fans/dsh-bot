/**
 * 中英文切换。代码里直接写中文原文，t() 按当前语言查英文译文，查不到就用原文。
 * 原文里的 {name} 换成参数；英文译文里可以写 {count:item|items}，count 是 1 时取前一个。
 * 语言是进程级的：dsh-bot 只有一份设置，宿主和页面各自按设置切换（页面打包了自己的一份）。
 */

import { DOMAIN_EN } from './locales/en.ts'

export type Language = 'zh' | 'en'

/** 设置里的语言：auto 跟随 dsh 的界面语言。 */
export type LanguageSetting = 'auto' | Language

export const LANGUAGE_SETTINGS: readonly LanguageSetting[] = ['auto', 'zh', 'en']

/** 语言自己的名字：两种界面里都这么写，不翻译。 */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = { zh: '中文', en: 'English' }

/** 参数照模板字符串的规矩转成文字（null、undefined 也一样）。 */
export type TextParams = Readonly<Record<string, string | number | boolean | null | undefined>>

let current: Language = 'zh'
let english: ReadonlyMap<string, string> = new Map(Object.entries(DOMAIN_EN))

export function setLanguage(language: Language): void {
  current = language
}

export function currentLanguage(): Language {
  return current
}

/** 登记英文译文；同一句原文后登记的覆盖先登记的。 */
export function addEnglish(entries: Readonly<Record<string, string>>): void {
  english = new Map([...english, ...Object.entries(entries)])
}

const PLACEHOLDER = /\{(\w+)(?::([^{}|]*)\|([^{}]*))?\}/g

function fill(template: string, params: TextParams): string {
  return template.replace(PLACEHOLDER, (whole, name: string, one: string | undefined, other: string | undefined) => {
    if (!Object.hasOwn(params, name)) return whole
    const value = params[name]
    if (one !== undefined) return value === 1 ? one : (other ?? '')
    return String(value)
  })
}

/** 按指定语言翻译，不看当前语言。 */
export function translate(language: Language, text: string, params?: TextParams): string {
  const template = language === 'en' ? (english.get(text) ?? text) : text
  return params === undefined ? template : fill(template, params)
}

/** 按当前语言翻译。 */
export function t(text: string, params?: TextParams): string {
  return translate(current, text, params)
}

/**
 * 同一句中文在不同地方要译成不同英文时用（比如“置顶”既是按钮又是分组名）：
 * 英文表里的键写成“原文@用处”，没有这个键再按原文查。中文照常显示原文。
 */
export function tc(text: string, usage: string, params?: TextParams): string {
  const key = `${text}@${usage}`
  return current === 'en' && english.has(key) ? translate('en', key, params) : t(text, params)
}

/** 有没有这句的英文译文（检查漏翻用）。 */
export function hasEnglish(text: string): boolean {
  return english.has(text)
}

/** dsh 的界面语言（BCP 47）对应的 dsh-bot 语言：中文的各种写法是中文，别的都用英文。 */
export function languageOf(locale: string | undefined): Language | undefined {
  if (locale === undefined || locale.trim() === '') return undefined
  return /^zh(?:$|[-_])/i.test(locale.trim()) ? 'zh' : 'en'
}

/** 设置是 auto 时跟随 dsh；还不知道 dsh 用什么语言时用中文。 */
export function resolveLanguage(setting: LanguageSetting, host: Language | undefined): Language {
  return setting === 'auto' ? (host ?? 'zh') : setting
}

export function isLanguageSetting(value: unknown): value is LanguageSetting {
  return typeof value === 'string' && (LANGUAGE_SETTINGS as readonly string[]).includes(value)
}

/** 日期、数字格式用的 locale。 */
export function intlLocale(language: Language = current): string {
  return language === 'en' ? 'en-US' : 'zh-CN'
}
