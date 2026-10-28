import { ok } from 'pod-domain'
import type { PodRuntime } from '../pod.ts'
import { get, post, type RouteSpec } from './router.ts'

/** X 账号：设置页看 dsh-bot 浏览器里登录的是谁，点“检查”重新看一遍。登录在浏览器面板里自己登。 */
export function xRoutes(pod: PodRuntime): readonly RouteSpec[] {
  return [get('/x/status', () => ok(pod.x.account.status())), post('/x/check', async () => ok(await pod.x.account.check()))]
}
