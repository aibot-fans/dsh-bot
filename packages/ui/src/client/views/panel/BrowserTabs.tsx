import { useState } from 'react'
import { t, type RoomSummary, type TabInfo } from 'pod-domain'
import { api, type TabView } from '../../api/endpoints.ts'
import { errorText, mediaUrl } from '../../api/http.ts'
import { Badge, Button, Empty } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

/** 打开网址：输网址或搜索词（没写 https:// 的会补上，搜索词用必应搜），回车或点“打开”。autoFocus：一出来就能打字。 */
export function OpenUrl(props: { readonly roomId?: string; readonly onOpened: (tab: TabInfo) => void; readonly autoFocus?: boolean }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const open = (): void => {
    if (url.trim() === '' || busy) return
    setBusy(true)
    setProblem(undefined)
    api
      .openTab(url.trim(), props.roomId === undefined ? {} : { roomId: props.roomId })
      .then((tab) => {
        setUrl('')
        props.onOpened(tab)
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  return (
    <div className="pod-stack-tight">
      <div className="pod-row">
        <input
          className="pod-input"
          autoFocus={props.autoFocus}
          placeholder={t('输网址或要搜的词，例如 example.com')}
          aria-label={t('打开网址')}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && !event.nativeEvent.isComposing && open()}
        />
        <Button icon="plus" disabled={busy || url.trim() === ''} onClick={open}>
          {t('打开')}
        </Button>
      </div>
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
    </div>
  )
}

/** 标签页列表：缩略图、谁在操作、标题；点开放大看，AI 在用的可以直接接管。 */
export function TabList(props: { readonly tabs: readonly TabView[]; readonly onOpen: (tab: TabView) => void }) {
  return (
    <div className="pod-stack">
      {props.tabs.map((tab) => (
        <article key={tab.id} className="pod-computer">
          <button type="button" className="pod-computer-shot" onClick={() => props.onOpen(tab)} aria-label={t('放大看')}>
            <img src={mediaUrl('/browser/thumb', { tabId: tab.id, v: String(tab.lastUsedAt) })} alt={t('{value} 的画面', { value: tab.title || tab.url })} />
          </button>
          <div className="pod-row pod-wrap">
            {tab.controller === 'owner' ? <Badge tone="warn">{t('你在操作')}</Badge> : tab.waitId !== null ? <Badge tone="warn">{t('等你接管')}</Badge> : <Badge tone="info">{t('{ownerName}在用', { ownerName: tab.ownerName })}</Badge>}
            <span className="pod-ellipsis pod-muted-inline">{tab.title || tab.url}</span>
          </div>
          <div className="pod-row">
            {tab.controller === 'owner' ? null : (
              <Button
                small
                kind="primary"
                onClick={() => {
                  void api.takeover(tab.id).catch(() => undefined)
                  props.onOpen(tab)
                }}
              >
                {t('接管')}
              </Button>
            )}
            <Button small onClick={() => props.onOpen(tab)}>
              {t('放大看')}
            </Button>
          </div>
        </article>
      ))}
    </div>
  )
}

/** 群聊详情的“浏览器”页：群里的 bot 打开的网页、你在这里开的网页；也能在这里开一个新的。放大看的浏览器左上角能回到这里。 */
export function GroupBrowser(props: { readonly room: RoomSummary }) {
  const app = useApp()
  const { data, error } = useResource(app.cache, 'browser', () => api.browser())
  const tabs = (data?.tabs ?? []).filter((tab) => tab.roomId === props.room.id)
  const show = (tabId: string): void => app.openBrowserTab(tabId, null, props.room.id, { kind: 'group', roomId: props.room.id, tab: 'browser' })
  if (error !== undefined) return <p className="pod-form-error">{error}</p>
  if (data !== undefined && !data.status.available) return <Empty title={t('没找到本机的 Chrome')}>{t('共用浏览器用本机的 Chrome。请安装 Chrome，或者在设置的浏览器页填 Chrome 的位置。')}</Empty>
  return (
    <div className="pod-stack">
      <OpenUrl
        roomId={props.room.id}
        onOpened={(tab) => {
          app.cache.invalidate('browser')
          show(tab.id)
        }}
      />
      {tabs.length === 0 ? <Empty title={t('这个群现在没有打开的网页')}>{t('群里的 bot 用浏览器时，画面会出现在这里；你也可以在上面开一个，所有 bot 共用登录状态。')}</Empty> : <TabList tabs={tabs} onOpen={(tab) => show(tab.id)} />}
    </div>
  )
}
