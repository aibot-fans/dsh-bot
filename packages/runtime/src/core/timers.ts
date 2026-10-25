import type { Disposer } from '../dsh.ts'

/** 插件生命周期：Cordis 的 ctx.effect，卸载或热替换时执行返回的清理函数。 */
export interface Lifecycle {
  effect(execute: () => Disposer, label?: string): unknown
}

/**
 * 每隔 ms 跑一次 work；上一次还没跑完就跳过这一拍。
 * 定时器 unref，不会因为它拖住进程退出。
 */
export function every(lifecycle: Lifecycle, label: string, ms: number, work: () => void | Promise<void>, onError: (error: unknown) => void): void {
  lifecycle.effect(() => {
    let running = false
    const tick = async (): Promise<void> => {
      if (running) return
      running = true
      try {
        await work()
      } catch (error) {
        onError(error)
      } finally {
        running = false
      }
    }
    const timer = setInterval(() => void tick(), ms)
    timer.unref()
    return () => clearInterval(timer)
  }, label)
}

/** 延迟一次；返回取消函数。 */
export function later(ms: number, work: () => void): () => void {
  const timer = setTimeout(work, ms)
  timer.unref()
  return () => clearTimeout(timer)
}
