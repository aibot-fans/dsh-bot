import { ok, readString } from 'pod-domain'
import type { PodRuntime } from '../pod.ts'
import { get, post, type RouteSpec } from './router.ts'

/**
 * 新版本提醒和一键更新。只读模式下也能用（升级 dsh-bot 正是解决接口对不上的办法），所以都不算写操作。
 * 一键更新马上返回，之后看 /update 的 job。
 */
export function updateRoutes(pod: PodRuntime): readonly RouteSpec[] {
  return [
    get('/update', () => ok(pod.updates.status())),
    post('/update/check', async () => ok(await pod.updates.check()), { writes: false }),
    post('/update/apply', (input) => pod.updates.apply(readString(input, 'version')), { writes: false }),
    post('/update/dismiss', () => ok(pod.updates.dismiss()), { writes: false }),
  ]
}
