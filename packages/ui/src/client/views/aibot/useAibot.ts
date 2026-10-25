import { useEffect } from 'react'
import type { AibotStatus } from 'pod-domain'
import { aibotApi } from '../../api/aibot.ts'
import { useApp } from '../../state/app.ts'
import { useResource, type ResourceState } from '../../state/resource.ts'

/** aibot 的状态：设置页、用量页、首次引导共用一份；每次打开时读一次最新的额度。 */
export function useAibot(): ResourceState<AibotStatus> {
  const app = useApp()
  const resource = useResource(app.cache, 'aibot', () => aibotApi.status(true))
  const { reload } = resource
  const cached = resource.data !== undefined
  useEffect(() => {
    // 第一次打开时 useResource 自己会拉；已经有旧数据时才强制再读一次。
    if (cached) reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload])
  return resource
}
