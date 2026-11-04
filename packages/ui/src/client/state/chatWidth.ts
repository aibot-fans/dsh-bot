import { useSyncExternalStore, type CSSProperties } from 'react'

/** 中间对话区的宽度：像素，或者铺满。在对话区右边缘拖出来；手机上总是铺满，不看这个。 */
export type ChatWidth = number | 'full'

export const CHAT_WIDTH_DEFAULT = 780
export const CHAT_WIDTH_MIN = 520
const CHAT_WIDTH_MAX = 2400
/** 卡片（任务卡、页面卡这些）最宽到这么多，铺满时也一样。 */
const CARD_MAX = 960

const KEY = 'pod-ui/chat-width'
const listeners = new Set<() => void>()

/** 以前存的是“窄、宽、铺满”，照原来的宽度换成像素。 */
function parse(value: string | null | undefined): ChatWidth {
  if (value === 'full') return 'full'
  if (value === 'wide') return 1080
  const number = Number(value)
  return value !== null && value !== undefined && value !== '' && Number.isFinite(number) ? clampWidth(number) : CHAT_WIDTH_DEFAULT
}

export function clampWidth(value: number): number {
  return Math.round(Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, value)))
}

function read(): ChatWidth {
  try {
    return parse(globalThis.localStorage?.getItem(KEY))
  } catch {
    // 隐私模式下 localStorage 不可用，用默认宽度。
    return CHAT_WIDTH_DEFAULT
  }
}

let current: ChatWidth = read()

function emit(): void {
  for (const listener of listeners) listener()
}

/** 拖动的时候跟着变，松手时再用 saveChatWidth 存下来。 */
export function previewChatWidth(value: ChatWidth): void {
  current = value
  emit()
}

/** 存在这台设备上：大屏和笔记本各用各的。 */
export function setChatWidth(value: ChatWidth): void {
  current = value
  try {
    globalThis.localStorage?.setItem(KEY, String(value))
  } catch {
    // 存不下就只在这次打开时有效。
  }
  emit()
}

/** 把拖出来的宽度存下来。 */
export function saveChatWidth(): void {
  setChatWidth(current)
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

/** 对话区上的宽度变量：对话那一列最宽多少，卡片跟着按比例放宽（最多 960）。 */
export function chatWidthStyle(width: ChatWidth): CSSProperties {
  const chat = width === 'full' ? '100%' : `${width}px`
  const card = width === 'full' ? `${CARD_MAX}px` : `${Math.min(CARD_MAX, Math.round(width * 0.82))}px`
  return { '--pod-chat-max': chat, '--pod-card-max': card } as CSSProperties
}
