import { t } from 'pod-domain'

/**
 * 你以前怎么定的（运行时记在那句话上，data.decided）：那句话后面留的那行小字。
 * 现在交了就算做完，不再有“收下”“重试”这些按钮，旧消息上的照旧显示。
 */
export function decidedText(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  switch ((value as Readonly<Record<string, unknown>>).action) {
    case 'accept':
      return t('你收下了')
    case 'retry':
    case 'resume':
      return t('你让它重试了')
    case 'stop':
    case 'cancel':
      return t('你说不做了')
    default:
      return undefined
  }
}
