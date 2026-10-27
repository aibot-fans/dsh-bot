import type { DatabaseSync } from 'node:sqlite'
import { fail, languageOf, ok, resolveLanguage, setLanguage, t, type Language, type PodResult, type PodSettings } from 'pod-domain'
import { readState, writeState } from 'pod-store'

/** 页面上报的 dsh 界面语言：设置是“跟随 dsh”时宿主照它说话，没开页面时（例程、简报）也用它。 */
const HOST_KEY = 'locale.host'

type LanguageListener = (next: Language, previous: Language) => void

/**
 * 宿主这边的当前语言：设置里选了中文或英文就用它，选“跟随 dsh”时用 dsh 的界面语言。
 * dsh 的界面语言只有页面知道（用户在 dsh 设置里选的，没选就按浏览器），所以由页面上报，记在库里。
 */
export class LanguageService {
  private host: Language | undefined
  private current: Language
  private readonly listeners = new Set<LanguageListener>()
  private readonly db: DatabaseSync
  private readonly settings: () => PodSettings

  constructor(db: DatabaseSync, settings: () => PodSettings) {
    this.db = db
    this.settings = settings
    this.host = languageOf(readState<string>(db, HOST_KEY, ''))
    this.current = resolveLanguage(settings().language, this.host)
    setLanguage(this.current)
  }

  get(): Language {
    return this.current
  }

  /**
   * 页面上报 dsh 现在的界面语言（BCP 47，例如 zh、en-US）。
   * changed 是这次上报有没有让语言变了：页面第一次打开时事件流可能还没连上，收不到变化通知，要靠它自己重新拉数据。
   */
  reportHost(locale: unknown): PodResult<{ readonly language: Language; readonly changed: boolean }> {
    const host = typeof locale === 'string' ? languageOf(locale) : undefined
    if (host === undefined) return fail('invalid-input', t('不认识这个语言'))
    if (host !== this.host) {
      this.host = host
      writeState(this.db, HOST_KEY, host)
    }
    const previous = this.current
    this.refresh()
    return ok({ language: this.current, changed: this.current !== previous })
  }

  /** 设置或 dsh 的语言变了以后重算，变了就通知。 */
  refresh(): void {
    const next = resolveLanguage(this.settings().language, this.host)
    if (next === this.current) return
    const previous = this.current
    this.current = next
    setLanguage(next)
    for (const listener of this.listeners) listener(next, previous)
  }

  onChange(listener: LanguageListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
