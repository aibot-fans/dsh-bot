/** aibot（X 数据和监控）接入：设置页、用量页、首次引导和 X 监控群聊共用的数据。 */

/**
 * 接入现在的情况：
 * - off：你在设置里关掉了；
 * - starting：正在开通或者连接；
 * - ready：能用；
 * - waiting：开通被限流或 aibot 暂停开通，到 retryAt 再试；
 * - disabled：这台 Pod 的接入被 aibot 停用了（不会自己重新开通）；
 * - error：网络之类的问题，稍后自动重试。
 */
export type AibotState = 'off' | 'starting' | 'ready' | 'waiting' | 'disabled' | 'error'

export interface AibotDailyFree {
  readonly limit: number
  readonly used: number
  readonly remaining: number
  /** 下次恢复的时间（毫秒）。 */
  readonly resetAt: number | null
  /** disabled：免费额度停用；fuse：全站今天的上限到了；null：正常。 */
  readonly pausedReason: string | null
}

export interface AibotMonitor {
  readonly accountLimit: number
  readonly activeSubscriptionCount: number
  /** 设备 30 天没连 aibot，监控被暂停了；再调用一次接口就会恢复。 */
  readonly pausedBySystem: boolean
}

export interface AibotStatus {
  readonly enabled: boolean
  readonly state: AibotState
  /** 给你看的一句话：现在怎样、为什么、什么时候再试。 */
  readonly message: string
  /** Key 的末尾几位，界面上只显示这些。 */
  readonly keyTail: string
  /** device：免登录的设备账号；account：绑定过正式账号。 */
  readonly accountKind: 'device' | 'account' | null
  /** 绑定后的账号名（打了码）。 */
  readonly accountDisplay: string | null
  readonly dailyFree: AibotDailyFree | null
  readonly monitor: AibotMonitor | null
  /** 只有 aibot 开放绑定（或者开了开发开关）时才显示“绑定账号”。 */
  readonly bindAvailable: boolean
  /** 装进 bot 会话的 X 工具数。 */
  readonly tools: number
  /** 实时事件流：connected 连着，idle 没有监控所以不连，retrying 断了正在重连。 */
  readonly stream: 'connected' | 'idle' | 'retrying' | 'off'
  /** 下次自动重试的时间（毫秒）。 */
  readonly retryAt: number | null
  /** X 监控群聊。 */
  readonly roomId: string | null
  /** 最近一次拿到设备状态的时间。 */
  readonly checkedAt: number | null
}

/** 绑定账号的一次申请：在网页上核对 code。 */
export interface AibotBind {
  readonly id: string
  readonly code: string
  readonly url: string
  readonly expiresAt: number | null
  readonly pollIntervalSeconds: number
}

export interface AibotBindResult {
  readonly status: 'pending' | 'approved' | 'denied' | 'expired'
  readonly accountDisplay: string | null
}

/** X 监控群聊里一条事件消息的 data.xEvent。 */
export interface XEventView {
  readonly id: string
  readonly type: string
  readonly screenName: string
  readonly name: string
  readonly avatarUrl: string
  readonly title: string
  readonly summary: string
  readonly url: string
  readonly tweetText: string
  readonly tweetUrl: string
  readonly media: readonly string[]
  readonly eventTime: number | null
}

/** 事件类型的中文名。 */
export const X_EVENT_LABELS: Readonly<Record<string, string>> = {
  tweetOriginal: '发推',
  tweetReply: '回复',
  tweetQuote: '引用',
  tweetDeleted: '删推',
  followNew: '新关注',
  followerNew: '新粉丝',
  profileAvatarBanner: '换头像或横幅',
  profileBioName: '改简介或名字',
  profilePinned: '换置顶',
}

/** 摘要和标题、推文原文重复（摘要常常就是截短的原文）时不再单独显示。 */
export function xEventSummary(view: XEventView): string {
  const summary = view.summary.trim()
  if (summary === '' || summary === view.title.trim()) return ''
  const head = summary.replace(/(…|\.\.\.)$/, '')
  return view.tweetText !== '' && view.tweetText.startsWith(head) ? '' : summary
}

/** 重置时间按北京时间显示，例如 08:00。 */
export function beijingClock(time: number): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(time))
}
