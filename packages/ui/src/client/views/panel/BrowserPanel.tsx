import { useEffect, useState } from 'react'
import { api, type BrowserOverlay, type TabView } from '../../api/endpoints.ts'
import { errorText, mediaUrl } from '../../api/http.ts'
import { Avatar, Badge, Button, Empty, ErrorBanner, IconButton, clock } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { LiveView, type Pointer } from '../browser/LiveView.tsx'
import { DialogOverlay, FileOverlay, SelectOverlay } from '../browser/Overlays.tsx'
import { OpenUrl } from './BrowserTabs.tsx'

/** 地址栏：你接管时能前进后退、刷新、输网址。 */
function AddressBar(props: { readonly tab: TabView; readonly onError: (message: string) => void }) {
  const { tab } = props
  const controlled = tab.controller === 'owner'
  const [address, setAddress] = useState(tab.url)
  useEffect(() => setAddress(tab.url), [tab.url])
  const run = (work: Promise<unknown>): void => {
    work.catch((reason: unknown) => props.onError(errorText(reason)))
  }
  return (
    <div className="pod-browser-bar">
      <IconButton icon="back" label="后退" disabled={!controlled} onClick={() => run(api.tabHistory(tab.id, 'back'))} />
      <IconButton icon="forward" label="前进" disabled={!controlled} onClick={() => run(api.tabHistory(tab.id, 'forward'))} />
      <IconButton icon="refresh" label="刷新" disabled={!controlled} onClick={() => run(api.tabHistory(tab.id, 'reload'))} />
      <input
        className="pod-input"
        value={address}
        readOnly={!controlled}
        aria-label="地址栏"
        title={controlled ? undefined : '接管后才能输网址'}
        onChange={(event) => setAddress(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && controlled) run(api.navigateTab(tab.id, address))
        }}
      />
      <IconButton icon="copy" label="复制页面里选中的文字" onClick={() => run(api.tabSelection(tab.id).then((text) => navigator.clipboard?.writeText(text)))} />
      <IconButton icon="image" label="截图" onClick={() => window.open(mediaUrl('/browser/screenshot', { tabId: tab.id }), '_blank', 'noopener')} />
    </div>
  )
}

