import { useEffect, useState } from 'react'
import { POD_VERSION } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { Button } from '../components/common.tsx'
import { TooltipLayer } from '../components/Tooltip.tsx'
import { AppContext, AppState, useApp, useNav, type HostActions } from '../state/app.ts'
import { useResource } from '../state/resource.ts'
import { Conversation } from './chat/Conversation.tsx'
import { Onboarding } from './Onboarding.tsx'
import { PageViewer } from './pages/PageViewer.tsx'
import { Drawers } from './panel/Drawers.tsx'
import { RightPanel } from './panel/RightPanel.tsx'
import { SearchDialog } from './search/SearchDialog.tsx'
import { SettingsModal } from './settings/SettingsModal.tsx'
import { Sidebar } from './side/Sidebar.tsx'

function ReadOnlyBanner() {
  const app = useApp()
  const { data: status } = useResource(app.cache, 'status', () => api.status())
  if (status === undefined) return null
  if (status.exposure?.exposed === true) {
    return <div className="pod-banner">dsh web 现在对外开放（{status.exposure.reasons.join('；')}）。为了安全，Pod 禁用了 bot 的终端和浏览器写操作；建议只在本机或 Tailscale 内使用。</div>
  }
  if (!status.readOnly) return null
  return (
    <div className="pod-banner">
      Pod 处于只读模式：当前 dsh（{status.dshVersion}）缺少 Pod 需要的接口（{status.problems.join('、')}）。可以查看数据，但不会创建会话或派活。
    </div>
  )
}

/** 标签页是 Pod 更新前打开的：旧页面调的接口可能已经换了，提示刷新。宿主重启后事件流会让页面重新拉状态，这里就能发现。 */
function StaleBanner() {
  const app = useApp()
  const { data: status } = useResource(app.cache, 'status', () => api.status())
  if (status === undefined || status.version === POD_VERSION) return null
  return (
    <div className="pod-banner pod-banner-action">
      <span>Pod 已经更新到 {status.version}，这个标签页还是更新前打开的（{POD_VERSION}），有的按钮会报错。刷新一下就好。</span>
      <Button small kind="primary" onClick={() => window.location.reload()}>
        刷新
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
      app.closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [app, nav.panel === null])
}

function Layout() {
  const nav = useNav()
  useEscapeClosesPanel()
  return (
    <div className={`pod-layout${nav.panel === null ? '' : ' pod-layout-panel'}${nav.sidebarCollapsed ? ' pod-layout-collapsed' : ''}`}>
      <Sidebar />
      {nav.page === null ? <Conversation /> : <PageViewer key={nav.page.id} pageId={nav.page.id} version={nav.page.version} />}
      <RightPanel />
    </div>
  )
}

/** Pod 页面的外壳：左侧栏、中间对话（或页面查看器）、右侧面板，加上设置弹窗、搜索和抽屉。没有顶部导航。 */
export function PodApp(props: { readonly host: HostActions }) {
  const [app] = useState(() => new AppState(props.host))
  useEffect(() => () => app.dispose(), [app])
  return (
    <AppContext.Provider value={app}>
      <div className="pod-app">
        <StaleBanner />
        <ReadOnlyBanner />
        <Layout />
        <SettingsModal />
        <SearchDialog />
        <Drawers />
        <FirstRun />
        <TooltipLayer />
      </div>
    </AppContext.Provider>
  )
}
