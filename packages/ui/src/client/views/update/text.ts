import { RELEASES_URL, type UpdateStep } from 'pod-domain'

// 这里的话都是中文原文，在用的地方用 t() 翻译。

/** 一键更新每一步给你看的话。 */
export const STEP_TEXT: Readonly<Record<UpdateStep, string>> = {
  removing: '正在卸下旧版…',
  installing: '正在下载、安装新版…',
  restoring: '新版没装上，正在装回原来的版本…',
}

export const RESTART_TEXT = '在运行 dsh web 的终端里按 Ctrl+C 停掉它，再运行 dsh web，就换成新版了。'

export const HMR_TEXT = '更新时 dsh-bot 先卸下旧版再装新版，中间有一小会儿用不了；bot、对话和任务都在数据目录里，不受影响。'

export const SOURCE_STEPS = ['git pull', 'pnpm install', 'pnpm build'] as const

/** {PACKAGE_NAME} 换成包名。 */
export const MANUAL_TEXT = '这个 dsh 没有插件管理服务，不能一键更新：在 dsh 的插件页里卸掉 dsh-bot，再装 {PACKAGE_NAME}。数据不受影响。'

export function releaseUrl(version: string): string {
  return `${RELEASES_URL}/tag/v${version}`
}
