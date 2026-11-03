import { routesFor } from 'pod-store'
import type { PodRuntime } from '../pod.ts'

/** 消息开了或送进了哪个任务（搜索结果里“打开它的任务对话”用）：最早的那次。 */
export function taskOfMessage(pod: PodRuntime, messageId: string): string | null {
  return routesFor(pod.db, messageId).find((route) => route.taskId !== null && (route.route === 'opened' || route.route === 'direct' || route.route === 'relayed'))?.taskId ?? null
}
