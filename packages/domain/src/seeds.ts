import { currentLanguage, type Language } from './i18n.ts'

/**
 * dsh-bot 自己建的 bot（Super-agent、X 情报员）的默认人设，按版本留着。
 * 人设还是哪一版默认的原文（你没改过），出了新版就直接换上；你改过的不动，在 bot 详情里显示“默认已更新”，看过差异再选保留还是换新。
 */
export interface SeedText {
  readonly zh: string
  readonly en: string
}

export interface SeedPersona {
  /** 记在 bot 上的种子名：lead、x。 */
  readonly id: string
  /** 从第 1 版排起；改默认就在末尾加一版。 */
  readonly versions: readonly SeedText[]
  /** 有这套机制以前发出去的最后一版：改过的人设记不清是从哪版改的，就按这版算。 */
  readonly released: number
}

/** bot 详情里的“默认已更新”：你改过人设以后，默认又出了新版。 */
export interface SeedUpdate {
  readonly base: number
  readonly latest: number
  /** 你改的时候的默认（这个语言的）。 */
  readonly before: string
  /** 现在的默认。 */
  readonly after: string
}

export function seedLatest(seed: SeedPersona): number {
  return seed.versions.length
}

/** 某一版默认人设；没有这一版返回 undefined。 */
export function seedText(seed: SeedPersona, version: number = seedLatest(seed), language: Language = currentLanguage()): string | undefined {
  const entry = seed.versions[version - 1]
  return entry === undefined ? undefined : entry[language]
}

/** 人设是哪一版默认的原文（哪种语言都算），取最新的那版；都不是返回 undefined。 */
export function seedVersionOf(seed: SeedPersona, persona: string): number | undefined {
  const index = seed.versions.findLastIndex((entry) => entry.zh === persona || entry.en === persona)
  return index < 0 ? undefined : index + 1
}