/** 底部的控制区：AI 操作时可以接管或关掉这个标签页；你在操作时留一句话交还。 */
function Control(props: { readonly tab: TabView; readonly onError: (message: string) => void }) {
  const { tab } = props
  const app = useApp()
  const [note, setNote] = useState('')
  const run = (work: Promise<unknown>, after?: () => void): void => {
    work
      .then(() => {
        app.cache.invalidate('browser')
        after?.()
      })
      .catch((reason: unknown) => props.onError(errorText(reason)))
  }
  const botTab = tab.owner.kind === 'bot'
  if (tab.controller === 'owner') {
    return (
      <div className="pod-browser-control">
        <span className="pod-row">
          <Badge tone="warn">你在操作</Badge>
          <span className="pod-muted-inline">点画面、滚动、打字都会直接作用到网页{botTab ? `，${tab.ownerName}在等你交还` : ''}</span>
        </span>
        {botTab ? (
          <div className="pod-row">
            <input className="pod-input" placeholder="交还时留一句话，例如“已登录”" value={note} onChange={(event) => setNote(event.target.value)} aria-label="交还时留的话" />
            <Button kind="primary" onClick={() => run(api.handback(tab.id, note), () => setNote(''))}>
              交还给{tab.ownerName}
            </Button>
          </div>
        ) : (
          <div className="pod-row">
            <Button
              kind="quiet"
              onClick={() => {
                if (window.confirm('关掉这个标签页？')) run(api.closeTab(tab.id), () => app.openBrowserTab(null))
              }}
            >
              关闭标签页
            </Button>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="pod-browser-control">
      <span className="pod-row">
        <Badge tone="info">AI 操作中</Badge>
        <span className="pod-muted-inline">你只看不动；{tab.ownerName}要点的位置会在画面上标出来</span>
      </span>
      <div className="pod-row">
        <Button kind="primary" onClick={() => run(api.takeover(tab.id))}>
          接管
        </Button>
        <Button
          kind="quiet"
          onClick={() => {
            if (window.confirm(`停止这个标签页？${tab.ownerName}要重新打开才能继续用。`)) run(api.closeTab(tab.id), () => app.openBrowserTab(null, props.tab.botId))
          }}
        >
          停止这个标签页
        </Button>
      </div>
    </div>
  )
}

/**
 * 浏览器：从右侧滑出，有地址栏和实时画面；默认 AI 操作，你可以接管，操作完留一句话交还。
 * 从 bot 打开时只列它的标签页，从群聊打开时只列这个群的；右上角的 + 开新网页。
 */
export function BrowserPanel(props: { readonly tabId: string | null; readonly botId: string | null; readonly roomId?: string }) {
  const app = useApp()
  const { data, error } = useResource(app.cache, 'browser', () => api.browser())
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const [overlay, setOverlay] = useState<BrowserOverlay>(null)
  const [pointer, setPointer] = useState<Pointer | null>(null)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  const all = data?.tabs ?? []
  const pinned = all.find((tab) => tab.id === props.tabId)
  const room = props.roomId === undefined ? undefined : rooms?.find((item) => item.id === props.roomId)
  const owner = props.roomId === undefined ? (props.botId ?? pinned?.botId ?? null) : null
  const tabs = props.roomId !== undefined ? all.filter((tab) => tab.roomId === props.roomId) : owner === null ? all : all.filter((tab) => tab.botId === owner)
  const selected = pinned ?? tabs[0]
  const bot = owner === null ? undefined : bots?.find((item) => item.id === owner)
  const title = room !== undefined ? `「${room.title}」的浏览器` : bot === undefined ? '浏览器' : `${bot.name}的浏览器`

  useEffect(() => app.onPointer((tabId, point) => (tabId === selected?.id ? setPointer({ ...point, at: Date.now() }) : undefined)), [app, selected?.id])
  useEffect(() => setOverlay(null), [selected?.id])

  const opened = (tab: { readonly id: string }): void => {
    setAdding(false)
    app.cache.invalidate('browser')
    app.openBrowserTab(tab.id, null, props.roomId)
  }

  return (
    <aside className="pod-panel pod-panel-wide" aria-label="浏览器">
      <div className="pod-panel-top pod-panel-top-row">
        {bot === undefined ? <Icon name="browser" size={18} /> : <Avatar bot={bot} size={28} />}
        <strong className="pod-ellipsis">{title}</strong>
        <span className="pod-grow" />
        {selected === undefined ? null : <IconButton icon="plus" label="打开新网页" onClick={() => setAdding((value) => !value)} />}
        <button type="button" className="pod-round" aria-label="关闭浏览器" title="关闭" onClick={() => app.closePanel()}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="pod-panel-scroll">
        {error === undefined ? null : <ErrorBanner message={error} />}
        {problem === undefined ? null : <ErrorBanner message={problem} onClose={() => setProblem(undefined)} />}
        {data !== undefined && !data.status.available ? (
          <Empty title="没找到本机的 Chrome">共用浏览器用本机的 Chrome（Pod 自己的配置文件，不碰你日常的数据）。请安装 Chrome，或者在设置的浏览器页填 Chrome 的位置。</Empty>
        ) : null}
        {data?.status.error ? <p className="pod-form-error">浏览器上次出错：{data.status.error}</p> : null}
        {adding && selected !== undefined ? <OpenUrl roomId={props.roomId} onOpened={opened} /> : null}
        {tabs.length > 1 ? (
          <div className="pod-tabstrip" role="tablist">
            {tabs.map((tab) => (
              <button key={tab.id} type="button" role="tab" aria-selected={tab.id === selected?.id} className={`pod-tabchip${tab.id === selected?.id ? ' pod-tabchip-active' : ''}`} onClick={() => app.openBrowserTab(tab.id, owner, props.roomId)}>
                <span className="pod-tabchip-text">
                  <span className="pod-ellipsis">{tab.title || tab.url || '新标签页'}</span>
                  <span className="pod-tabchip-meta pod-ellipsis">{tab.taskTitle !== '' ? tab.taskTitle : tab.ownerName}</span>
                </span>
                {tab.waitId !== null ? <Badge tone="warn">等你接管</Badge> : null}
                {tab.loading ? <span className="pod-tabchip-loading" aria-label="加载中" /> : null}
              </button>
            ))}
          </div>
        ) : null}
        {selected === undefined ? (
          <div className="pod-stack">
            <Empty title={bot === undefined ? '还没有打开的网页' : `${bot.name}现在没有打开网页`}>bot 用浏览器时，画面会出现在这里。你也可以先自己开一个网页登录好，所有 bot 共用登录状态。</Empty>
            <OpenUrl roomId={props.roomId} onOpened={opened} />
          </div>
        ) : (
          <div className="pod-stack">
            <AddressBar tab={selected} onError={setProblem} />
            <div className="pod-live-wrap">
              <LiveView tabId={selected.id} controlled={selected.controller === 'owner'} pointer={pointer} onOverlay={setOverlay} onError={setProblem} />
              {overlay?.kind === 'select' ? <SelectOverlay tabId={selected.id} overlay={overlay} onClose={() => setOverlay(null)} /> : null}
              {selected.dialog === null ? null : <DialogOverlay key={selected.dialog.message} tabId={selected.id} dialog={selected.dialog} controlled={selected.controller === 'owner'} />}
              {selected.fileChooser && selected.controller === 'owner' ? <FileOverlay tabId={selected.id} /> : null}
            </div>
            <Control tab={selected} onError={setProblem} />
            {selected.waitId === null ? null : <p className="pod-hint">{selected.ownerName}请你接管：登录或验证完点“交还”，可以附一句话。</p>}
            {selected.actions.length === 0 ? null : (
              <details className="pod-browser-log">
                <summary>动作记录（{selected.actions.length}）</summary>
                <ol className="pod-browser-actions">
                  {[...selected.actions].reverse().map((action) => (
                    <li key={`${action.at}-${action.text}`}>
                      <span className="pod-muted-inline">{clock(action.at)}</span> {action.text}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
