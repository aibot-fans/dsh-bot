import { useEffect, useState } from 'react'
import { t } from 'pod-domain'
import { api, type BrowserOverlay, type TabView } from '../../api/endpoints.ts'
import { errorText, mediaUrl } from '../../api/http.ts'
import { Avatar, Badge, Button, Empty, ErrorBanner, IconButton, clock } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { PanelClose } from '../../components/PanelClose.tsx'
import { copyText } from '../../components/clipboard.ts'
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
      <IconButton icon="back" label={t('后退')} disabled={!controlled} onClick={() => run(api.tabHistory(tab.id, 'back'))} />
      <IconButton icon="forward" label={t('前进')} disabled={!controlled} onClick={() => run(api.tabHistory(tab.id, 'forward'))} />
      <IconButton icon="refresh" label={t('刷新')} disabled={!controlled} onClick={() => run(api.tabHistory(tab.id, 'reload'))} />
      <input
        className="pod-input"
        value={address}
        readOnly={!controlled}
        aria-label={t('地址栏')}
        title={controlled ? undefined : t('接管后才能输网址')}
        onChange={(event) => setAddress(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && controlled) run(api.navigateTab(tab.id, address))
        }}
      />
      <IconButton icon="copy" label={t('复制页面里选中的文字')} onClick={() => run(api.tabSelection(tab.id).then((text) => copyText(text)))} />
      <IconButton icon="image" label={t('截图')} onClick={() => window.open(mediaUrl('/browser/screenshot', { tabId: tab.id }), '_blank', 'noopener')} />
    </div>
  )
}

