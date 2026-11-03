/** 用电脑（computer-use）：bot 做任务时在后台读写这台 Mac 上别的应用的窗口，不占用你的鼠标键盘。 */

/**
 * 小助手（开源项目 Comma 的 macOS 应用，随 dsh-bot 一起装）现在怎样：
 * - unsupported：不是 macOS，或者系统低于 14；
 * - missing：这份 dsh-bot 里没带（从源码装、还没编小助手）；
 * - ready：可以用。
 */
export type ComputerHelperState = 'unsupported' | 'missing' | 'ready'

/** 小助手要的两项系统权限：辅助功能（读窗口、点按钮）和屏幕录制（截窗口的图、推画面）。 */
export interface ComputerPermissions {
  readonly accessibility: boolean
  readonly screenRecording: boolean
}

/** 正在用电脑的任务。 */
export interface ComputerUser {
  readonly botId: string
  /** 任务（整棵树的根）。 */
  readonly taskId: string
  readonly taskTitle: string
  /** 这个任务批准过的应用。 */
  readonly apps: readonly string[]
  /** 画面跟着的应用：bot 最近看的那个，还没看过就是批准的第一个。 */
  readonly app: string | null
  /** 你接管了：bot 先停手，等你交还。 */
  readonly takenOver: boolean
  /** bot 最近一步做了什么。 */
  readonly last: { readonly label: string; readonly at: number } | null
}

export interface ComputerStatus {
  readonly state: ComputerHelperState
  readonly message: string
  /** 小助手报的系统权限；还没问过是 null。 */
  readonly permissions: ComputerPermissions | null
  /** 现在谁在用电脑；没人用是 null。 */
  readonly user: ComputerUser | null
  /** 小助手放在哪。 */
  readonly appPath: string
}
