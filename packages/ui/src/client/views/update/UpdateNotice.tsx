import { useEffect } from 'react'
import { POD_VERSION } from 'pod-domain'
import { updateApi } from '../../api/update.ts'
import { Button } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { showUpdateOverlay } from './overlay.ts'

/**
 * 更新完以后（要重启的，重启以后）在顶上说一声换成了哪一版。更新做到一半刷新了页面，接着显示进度框。
 * 这个标签页还是旧版页面时不说：那时顶上已经提示刷新了。
 */
export function UpdateNotice() {
  const app = useApp()
  const { data: status } = useResource(app.cache, 'update', () => updateApi.status())
  const job = status?.job ?? null
  const running = job !== null && job.outcome === null
  const to = job?.to
  useEffect(() => {
    if (running && to !== undefined) showUpdateOverlay(to)
  }, [running, to])
  if (status === undefined || job === null || job.outcome !== 'done' || status.current !== POD_VERSION) return null
  return (
    <div className="pod-banner pod-banner-action pod-banner-ok">
      <span>dsh-bot 已经更新到 {job.to}。</span>
      <span className="pod-banner-buttons">
        <Button small onClick={() => app.openUpdate()}>
          更新了什么
        </Button>
        <Button small kind="primary" onClick={() => void updateApi.dismiss().then(() => app.cache.invalidate('update'), () => undefined)}>
          知道了
        </Button>
      </span>
    </div>
  )
}
