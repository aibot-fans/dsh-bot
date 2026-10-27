import { useEffect, useSyncExternalStore } from 'react'
import { isLanguageSetting, languageOf, resolveLanguage, setLanguage, type Language, type LanguageSetting } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import type { AppState } from './app.ts'
import { useResource } from './resource.ts'

/** 页面拿 dsh 界面语言的办法：每次现取，dsh 的语言插件就算比 dsh-bot 晚就绪也不要紧。 */
export interface HostLocale {
  readonly get: () => string | undefined
  readonly subscribe: (listener: () => void) => () => void
}

const SETTING_KEY = 'pod-ui.language'

/** 上次看到的语言设置：设置还没拉回来时先照它显示，选了英文的人不会先闪一下中文。 */
function storedSetting(): LanguageSetting {
  try {
    const value = globalThis.localStorage?.getItem(SETTING_KEY)
    return isLanguageSetting(value) ? value : 'auto'
  } catch {
    return 'auto'
  }
}

function remember(setting: LanguageSetting): void {
  try {
    globalThis.localStorage?.setItem(SETTING_KEY, setting)
  } catch {
    // 存不了（无痕窗口等）就算了，只是下次打开时可能先闪一下默认语言。
  }
}

/**
 * 页面现在用的语言：设置里选了中文或英文就用它，选“跟随 dsh”时用 dsh 的界面语言。
 * 顺带把 dsh 的界面语言报给宿主：宿主的系统消息和 bot 回答也要跟着它。
 */
export function useLanguage(app: AppState, host: HostLocale): Language {
  const { data: settings } = useResource(app.cache, 'settings', () => api.settings())
  const hostLocale = useSyncExternalStore(host.subscribe, host.get)
  const setting = settings?.language ?? storedSetting()
  const language = resolveLanguage(setting, languageOf(hostLocale))
  // 在渲染子组件之前切过去：t() 读的是这个全局语言。
  setLanguage(language)
  useEffect(() => {
    if (settings !== undefined) remember(settings.language)
  }, [settings?.language])
  useEffect(() => {
    if (hostLocale === undefined || hostLocale === '') return
    // 宿主的语言因为这次上报变了（比如第一次打开）：之前拉到的默认 bot 名字这些还是旧语言的，全部重新拉。
    void api
      .reportLocale(hostLocale)
      .then((result) => {
        if (result.changed) app.cache.invalidateAll()
      })
      .catch(() => undefined)
  }, [hostLocale])
  return language
}
