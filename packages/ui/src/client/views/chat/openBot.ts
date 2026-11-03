import { createContext, useContext, useMemo } from 'react'
import { useApp } from '../../state/app.ts'

/**
 * 在对话里点了某个 bot（头像、名字、@ 到的名字）怎么办。不给是在右边打开它的详情（群里是成员卡片）；
 * 右边的任务小窗里没有详情那一栏，换成放大成全屏再看它。
 */
export const OpenBotContext = createContext<((botId: string) => void) | null>(null)

export function useOpenBot(): (botId: string) => void {
  const app = useApp()
  const custom = useContext(OpenBotContext)
  return useMemo(() => custom ?? ((botId: string) => app.showMember(botId)), [app, custom])
}
