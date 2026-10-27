import { RUNTIME_EN_LABELS } from './en-labels.ts'
import { RUNTIME_EN_MESSAGES } from './en-messages.ts'
import { RUNTIME_EN_NOTICES } from './en-notices.ts'

/** pod-runtime 里给人看的文字（系统消息、卡片、接口报错）的英文译文，键是代码里的中文原文。 */
export const RUNTIME_EN: Readonly<Record<string, string>> = { ...RUNTIME_EN_MESSAGES, ...RUNTIME_EN_NOTICES, ...RUNTIME_EN_LABELS }