/** 底部的控制区：AI 操作时可以接管或关掉这个标签页；你在操作时留一句话交还。关掉以后 onClosed 换到别的标签页。 */
function Control(props: { readonly tab: TabView; readonly onError: (message: string) => void; readonly onClosed: () => void }) {
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
          <Badge tone="warn">{t('你在操作')}</Badge>
          <span className="pod-muted-inline">{t('点画面、滚动、打字都会直接作用到网页{value}', { value: botTab ? t('，{ownerName}在等你交还', { ownerName: tab.ownerName }) : '' })}</span>
        </span>
        {botTab ? (
          <div className="pod-row">
            <input className="pod-input" placeholder={t('交还时留一句话，例如“已登录”')} value={note} onChange={(event) => setNote(event.target.value)} aria-label={t('交还时留的话')} />
            <Button kind="primary" onClick={() => run(api.handback(tab.id, note), () => setNote(''))}>
              {t('交还给{ownerName}', { ownerName: tab.ownerName })}
            </Button>
          </div>
        ) : (
          <div className="pod-row">
            <Button
              kind="quiet"
              onClick={() => {
                if (window.confirm(t('关掉这个标签页？'))) run(api.closeTab(tab.id), props.onClosed)
              }}
            >
              {t('关闭标签页')}
            </Button>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="pod-browser-control">
      <span className="pod-row">
        <Badge tone="info">{t('AI 操作中')}</Badge>
        <span className="pod-muted-inline">{t('你只看不动；{ownerName}要点的位置会在画面上标出来', { ownerName: tab.ownerName })}</span>
      </span>
      <div className="pod-row">
        <Button kind="primary" onClick={() => run(api.takeover(tab.id))}>
          {t('接管')}
        </Button>
        <Button
          kind="quiet"
          onClick={() => {
            if (window.confirm(t('停止这个标签页？{ownerName}要重新打开才能继续用。', { ownerName: tab.ownerName }))) run(api.closeTab(tab.id), props.onClosed)
          }}
        >
          {t('停止这个标签页')}
        </Button>
      </div>
    </div>
  )
}

/** 标签页算不算这个对话的：在这个对话里开的，或者是这个 bot 的。没给对话也没给 bot 时全都算。 */
function inScope(tab: TabView, botId: string | null, roomId: string | undefined): boolean {
  if (botId === null && roomId === undefined) return true
  return (roomId !== undefined && tab.roomId === roomId) || (botId !== null && tab.botId === botId)
}

function latest(tabs: readonly TabView[]): TabView | undefined {
  return tabs.reduce<TabView | undefined>((best, tab) => (best === undefined || tab.lastUsedAt > best.lastUsedAt ? tab : best), undefined)
}

/** 标签条上的一个标签页：标题，下面一行是在做的任务或谁开的。 */
function TabChip(props: { readonly tab: TabView; readonly active: boolean; readonly onSelect: () => void }) {
  const { tab } = props
  return (
    <button type="button" role="tab" aria-selected={props.active} className={`pod-tabchip${props.active ? ' pod-tabchip-active' : ''}`} onClick={props.onSelect}>
      <span className="pod-tabchip-text">
        <span className="pod-ellipsis">{tab.title || tab.url || t('新标签页')}</span>
        <span className="pod-tabchip-meta pod-ellipsis">{tab.taskTitle !== '' ? tab.taskTitle : tab.ownerName}</span>
      </span>
      {tab.waitId !== null ? <Badge tone="warn">{t('等你接管')}</Badge> : null}
      {tab.loading ? <span className="pod-tabchip-loading" aria-label={t('加载中')} /> : null}
    </button>
  )
}

/**
 * 浏览器：从右侧滑出，有地址栏和实时画面；默认 AI 操作，你可以接管，操作完留一句话交还。
 * 从对话顶部打开时列出全部标签页，这个对话（这个 bot）的排前面，默认选其中最近用过的，没有就选别处最近用过的；
 * 右上角的 + 在这个对话里开新网页。上次（dsh web 重启前）你自己开着的网页，打开时按原网址恢复。
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
  const [restoring, setRestoring] = useState(false)
  const all = data?.tabs ?? []
  const saved = data?.status.available === true ? data.status.saved : 0
  const pinned = all.find((tab) => tab.id === props.tabId)
  const room = props.roomId === undefined ? undefined : rooms?.find((item) => item.id === props.roomId)
  const scoped = all.filter((tab) => inScope(tab, props.botId, props.roomId))
  const others = all.filter((tab) => !inScope(tab, props.botId, props.roomId))
  const selected = pinned ?? latest(scoped) ?? latest(others)
  const bot = props.botId === null ? undefined : bots?.find((item) => item.id === props.botId)
  const title = bot !== undefined ? t('{name}的浏览器', { name: bot.name }) : room !== undefined ? t('「{title}」的浏览器', { title: room.title }) : t('浏览器')

  useEffect(() => app.onPointer((tabId, point) => (tabId === selected?.id ? setPointer({ ...point, at: Date.now() }) : undefined)), [app, selected?.id])
  useEffect(() => setOverlay(null), [selected?.id])
  useEffect(() => {
    if (saved === 0) return
    setRestoring(true)
    api
      .restoreTabs()
      .then(() => app.cache.invalidate('browser'))
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setRestoring(false))
  }, [app, saved > 0])

  const show = (tabId: string | null): void => app.openBrowserTab(tabId, props.botId, props.roomId)
  const opened = (tab: { readonly id: string }): void => {
    setAdding(false)
    app.cache.invalidate('browser')
    show(tab.id)
  }

  return (
    <aside className="pod-panel pod-panel-wide" aria-label={t('浏览器')}>
      <div className="pod-panel-top pod-panel-top-row">
        {bot === undefined ? <Icon name="browser" size={18} /> : <Avatar bot={bot} size={28} />}
        <strong className="pod-ellipsis">{title}</strong>
        <span className="pod-grow" />
        {selected === undefined ? null : <IconButton icon="plus" label={t('打开新网页')} onClick={() => setAdding((value) => !value)} />}
        <PanelClose label={t('关闭浏览器')} onClose={() => app.closePanel()} />
      </div>
      <div className="pod-panel-scroll">
        {error === undefined ? null : <ErrorBanner message={error} />}
        {problem === undefined ? null : <ErrorBanner message={problem} onClose={() => setProblem(undefined)} />}
        {data !== undefined && !data.status.available ? (
          <Empty title={t('没找到本机的 Chrome')}>{t('共用浏览器用本机的 Chrome（dsh-bot 自己的配置文件，不碰你日常的数据）。请安装 Chrome，或者在设置的浏览器页填 Chrome 的位置。')}</Empty>
        ) : null}
        {data?.status.error ? <p className="pod-form-error">{t('浏览器上次出错：{error}', { error: data.status.error })}</p> : null}
        {adding && selected !== undefined ? <OpenUrl roomId={props.roomId} onOpened={opened} /> : null}
        {all.length > 1 || others.length > 0 ? (
          <div className="pod-tabstrip" role="tablist">
            {scoped.map((tab) => (
              <TabChip key={tab.id} tab={tab} active={tab.id === selected?.id} onSelect={() => show(tab.id)} />
            ))}
            {others.length === 0 ? null : (
              <>
                {scoped.length === 0 ? null : <span className="pod-tabstrip-sep" role="separator" />}
                <span className="pod-tabstrip-label">{t('其他对话')}</span>
              </>
            )}
            {others.map((tab) => (
              <TabChip key={tab.id} tab={tab} active={tab.id === selected?.id} onSelect={() => show(tab.id)} />
            ))}
          </div>
        ) : null}
        {selected === undefined ? (
          restoring ? (
            <p className="pod-hint">{t('正在打开上次开着的 {count} 个网页…', { count: saved })}</p>
          ) : (
            <div className="pod-stack">
              <Empty title={t('还没有打开的网页')}>{t('bot 用浏览器时，画面会出现在这里。你也可以先自己开一个网页登录好，所有 bot 共用登录状态。')}</Empty>
              <OpenUrl roomId={props.roomId} onOpened={opened} />
            </div>
          )
        ) : (
          <div className="pod-stack">
            <AddressBar tab={selected} onError={setProblem} />
            <div className="pod-live-wrap">
              <LiveView tabId={selected.id} controlled={selected.controller === 'owner'} pointer={pointer} onOverlay={setOverlay} onError={setProblem} />
              {overlay?.kind === 'select' ? <SelectOverlay tabId={selected.id} overlay={overlay} onClose={() => setOverlay(null)} /> : null}
              {selected.dialog === null ? null : <DialogOverlay key={selected.dialog.message} tabId={selected.id} dialog={selected.dialog} controlled={selected.controller === 'owner'} />}
              {selected.fileChooser && selected.controller === 'owner' ? <FileOverlay tabId={selected.id} /> : null}
            </div>
            <Control tab={selected} onError={setProblem} onClosed={() => show(null)} />
            {selected.waitId === null ? null : <p className="pod-hint">{t('{ownerName}请你接管：登录或验证完点“交还”，可以附一句话。', { ownerName: selected.ownerName })}</p>}
            {selected.actions.length === 0 ? null : (
              <details className="pod-browser-log">
                <summary>{t('动作记录（{length}）', { length: selected.actions.length })}</summary>
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
