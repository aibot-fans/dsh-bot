import { t } from 'pod-domain'
import { computerApi } from '../api/computer.ts'
import { useComputerRun } from '../views/computer/ComputerControl.tsx'
import { useApp } from '../state/app.ts'
import { useResource } from '../state/resource.ts'
import { Badge, Button } from './common.tsx'
import { Icon } from './Icon.tsx'

/** 对话里的电脑卡片：bot 开始用电脑时放进来；点“查看”从右侧滑出应用窗口的实时画面，点“接管”让 bot 先停手。 */
export function ComputerCard(props: { readonly botId: string; readonly fallback: string }) {
  const app = useApp()
  const { data: status } = useResource(app.cache, 'computer', () => computerApi.status())
  const run = useComputerRun(() => undefined)
  const user = status?.user ?? null
  const using = user !== null && user.botId === props.botId
  const view = (): void => app.openComputer()
  return (
    <div className="pod-browser-card">
      <button type="button" className="pod-browser-card-shot pod-computer-card-shot" onClick={view} aria-label={t('查看实时画面')}>
        <Icon name="computer" size={36} />
      </button>
      <div className="pod-browser-card-main">
        <strong className="pod-ellipsis">{props.fallback}</strong>
        <span className="pod-muted-inline pod-ellipsis">{using ? (user.last?.label ?? user.taskTitle) : ''}</span>
        <span className="pod-row">{!using ? <Badge tone="muted">{t('用完了')}</Badge> : user.takenOver ? <Badge tone="warn">{t('你在操作')}</Badge> : <Badge tone="info">{t('AI 操作中')}</Badge>}</span>
        <span className="pod-row">
          <Button small onClick={view}>
            {t('查看')}
          </Button>
          {using && !user.takenOver ? (
            <Button
              small
              kind="primary"
              onClick={() => {
                run(computerApi.takeover())
                view()
              }}
            >
              {t('接管')}
            </Button>
          ) : null}
        </span>
      </div>
    </div>
  )
}
