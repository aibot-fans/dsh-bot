import { useMemo, useState } from 'react'
import { t } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { pageApi } from '../../api/pages.ts'
import { Button, Empty, ErrorBanner } from '../../components/common.tsx'
import { useNarrow } from '../../components/media.ts'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { PageFrame } from './PageFrame.tsx'
import { PageThread } from './PageThread.tsx'
import { PageVersions } from './PageVersions.tsx'
import { useSurfaceTheme } from './theme.ts'
import { ViewerHead } from './ViewerHead.tsx'

type SideTab = 'edit' | 'versions'

/**
 * 页面查看器：中间的对话换成它。左边是沙箱里的页面，右边是修改对话和版本列表；
 * bot 存了新版，页面自动刷新到最新版（正在预览旧版时不打断）。
 * 手机上页面占满，修改和版本收起来，点顶上的按钮才在下半屏打开（看旧版时默认打开）。
 */
export function PageViewer(props: { readonly pageId: string; readonly version: number | undefined }) {
  const app = useApp()
  const theme = useSurfaceTheme()
  const narrow = useNarrow()
  const [tab, setTab] = useState<SideTab>(props.version === undefined ? 'edit' : 'versions')
  const [sideOpen, setSideOpen] = useState(props.version !== undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const { data: detail, error } = useResource(app.cache, `page:${props.pageId}`, () => pageApi.detail(props.pageId))
  const { data: botList } = useResource(app.cache, 'bots', () => api.bots())
  const bots = useMemo(() => new Map((botList ?? []).map((bot) => [bot.id, bot])), [botList])

  if (detail === undefined) {
    return (
      <main className="pod-convo pod-viewer">
        {error === undefined ? (
          <Empty title={t('正在打开页面…')} />
        ) : (
          <Empty title={t('打不开这个页面')}>
            <p className="pod-muted">{error}</p>
            <Button onClick={() => app.closePage()}>{t('回到对话')}</Button>
          </Empty>
        )}
      </main>
    )
  }
  const { page, versions } = detail
  const viewing = props.version !== undefined && versions.some((item) => item.version === props.version) ? props.version : page.version
  const deleted = page.deletedAt !== null
  const run = (work: Promise<unknown>, after?: () => void): void => {
    setBusy(true)
    setProblem(undefined)
    work
      .then(() => {
        app.cache.invalidate('pages')
        app.cache.invalidate(`page:${page.id}`)
        after?.()
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  const restore = (version: number): void => {
    if (window.confirm(t('把第 {version} 版的内容存成新的一版？现在的版本也会留着。', { version }))) run(pageApi.rollback(page.id, version), () => app.openPage(page.id))
  }

  return (
    <main className="pod-convo pod-viewer">
      <ViewerHead page={page} viewing={viewing} theme={theme} onError={setProblem} side={narrow ? { open: sideOpen, toggle: () => setSideOpen((value) => !value) } : undefined} />
      {problem === undefined ? null : (
        <div className="pod-viewer-banner">
          <ErrorBanner message={problem} onClose={() => setProblem(undefined)} />
        </div>
      )}
      {deleted ? (
        <div className="pod-viewer-banner pod-row">
          <span className="pod-muted pod-grow">{t('这个页面在回收站里，30 天后彻底删除。')}</span>
          <Button small icon="restore" disabled={busy} onClick={() => run(pageApi.restore(page.id))}>
            {t('恢复')}
          </Button>
        </div>
      ) : null}
      <div className={`pod-viewer-body${narrow && !sideOpen ? ' pod-viewer-body-full' : ''}`}>
        <div className="pod-viewer-frame">
          <PageFrame id={page.id} version={viewing === page.version ? undefined : viewing} latest={page.version} theme={theme} title={page.title} />
        </div>
        <aside className="pod-viewer-side" aria-label={t('修改和版本')}>
          <div className="pod-viewer-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'edit'} className={tab === 'edit' ? 'pod-panel-tab-on' : undefined} onClick={() => setTab('edit')}>
              {t('修改')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'versions'} className={tab === 'versions' ? 'pod-panel-tab-on' : undefined} onClick={() => setTab('versions')}>
              {t('版本 {length}', { length: versions.length })}
            </button>
          </div>
          {tab === 'edit' ? (
            <PageThread key={page.id} page={page} bots={bots} disabled={deleted} />
          ) : (
            <div className="pod-viewer-side-scroll">
              <PageVersions page={page} versions={versions} viewing={viewing} bots={bots} busy={busy || deleted} onPreview={(version) => app.openPage(page.id, version)} onRestore={restore} />
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}
