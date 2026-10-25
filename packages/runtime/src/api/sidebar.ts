import { EMPTY_SIDEBAR, ok, parseSidebarPrefs } from 'pod-domain'
import { readState, writeState } from 'pod-store'
import type { PodRuntime } from '../pod.ts'
import { get, post, type RouteSpec } from './router.ts'

const SIDEBAR_KEY = 'ui.sidebar'

/** 侧栏的整理（分组、归档、收起的分组）：存在 Pod 的状态表里，跟着数据走，换个浏览器也还在。 */
export function sidebarRoutes(pod: PodRuntime): readonly RouteSpec[] {
  return [
    get('/sidebar', () => ok(parseSidebarPrefs(readState<unknown>(pod.db, SIDEBAR_KEY, EMPTY_SIDEBAR)))),
    post('/sidebar', (body) => {
      const prefs = parseSidebarPrefs(body)
      writeState(pod.db, SIDEBAR_KEY, prefs)
      return ok(prefs)
    }),
  ]
}
