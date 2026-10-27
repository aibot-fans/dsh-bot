import { DOMAIN_EN_LABELS } from './en-labels.ts'
import { DOMAIN_EN_MESSAGES } from './en-messages.ts'

/** pod-domain 里给人看的文字的英文译文，键是代码里的中文原文；宿主和页面都会先登记这一份。 */
export const DOMAIN_EN: Readonly<Record<string, string>> = { ...DOMAIN_EN_LABELS, ...DOMAIN_EN_MESSAGES }
