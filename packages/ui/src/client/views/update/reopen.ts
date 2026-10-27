import type { Layout } from '../../dsh.ts'

const KEY = 'pod-ui.reopen-after-update'
/** 记号放太久就不算了：可能是很早以前的一次更新。 */
const FRESH_MS = 30 * 60_000
const RETRY_MS = 250
const TRIES = 40

/** 这个标签页点了一键更新：新版的页面加载后把 dsh-bot 打开。 */
export function markReopen(): void {
  try {
    globalThis.sessionStorage?.setItem(KEY, String(Date.now()))
  } catch {
    // 隐私模式下 sessionStorage 不可用，新版装好后自己点侧栏的 dsh-bot。
  }
}

function takeMark(): boolean {
  try {
    const marked = globalThis.sessionStorage?.getItem(KEY)
    if (marked === null || marked === undefined) return false
    globalThis.sessionStorage?.removeItem(KEY)
    return Date.now() - Number(marked) < FRESH_MS
  } catch {
    return false
  }
}

/**
 * 一键更新时 dsh 卸下旧版的页面、装上新版后，侧栏不会自己回到 dsh-bot，刷新后也停在 dsh 的首页。
 * 这个标签页刚点过一键更新的话，新版（或者装回来的旧版）一加载就选中 dsh-bot 的面板。dsh 的布局服务可能晚一点才有，等一会儿。
 */
export function reopenAfterUpdate(layout: () => Layout | undefined, panelId: string): () => void {
  if (!takeMark()) return () => {}
  let tries = 0
  const timer = setInterval(() => {
    tries += 1
    const current = layout()
    if (current !== undefined) current.selectPanel(panelId)
    if (current !== undefined || tries >= TRIES) clearInterval(timer)
  }, RETRY_MS)
  return () => clearInterval(timer)
}
