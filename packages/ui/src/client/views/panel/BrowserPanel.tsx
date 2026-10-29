import { useEffect, useState } from 'react'
import { t } from 'pod-domain'
import { api, type BrowserOverlay, type TabView } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Avatar, Empty, ErrorBanner, IconButton } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { PanelClose } from '../../components/PanelClose.tsx'
import { useNarrow } from '../../components/media.ts'
import { useApp, type PanelState } from '../../state/app.ts'
import { setBrowserFull, useBrowserFull } from '../../state/browserFull.ts'
import { useResource } from '../../state/resource.ts'
import { AddressBar, BrowserMore, TabControl, TabSwitcher, useTabRun } from '../browser/BrowserBar.tsx'
import { LiveView, type Pointer } from '../browser/LiveView.tsx'
import { ActionLog, DialogOverlay, FileOverlay, SelectOverlay, WaitNotice } from '../browser/Overlays.tsx'
import { OpenUrl } from './BrowserTabs.tsx'

/** 标签页算不算这个对话的：在这个对话里开的，或者是这个 bot 的。没给对话也没给 bot 时全都算。 */
function inScope(tab: TabView, botId: string | null, roomId: string | undefined): boolean {
  if (botId === null && roomId === undefined) return true
  return (roomId !== undefined && tab.roomId === roomId) || (botId !== null && tab.botId === botId)
}

function latest(tabs: readonly TabView[]): TabView | undefined {
  return tabs.reduce<TabView | undefined>((best, tab) => (best === undefined || tab.lastUsedAt > best.lastUsedAt ? tab : best), undefined)
}

/**
 * 浏览器：从右侧滑出，上面一条工具栏，下面全是实时画面；默认 AI 操作，你可以接管，操作完留一句话交还。
 * 工具栏左边切换网页：列出全部网页，这个对话（这个 bot）的排前面，默认选其中最近用过的，没有就选别处最近用过的；
 * 中间是前进后退、网址、谁在操作和“接管”“交还”；右边是开新网页、更多（复制、截图、动作记录、停止）、窗口内全屏和关闭。
 * 窗口内全屏盖住整个窗口，工具栏收成一行，画面按窗口放到最大；Esc 退出。全不全屏记在这台设备上，下次打开还是那样。
 * 上次（dsh web 重启前）你自己开着的网页，打开时按原网址恢复。从详情里放大看进来的（带 back），左上角能返回。
 */
