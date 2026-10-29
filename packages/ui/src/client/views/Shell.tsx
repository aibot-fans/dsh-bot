import { Fragment, useEffect, useRef, useState } from 'react'
import { POD_VERSION, compareVersions, t } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { Button } from '../components/common.tsx'
import { useNarrow } from '../components/media.ts'
import { TooltipLayer } from '../components/Tooltip.tsx'
import { AppContext, AppState, useApp, useNav, type HostActions } from '../state/app.ts'
import { pruneDrafts } from '../state/drafts.ts'
import { useKeyboardInset } from '../state/keyboard.ts'
import { useLanguage, type HostLocale } from '../state/language.ts'
import { useMobileBack } from '../state/mobileBack.ts'
import { useResource } from '../state/resource.ts'
import { Conversation } from './chat/Conversation.tsx'
import { Onboarding } from './Onboarding.tsx'
import { PageViewer } from './pages/PageViewer.tsx'
import { useSurfaceTheme } from './pages/theme.ts'
import { Drawers } from './panel/Drawers.tsx'
import { RightPanel } from './panel/RightPanel.tsx'
import { SearchDialog } from './search/SearchDialog.tsx'
import { SettingsModal } from './settings/SettingsModal.tsx'
import { Sidebar } from './side/Sidebar.tsx'
import { UpdateDialog } from './update/UpdateDialog.tsx'
import { UpdateNotice } from './update/UpdateNotice.tsx'

function ReadOnlyBanner() {
  const app = useApp()
  const { data: status } = useResource(app.cache, 'status', () => api.status())
  if (status === undefined) return null
  if (status.exposure?.exposed === true) {
    return <div className="pod-banner">{t('dsh web 现在对外开放（{reasons}）。为了安全，dsh-bot 禁用了 bot 的终端和浏览器写操作；建议只在本机或 Tailscale 内使用。', { reasons: status.exposure.reasons.join(t('；')) })}</div>
  }
  if (!status.readOnly) return null
  return (
    <div className="pod-banner">
      {t('dsh-bot 处于只读模式：当前 dsh（{dshVersion}）缺少 dsh-bot 需要的接口（{problems}）。可以查看数据，但不会创建会话或派活。', { dshVersion: status.dshVersion, problems: status.problems.join(t('、')) })}
    </div>
  )
}

/**
 * 页面和宿主的版本对不上。多半是标签页在 Pod 更新前打开的：旧页面调的接口可能已经换了，提示刷新。宿主重启后事件流会让页面重新拉状态，这里就能发现。
 * 反过来页面比宿主新：没开 HMR 时一键更新装好了新版，dsh 先换了页面，宿主要等重启 dsh web 才换，刷新没用。
 */
function StaleBanner() {
  const app = useApp()
  const { data: status } = useResource(app.cache, 'status', () => api.status())
  if (status === undefined || status.version === POD_VERSION) return null
  if (compareVersions(POD_VERSION, status.version) > 0) {
    return <div className="pod-banner">{t('dsh-bot {POD_VERSION} 已经装好，后台还在跑 {version}：重启 dsh web 以后才换过来，在那之前有的按钮可能会报错。', { POD_VERSION, version: status.version })}</div>
  }
  return (
    <div className="pod-banner pod-banner-action">
      <span>{t('dsh-bot 已经更新到 {version}，这个标签页还是更新前打开的（{POD_VERSION}），有的按钮会报错。刷新一下就好。', { version: status.version, POD_VERSION })}</span>
      <Button small kind="primary" onClick={() => window.location.reload()}>
        {t('刷新')}
      </Button>
    </div>
  )
}

/** 第一次打开时的引导。 */
function FirstRun() {
  const app = useApp()
  const { data: settings } = useResource(app.cache, 'settings', () => api.settings())
  if (settings === undefined || settings.onboarded) return null
  return <Onboarding settings={settings} />
}

