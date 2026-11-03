import { useEffect, useState } from 'react'
import { t } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { computerApi } from '../../api/computer.ts'
import { Avatar, Button, Empty, ErrorBanner, IconButton, RelativeTime } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { PanelClose } from '../../components/PanelClose.tsx'
import { useNarrow } from '../../components/media.ts'
import { useApp } from '../../state/app.ts'
import { setBrowserFull, useBrowserFull } from '../../state/browserFull.ts'
import { useResource } from '../../state/resource.ts'
import { ComputerControl } from '../computer/ComputerControl.tsx'
import { ComputerLiveView } from '../computer/ComputerLiveView.tsx'

/**
 * 电脑：从右侧滑出，和浏览器一个样子。上面一条工具栏：谁在用电脑、画面跟着的应用、“接管”“交还”、窗口内全屏和关闭；
 * 下面是那个应用窗口的实时画面（只推这个任务批准过的应用，别的窗口挡在上面也推不进来），最下面一行是 bot 这一步在做什么。
 * 接管以后 bot 先停手，你直接在这台 Mac 上操作那个应用；窗口内全屏和浏览器共用一个设置，Esc 退出。
 */
export function ComputerPanel() {
  const app = useApp()
  const narrow = useNarrow()
  const full = useBrowserFull() && !narrow
  const { data: status, error } = useResource(app.cache, 'computer', () => computerApi.status())
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  const { data: settings } = useResource(app.cache, 'settings', () => api.settings())
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const user = status?.user ?? null
  const bot = user === null ? undefined : bots?.find((item) => item.id === user.botId)
  const botName = bot?.name ?? user?.botId ?? ''

  useEffect(() => {
    if (!full) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('.pod-modal, .pod-menu') !== null) return
      event.preventDefault()
      setBrowserFull(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [full])

  const closer = <PanelClose label={t('关闭电脑面板')} onClose={() => app.closePanel()} stacked={false} />
  const empty = (() => {
    if (status === undefined) return <p className="pod-muted">{error ?? t('正在读取…')}</p>
    if (settings !== undefined && !settings.computerUse) {
      return (
        <Empty title={t('用电脑关着')}>
          <div className="pod-stack">
            <span>{t('打开以后，做任务的 bot 能在后台用这台 Mac 上别的应用，它在用的应用窗口会出现在这里。')}</span>
            <span>
              <Button small onClick={() => app.openSettings('computer')}>
                {t('去设置')}
              </Button>
            </span>
          </div>
        </Empty>
      )
    }
    if (status.state !== 'ready') return <Empty title={t('用不了电脑')}>{status.message}</Empty>
    if (user === null) return <Empty title={t('现在没有 bot 在用电脑')}>{t('bot 做任务用电脑时，它在用的应用窗口会出现在这里，你随时可以接管。')}</Empty>
    return null
  })()

  return (
    <aside className={`pod-panel pod-panel-wide pod-browser-panel${full ? ' pod-panel-full' : ''}`} aria-label={t('电脑')}>
      <header className="pod-browser-head">
        <div className="pod-browser-head-main">
          {narrow ? closer : null}
          <span className="pod-browser-title">
            {bot === undefined ? <Icon name="computer" size={16} /> : <Avatar bot={bot} size={20} />}
            <strong className="pod-ellipsis">{user === null ? t('电脑') : t('{name}在用电脑', { name: botName })}</strong>
          </span>
        </div>
        {user === null || empty !== null ? null : (
          <div className="pod-browser-head-nav">
            <span className="pod-computer-app pod-ellipsis" title={t('任务「{task}」批准用的应用：{apps}', { task: user.taskTitle, apps: user.apps.join(t('、')) })}>
              <Icon name="computer" size={14} />
              {user.app ?? ''}
            </span>
            <ComputerControl user={user} botName={botName} onError={setProblem} />
          </div>
        )}
        <div className="pod-browser-head-tools">
          {narrow || user === null ? null : <IconButton icon={full ? 'exit-fullscreen' : 'fullscreen'} label={full ? t('退出全屏（Esc）') : t('窗口内全屏')} onClick={() => setBrowserFull(!full)} />}
          {narrow ? null : closer}
        </div>
      </header>
      {empty !== null || user === null ? (
        <div className="pod-panel-scroll">{empty}</div>
      ) : (
        <div className="pod-browser-body">
          {problem === undefined ? null : (
            <div className="pod-browser-notes">
              <ErrorBanner message={problem} onClose={() => setProblem(undefined)} />
            </div>
          )}
          {user.takenOver ? <p className="pod-computer-banner">{t('你接管了：直接在这台 Mac 上操作「{app}」，好了点“交还给{name}”。', { app: user.app ?? '', name: botName })}</p> : null}
          <div className={`pod-browser-stage${user.takenOver ? ' pod-computer-taken' : ''}`}>{user.app === null ? <p className="pod-muted">{t('{name}还没打开要用的应用', { name: botName })}</p> : <ComputerLiveView key={user.app} app={user.app} />}</div>
          <p className="pod-computer-caption">
            {user.last === null ? (
              <span className="pod-muted">{t('任务「{task}」', { task: user.taskTitle })}</span>
            ) : (
              <>
                <strong>{botName}</strong>
                <span className="pod-ellipsis">{user.last.label}</span>
                <span className="pod-muted">
                  <RelativeTime time={user.last.at} />
                </span>
              </>
            )}
          </p>
        </div>
      )}
    </aside>
  )
}
