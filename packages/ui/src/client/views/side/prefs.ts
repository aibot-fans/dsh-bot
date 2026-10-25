import { EMPTY_SIDEBAR, type SidebarPrefs } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

export interface SidebarStore {
  readonly prefs: SidebarPrefs
  readonly save: (change: (prefs: SidebarPrefs) => SidebarPrefs) => void
}

/** 侧栏整理（分组、归档、收起）：先在页面上改，马上生效，再存到 Pod；存失败就重新拉一次。 */
export function useSidebarPrefs(): SidebarStore {
  const app = useApp()
  const { data } = useResource(app.cache, 'sidebar', () => api.sidebar())
  const save = (change: (prefs: SidebarPrefs) => SidebarPrefs): void => {
    const next = change(app.cache.snapshot<SidebarPrefs>('sidebar').data ?? EMPTY_SIDEBAR)
    app.cache.update<SidebarPrefs>('sidebar', () => next)
    api
      .saveSidebar(next)
      .then((saved) => app.cache.update<SidebarPrefs>('sidebar', () => saved))
      .catch(() => app.cache.invalidate('sidebar'))
  }
  return { prefs: data ?? EMPTY_SIDEBAR, save }
}

/** 新分组的 id：时间加随机数，够用了。 */
export function folderId(): string {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
