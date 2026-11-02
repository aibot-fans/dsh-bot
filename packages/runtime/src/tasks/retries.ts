/** 模型临时出错后隔多久重试：第 1、2、3 次；3 次都不行就停下等你。 */
export const RETRY_DELAYS_MS: readonly number[] = [5_000, 60_000, 300_000]

interface RetryState {
  readonly count: number
  readonly timer: ReturnType<typeof setTimeout> | undefined
}

/**
 * 任务会话碰上模型临时出错（dsh 自己的几次快速重试也用完了）：隔一会儿再叫它接着做，不算催促。
 * 从 5 秒退避到 300 秒，最多 3 次；某一轮正常结束就重新计数。
 */
export class ModelRetries {
  private readonly states = new Map<string, RetryState>()

  /** 排下一次重试，到点调 retry；返回这是第几次，次数用完返回 undefined（不再排）。 */
  schedule(taskId: string, retry: (count: number) => void): number | undefined {
    const previous = this.states.get(taskId)
    if (previous?.timer !== undefined) clearTimeout(previous.timer)
    const count = (previous?.count ?? 0) + 1
    const delay = RETRY_DELAYS_MS[count - 1]
    if (delay === undefined) {
      this.states.delete(taskId)
      return undefined
    }
    const timer = setTimeout(() => {
      this.states.set(taskId, { count, timer: undefined })
      retry(count)
    }, delay)
    timer.unref()
    this.states.set(taskId, { count, timer })
    return count
  }

  /** 正常结束了一轮，或者任务停了、结束了：不再重试，重新计数。 */
  clear(taskId: string): void {
    const state = this.states.get(taskId)
    if (state?.timer !== undefined) clearTimeout(state.timer)
    this.states.delete(taskId)
  }

  /** Pod 停止时取消还没到点的重试；重启后的恢复提醒会接上。 */
  dispose(): void {
    for (const state of this.states.values()) if (state.timer !== undefined) clearTimeout(state.timer)
    this.states.clear()
  }
}
