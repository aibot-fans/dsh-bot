import { useSyncExternalStore } from 'react'

/** 中间对话区的宽度：窄（默认）、宽、铺满。手机上总是铺满，不看这个。 */
export type ChatWidth = 'narrow' | 'wide' | 'full'

const KEY = 'pod-ui/chat-width'
const listeners = new Set<() => void>()

function read(): ChatWidth {
  try {
    const value = globalThis.localStorage?.getItem(KEY)
    return value === 'wide' || value === 'full' ? value : 'narrow'
  } catch {
    // 隐私模式下 localStorage 不可用，用默认的窄。
    return 'narrow'
  }
}

let current: ChatWidth = read()

/** 存在这台设备上：大屏和笔记本各用各的。 */
export function setChatWidth(value: ChatWidth): void {
  current = value
  try {
    globalThis.localStorage?.setItem(KEY, value)
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

export function useChatWidth(): ChatWidth {
  return useSyncExternalStore(subscribe, () => current, () => current)
}
