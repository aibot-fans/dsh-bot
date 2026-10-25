import { useState } from 'react'
import type { Bot } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Badge, Button, Drawer, RelativeTime } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  user: '你改的',
  lead: '主管改的',
  auto: '自我优化',
  rollback: '回滚',
  seed: '初始',
}

/** 配置版本：人设、模型、工具档案每次修改都留一版，任何一版都能回滚。 */
export function Versions(props: { readonly bot: Bot; readonly onClose: () => void }) {
  const app = useApp()
  const { data: versions, error, reload } = useResource(app.cache, `versions:${props.bot.id}`, () => api.botVersions(props.bot.id))
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const rollback = (version: number): void => {
    if (!window.confirm(`把「${props.bot.name}」回滚到第 ${version} 版？会追加一版“回滚”，历史不会丢。`)) return
    api
      .rollbackBot(props.bot.id, version)
      .then(() => {
        reload()
        app.cache.invalidate('bots')
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  return (
    <Drawer title={`「${props.bot.name}」的配置版本`} onClose={props.onClose}>
      {error === undefined ? null : <p className="pod-form-error">{error}</p>}
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
      <ol className="pod-versions">
        {(versions ?? []).map((version, index) => (
          <li key={version.id}>
            <div className="pod-row">
              <strong>第 {version.version} 版</strong>
              <Badge>{SOURCE_LABELS[version.source] ?? version.source}</Badge>
              <span className="pod-muted-inline">
                <RelativeTime time={version.createdAt} />
              </span>
              {index === 0 ? <Badge tone="ok">当前</Badge> : null}
            </div>
            <div className="pod-muted">{version.reason}</div>
            <details>
              <summary>人设</summary>
              <p className="pod-pre">{String(version.config.persona ?? '')}</p>
            </details>
            {index === 0 ? null : (
              <Button small kind="quiet" icon="restore" onClick={() => rollback(version.version)}>
                回滚到这一版
              </Button>
            )}
          </li>
        ))}
      </ol>
    </Drawer>
  )
}