export function BrowserPanel(props: { readonly tabId: string | null; readonly botId: string | null; readonly roomId?: string; readonly back?: PanelState }) {
  const app = useApp()
  const narrow = useNarrow()
  const full = useBrowserFull() && !narrow
  const { data, error } = useResource(app.cache, 'browser', () => api.browser())
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const [overlay, setOverlay] = useState<BrowserOverlay>(null)
  const [pointer, setPointer] = useState<Pointer | null>(null)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [log, setLog] = useState(false)
  const run = useTabRun(setProblem)
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
  useEffect(() => {
    setOverlay(null)
    setLog(false)
  }, [selected?.id])
  useEffect(() => {
    if (saved === 0) return
    setRestoring(true)
    api
      .restoreTabs()
      .then(() => app.cache.invalidate('browser'))
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setRestoring(false))
  }, [app, saved > 0])

  // Esc 先关动作记录，再退出全屏（都比关面板、回详情先一步）。你接管时在画面里按的 Esc 留给网页；
  // 在输入框里按的（网址、开新网页）不算；菜单、弹窗开着时让它们先关。
  useEffect(() => {
    if (!full && !log) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target !== null && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if (target?.closest('.pod-live, .pod-modal, .pod-menu') != null) return
      if (document.querySelector('.pod-modal, .pod-menu') !== null) return
      event.preventDefault()
      if (log) setLog(false)
      else setBrowserFull(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [full, log])

  const back = props.back ?? null
  const show = (tabId: string | null): void => app.openBrowserTab(tabId, props.botId, props.roomId, props.back)
  const opened = (tab: { readonly id: string }): void => {
    setAdding(false)
    app.cache.invalidate('browser')
    show(tab.id)
  }
  const leading = bot === undefined ? <Icon name="browser" size={16} /> : <Avatar bot={bot} size={20} />
  // 手机上关闭变成左上角的返回；从详情进来的左上角已经有返回，关闭还在右上角。
  const closer = <PanelClose label={t('关闭浏览器')} onClose={() => app.closePanel()} stacked={back !== null} />
  const closeFirst = narrow && back === null
  const notes = error !== undefined || problem !== undefined || (data?.status.error ?? '') !== '' || adding

  return (
    <aside className={`pod-panel pod-panel-wide pod-browser-panel${full ? ' pod-panel-full' : ''}`} aria-label={t('浏览器')}>
      <header className="pod-browser-head">
        <div className="pod-browser-head-main">
          {closeFirst ? closer : null}
          {back === null ? null : (
            <button type="button" className="pod-back pod-browser-back" onClick={() => app.navigate({ panel: back })}>
              <Icon name="back" size={16} />
              <span>{t('返回')}</span>
            </button>
          )}
          {selected === undefined ? (
            <span className="pod-browser-title">
              {leading}
              <strong className="pod-ellipsis">{title}</strong>
            </span>
          ) : (
            <TabSwitcher selected={selected} scoped={scoped} others={others} leading={leading} onSelect={show} onAdd={() => setAdding(true)} />
          )}
        </div>
        {selected === undefined ? null : (
          <div className="pod-browser-head-nav">
            <AddressBar tab={selected} onError={setProblem} />
            <TabControl tab={selected} onError={setProblem} />
          </div>
        )}
        <div className="pod-browser-head-tools">
          {selected === undefined ? null : (
            <>
              <IconButton icon="plus" label={t('打开新网页')} onClick={() => setAdding((value) => !value)} />
              <BrowserMore tab={selected} onLog={() => setLog((value) => !value)} onError={setProblem} onClosed={() => show(null)} />
              {narrow ? null : <IconButton icon={full ? 'exit-fullscreen' : 'fullscreen'} label={full ? t('退出全屏（Esc）') : t('窗口内全屏')} onClick={() => setBrowserFull(!full)} />}
            </>
          )}
          {closeFirst ? null : closer}
        </div>
      </header>
      {selected === undefined ? (
        <div className="pod-panel-scroll">
          {error === undefined ? null : <ErrorBanner message={error} />}
          {problem === undefined ? null : <ErrorBanner message={problem} onClose={() => setProblem(undefined)} />}
          {data !== undefined && !data.status.available ? (
            <Empty title={t('没找到本机的 Chrome')}>{t('共用浏览器用本机的 Chrome（dsh-bot 自己的配置文件，不碰你日常的数据）。请安装 Chrome，或者在设置的浏览器页填 Chrome 的位置。')}</Empty>
          ) : null}
          {data?.status.error ? <p className="pod-form-error">{t('浏览器上次出错：{error}', { error: data.status.error })}</p> : null}
          {restoring ? (
            <p className="pod-hint">{t('正在打开上次开着的 {count} 个网页…', { count: saved })}</p>
          ) : (
            <div className="pod-stack">
              <Empty title={t('还没有打开的网页')}>{t('bot 用浏览器时，画面会出现在这里。你也可以先自己开一个网页登录好，所有 bot 共用登录状态。')}</Empty>
              <OpenUrl roomId={props.roomId} onOpened={opened} />
            </div>
          )}
        </div>
      ) : (
        <div className="pod-browser-body">
          {notes ? (
            <div className="pod-browser-notes">
              {error === undefined ? null : <ErrorBanner message={error} />}
              {problem === undefined ? null : <ErrorBanner message={problem} onClose={() => setProblem(undefined)} />}
              {data?.status.error ? <p className="pod-form-error">{t('浏览器上次出错：{error}', { error: data.status.error })}</p> : null}
              {adding ? <OpenUrl roomId={props.roomId} onOpened={opened} autoFocus /> : null}
            </div>
          ) : null}
          <div className="pod-browser-stage">
            <LiveView tabId={selected.id} controlled={selected.controller === 'owner'} pointer={pointer} onOverlay={setOverlay} onError={setProblem} />
            {selected.waitId === null || selected.controller === 'owner' ? null : <WaitNotice ownerName={selected.ownerName} onTakeover={() => run(api.takeover(selected.id))} />}
            {log && selected.actions.length > 0 ? <ActionLog actions={selected.actions} onClose={() => setLog(false)} /> : null}
            {overlay?.kind === 'select' ? <SelectOverlay tabId={selected.id} overlay={overlay} onClose={() => setOverlay(null)} /> : null}
            {selected.dialog === null ? null : <DialogOverlay key={selected.dialog.message} tabId={selected.id} dialog={selected.dialog} controlled={selected.controller === 'owner'} />}
            {selected.fileChooser && selected.controller === 'owner' ? <FileOverlay tabId={selected.id} /> : null}
          </div>
        </div>
      )}
    </aside>
  )
}
