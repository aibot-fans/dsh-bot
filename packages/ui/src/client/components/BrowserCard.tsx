import { t } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { mediaUrl } from '../api/http.ts'
import { useApp } from '../state/app.ts'
import { useResource } from '../state/resource.ts'
import { Badge, Button } from './common.tsx'

/** 对话里的浏览器卡片：缩略图、网址和状态；点“查看”从右侧滑出实时画面，点“接管”直接自己操作。 */
export function BrowserCard(props: { readonly tabId: string; readonly botId: string; readonly fallback: string }) {
  const app = useApp()
  const { data } = useResource(app.cache, 'browser', () => api.browser())
  const tab = data?.tabs.find((item) => item.id === props.tabId)
  if (data !== undefined && tab === undefined) {
    return (
      <div className="pod-line pod-line-notice">
        <span>{t('{fallback}（这个标签页已经关了）', { fallback: props.fallback })}</span>
      </div>
    )
  }
  const view = (): void => app.openBrowserTab(props.tabId, props.botId)
  return (
    <div className="pod-browser-card">
      <button type="button" className="pod-browser-card-shot" onClick={view} aria-label={t('查看实时画面')}>
        {tab === undefined ? null : <img src={mediaUrl('/browser/thumb', { tabId: props.tabId, v: String(tab.lastUsedAt) })} alt="" />}
      </button>
      <div className="pod-browser-card-main">
        <strong className="pod-ellipsis">{tab?.title || props.fallback}</strong>
        <span className="pod-muted-inline pod-ellipsis">{tab?.url ?? ''}</span>
        <span className="pod-row">
          {tab?.controller === 'owner' ? <Badge tone="warn">{t('你在操作')}</Badge> : tab?.waitId !== null && tab !== undefined ? <Badge tone="warn">{t('等你接管')}</Badge> : <Badge tone="info">{t('AI 操作中')}</Badge>}
        </span>
        <span className="pod-row">
          <Button small onClick={view}>
            {t('查看')}
          </Button>
          {tab?.controller === 'owner' ? null : (
            <Button
              small
              kind="primary"
              onClick={() => {
                void api
                  .takeover(props.tabId)
                  .then(() => app.cache.invalidate('browser'))
                  .catch(() => undefined)
                view()
              }}
            >
              {t('接管')}
            </Button>
          )}
        </span>
      </div>
    </div>
  )
}
