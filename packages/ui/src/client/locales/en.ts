import { UI_EN_CHAT } from './en-chat.ts'
import { UI_EN_CORE } from './en-core.ts'
import { UI_EN_EXTRA } from './en-extra.ts'
import { UI_EN_PANELS } from './en-panels.ts'
import { UI_EN_SETTINGS } from './en-settings.ts'
import { UI_EN_UPDATE } from './en-update.ts'
import { UI_EN_X } from './en-x.ts'

/** 界面文字的英文译文，键是代码里的中文原文；按界面区域分在几个文件里。 */
export const UI_EN: Readonly<Record<string, string>> = { ...UI_EN_CORE, ...UI_EN_CHAT, ...UI_EN_PANELS, ...UI_EN_SETTINGS, ...UI_EN_UPDATE, ...UI_EN_EXTRA, ...UI_EN_X }
