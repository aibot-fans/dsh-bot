import { useEffect } from 'react'
import type { AppState, NavState } from './app.ts'

/** 手机上叠了几层：对话（或页面）、右侧详情、抽屉、任务详情、设置、搜索，各算一层；停在列表上是 0。 */
function depthOf(nav: NavState): number {
  return [nav.roomId !== null || nav.page !== null, nav.panel !== null, nav.drawer !== null, nav.taskId !== null, nav.settings !== null, nav.search !== null].filter(Boolean).length
}

/** 系统的返回（安卓返回键、iOS 边缘右滑）：关掉最上面那一层。 */
function closeTop(app: AppState): void {
  const nav = app.getNav()
  if (nav.search !== null) app.navigate({ search: null })
  else if (nav.settings !== null) app.navigate({ settings: null })
  else if (nav.taskId !== null) app.navigate({ taskId: null })
  else if (nav.drawer !== null) app.navigate({ drawer: null })
  else if (nav.panel !== null) app.closePanel()
  else if (nav.page !== null) app.closePage()
  else app.showList()
}

/**
 * 手机上让系统的返回在 Pod 里一层一层往回退，而不是直接离开 dsh。
 * 进了任何一层就往浏览器历史里压一条（网址不变，dsh 不看历史），按返回时关掉最上面那一层，还没退到列表就再压一条；
 * 在界面上点返回退到列表时，把压的那条也退掉。宽屏不管。
 */
export function useMobileBack(app: AppState, narrow: boolean): void {
  useEffect(() => {
    if (!narrow || typeof window === 'undefined') return
    // 刷新前压的那条不算：退回它前面那条会重新加载整页，只能在这个页面里自己压的条目之间退。
    let armed = false
    let skip = 0
    const arm = (): void => {
      window.history.pushState({ pod: true }, '')
      armed = true
    }
    const sync = (): void => {
      const depth = depthOf(app.getNav())
      if (depth > 0 && !armed) arm()
      if (depth === 0 && armed) {
        armed = false
        skip += 1
        window.history.back()
      }
    }
    const onPop = (): void => {
      if (skip > 0) {
        skip -= 1
        return
      }
      if (!armed) return
      // 关掉一层以后还没退到列表，sync 会再压一条。
      armed = false
      closeTop(app)
    }
    window.addEventListener('popstate', onPop)
    const stop = app.subscribeNav(sync)
    sync()
    return () => {
      stop()
      window.removeEventListener('popstate', onPop)
      // 离开 Pod（换到 dsh 别的页面、变成宽屏）时把压的那条退掉，不留一次没反应的返回。
      if (armed) window.history.back()
    }
  }, [app, narrow])
}
