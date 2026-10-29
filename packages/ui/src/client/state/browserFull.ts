import { useSyncExternalStore } from 'react'

/** 浏览器是不是窗口内全屏：上次全屏关的，下次打开还是全屏。手机上浏览器本来就占满整屏，不看这个。 */
const KEY = 'pod-ui/browser-full'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === '1'
  } catch {
    // 隐私模式下 localStorage 不可用，默认不全屏。
    return false
  }
}

let current = read()

/** 存在这台设备上：大屏和笔记本各用各的。 */
export function setBrowserFull(value: boolean): void {
  current = value
  try {
    globalThis.localStorage?.setItem(KEY, value ? '1' : '0')
  } catch {
    // 存不下就只在这次打开时有效。
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useBrowserFull(): boolean {
  return useSyncExternalStore(subscribe, () => current, () => current)
}