/** 按 Esc 关掉右侧的详情：弹窗、抽屉、菜单开着，或者正在输入框里打字时不算。 */
function useEscapeClosesPanel(): void {
  const app = useApp()
  const nav = useNav()
  useEffect(() => {
    if (nav.panel === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target !== null && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      const current = app.getNav()
      if (current.drawer !== null || current.settings !== null || current.search !== null || current.taskId !== null) return
      if (document.querySelector('.pod-modal, .pod-menu') !== null) return
      // 从详情里放大看的浏览器：Esc 先回到详情。
      if (current.panel?.kind === 'browser' && current.panel.back !== undefined && current.panel.back !== null) app.navigate({ panel: current.panel.back })
      else app.closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [app, nav.panel === null])
}

/** 打开页面时清掉上次没正常离开的临时对话；不在了的对话的草稿也清掉。手机上先看到列表，不能等打开对话再做。 */
function useRoomHousekeeping(): void {
  const app = useApp()
  const { data: rooms, loading } = useResource(app.cache, 'rooms', () => api.rooms())
  const swept = useRef(false)
  useEffect(() => {
    if (rooms === undefined || swept.current) return
    swept.current = true
    app.sweepTemporary(rooms)
  }, [app, rooms])
  // 等列表拉完再清：刚建的对话还不在旧列表里。
  useEffect(() => {
    if (rooms !== undefined && !loading) pruneDrafts(new Set(rooms.map((item) => item.id)))
  }, [rooms, loading])
}

/**
 * 宽屏是三栏：侧栏、中间的对话（或页面查看器）、右侧详情。
 * 手机上一次一页：不在对话里时是列表，进了对话是对话，页面查看器和详情盖在上面整页显示，系统的返回一层层退回来。
 */
function Layout() {
  const app = useApp()
  const nav = useNav()
  const narrow = useNarrow()
  useEscapeClosesPanel()
  useRoomHousekeeping()
  useMobileBack(app, narrow)
  const center = nav.page === null ? <Conversation /> : <PageViewer key={nav.page.id} pageId={nav.page.id} version={nav.page.version} />
  if (narrow) {
    return (
      <div className="pod-layout pod-layout-narrow">
        {nav.page === null && nav.roomId === null ? <Sidebar /> : center}
        <RightPanel />
      </div>
    )
  }
  return (
    <div className={`pod-layout${nav.panel === null ? '' : ' pod-layout-panel'}${nav.sidebarCollapsed ? ' pod-layout-collapsed' : ''}`}>
      <Sidebar />
      {center}
      <RightPanel />
    </div>
  )
}

/** Pod 页面的外壳：左侧栏、中间对话（或页面查看器）、右侧面板，加上设置弹窗、更新弹窗、搜索和抽屉。没有顶部导航。 */
export function PodApp(props: { readonly host: HostActions; readonly locale: HostLocale }) {
  const [app] = useState(() => new AppState(props.host))
  useEffect(() => () => app.dispose(), [app])
  // 换语言时整页按新语言重画一遍（导航和数据在 AppState 里，不会丢）。
  const language = useLanguage(app, props.locale)
  // 跟着 dsh 的深浅色：名字颜色这类要分深浅的样式按它选。
  const theme = useSurfaceTheme()
  const root = useRef<HTMLDivElement>(null)
  const narrow = useNarrow()
  useKeyboardInset(root, narrow)
  return (
    <AppContext.Provider value={app}>
      <div ref={root} lang={language === 'en' ? 'en' : 'zh-CN'} className={`pod-app${theme === 'dark' ? ' pod-theme-dark' : ''}`}>
        <Fragment key={language}>
          <StaleBanner />
          <UpdateNotice />
          <ReadOnlyBanner />
          <Layout />
          <SettingsModal />
          <UpdateDialog />
          <SearchDialog />
          <Drawers />
          <FirstRun />
          <TooltipLayer />
        </Fragment>
      </div>
    </AppContext.Provider>
  )
}
