import { useState } from 'react'
import type { PodSettings } from 'pod-domain'
import { errorText } from '../../api/http.ts'
import { updateApi } from '../../api/update.ts'
import { Button, RelativeTime, Switch } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { Row, type Update } from '../settings/Row.tsx'

/** 设置 → 高级里的“新版本”：现在检查一次，以及要不要自动检查。查到新版就打开更新弹窗。 */
export function UpdateRow(props: { readonly settings: PodSettings; readonly update: Update }) {
  const app = useApp()
  const { data: status } = useResource(app.cache, 'update', () => updateApi.status())
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [checking, setChecking] = useState(false)
  const check = (): void => {
    setProblem(undefined)
    setChecking(true)
    updateApi
      .check()
      .then((next) => {
        app.cache.invalidate('update')
        if (next.target !== null || next.waiting !== null) app.openUpdate()
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setChecking(false))
  }
  const summary =
    problem ??
    (status === undefined ? null : status.checking || checking ? (
      '正在检查…'
    ) : status.target !== null ? (
      <button type="button" className="pod-link" onClick={() => app.openUpdate()}>
        有新版本 {status.target}
      </button>
    ) : status.error !== null ? (
      status.error
    ) : status.checkedAt === null ? (
      '还没检查过'
    ) : (
      <>
        已是最新版 · <RelativeTime time={status.checkedAt} />检查
      </>
    ))
  return (
    <Row label="新版本" hint="每隔几小时问一次 npm 有没有新版本，只发包名">
      <span className="pod-muted-inline">{summary}</span>
      <Button small disabled={checking || status?.checking === true} onClick={check}>
        现在检查
      </Button>
      <Switch checked={props.settings.checkUpdates} label="自动检查新版本" onChange={(checkUpdates) => props.update({ checkUpdates })} />
    </Row>
  )
}
