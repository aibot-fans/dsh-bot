import { fail, ok, readString, t } from 'pod-domain'
import { bindText } from '../aibot/errors.ts'
import type { PodRuntime } from '../pod.ts'
import { get, post, type RouteSpec } from './router.ts'

/** aibot 接入：设置页和用量页的状态、重试、绑定账号（只在 aibot 开放绑定时用到）。Key 和安装码不出现在任何返回里。 */
export function aibotRoutes(pod: PodRuntime): readonly RouteSpec[] {
  return [
    get('/aibot/status', async (query) => ok(readString(query, 'refresh') === '1' ? await pod.aibot.latest() : pod.aibot.status())),
    post('/aibot/retry', async () => ok(await pod.aibot.retry())),
    post('/aibot/bind/start', async () => {
      try {
        return ok(await pod.aibot.bindStart())
      } catch (error) {
        return fail('conflict', bindText(error))
      }
    }),
    get('/aibot/bind/poll', async (query) => {
      const id = readString(query, 'id')
      if (id === '') return fail('invalid-input', t('缺少绑定申请的 id'))
      try {
        return ok(await pod.aibot.bindPoll(id))
      } catch (error) {
        return fail('conflict', bindText(error))
      }
    }),
  ]
}
