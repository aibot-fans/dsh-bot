import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from 'pod-domain'
import { api, type TabView } from '../../api/endpoints.ts'
import { errorText, mediaUrl } from '../../api/http.ts'
import { Badge, Button, IconButton } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { MenuDivider, MenuItem, MenuPanel, useMenu } from '../../components/Menu.tsx'
import { copyText } from '../../components/clipboard.ts'
import { useApp } from '../../state/app.ts'

/** 改标签页的请求：成功后刷新浏览器列表再做 after，失败交给 onError。 */
export function useTabRun(onError: (message: string) => void): (work: Promise<unknown>, after?: () => void) => void {
  const app = useApp()
  return (work, after) => {
    work
      .then(() => {
        app.cache.invalidate('browser')
        after?.()
      })
      .catch((reason: unknown) => onError(errorText(reason)))
  }
}

function tabName(tab: TabView): string {
  return tab.title || tab.url || t('新标签页')
}

/** 下拉里的一个网页：标题，下面一行是在做的任务或谁开的。 */
function TabOption(props: { readonly tab: TabView; readonly active: boolean; readonly onPick: () => void }) {
  const { tab } = props
  return (
    <button type="button" role="menuitemradio" aria-checked={props.active} className="pod-menu-item pod-browser-option" onClick={props.onPick}>
      <span className="pod-menu-icon">{props.active ? <Icon name="check" size={15} /> : tab.loading ? <span className="pod-browser-loading" aria-label={t('加载中')} /> : null}</span>
      <span className="pod-browser-option-text">
        <span className="pod-ellipsis">{tabName(tab)}</span>
        <span className="pod-browser-option-meta pod-ellipsis">{tab.taskTitle !== '' ? tab.taskTitle : tab.ownerName}</span>
      </span>
      {tab.controller === 'owner' ? <Badge tone="warn">{t('你在操作')}</Badge> : tab.waitId !== null ? <Badge tone="warn">{t('等你接管')}</Badge> : null}
    </button>
  )
}

/**
 * 工具栏左边：当前网页的标题，点开列出全部网页（这个对话、这个 bot 的在前，别处的在“其他对话”下面），
 * 最后一项在这个对话里开新网页。不再单占一行标签条。
 */
export function TabSwitcher(props: {
  readonly selected: TabView
  readonly scoped: readonly TabView[]
  readonly others: readonly TabView[]
  readonly leading: ReactNode
  readonly onSelect: (tabId: string) => void
  readonly onAdd: () => void
}) {
  const menu = useMenu('start')
  const count = props.scoped.length + props.others.length
  const pick = (action: () => void): void => {
    menu.close()
    action()
  }
  const option = (tab: TabView) => <TabOption key={tab.id} tab={tab} active={tab.id === props.selected.id} onPick={() => pick(() => props.onSelect(tab.id))} />
  return (
    <>
      <button ref={menu.anchor} type="button" className="pod-browser-switch" aria-haspopup="menu" aria-expanded={menu.open} aria-label={t('切换网页')} title={`${tabName(props.selected)}\n${props.selected.url}`} onClick={menu.toggle}>
        {props.leading}
        <span className="pod-ellipsis">{tabName(props.selected)}</span>
        {count > 1 ? <span className="pod-browser-count">{count}</span> : null}
        <Icon name="expand" size={14} />
      </button>
      <MenuPanel control={menu} label={t('切换网页')}>
        <div className="pod-browser-options">
          {props.scoped.map(option)}
          {props.others.length === 0 ? null : <div className="pod-menu-label">{t('其他对话')}</div>}
          {props.others.map(option)}
        </div>
        <MenuDivider />
        <MenuItem icon="plus" label={t('打开新网页')} onClick={() => pick(props.onAdd)} />
      </MenuPanel>
    </>
  )
}

/** 前进后退、刷新和网址：你接管时才能用。 */
export function AddressBar(props: { readonly tab: TabView; readonly onError: (message: string) => void }) {
  const { tab } = props
  const controlled = tab.controller === 'owner'
  const [address, setAddress] = useState(tab.url)
  useEffect(() => setAddress(tab.url), [tab.url])
  const run = (work: Promise<unknown>): void => {
    work.catch((reason: unknown) => props.onError(errorText(reason)))
  }
  return (
    <>
      <IconButton icon="back" label={t('后退')} disabled={!controlled} onClick={() => run(api.tabHistory(tab.id, 'back'))} />
      <IconButton icon="forward" label={t('前进')} disabled={!controlled} onClick={() => run(api.tabHistory(tab.id, 'forward'))} />
      <IconButton icon="refresh" label={t('刷新')} disabled={!controlled} onClick={() => run(api.tabHistory(tab.id, 'reload'))} />
      <input
        className="pod-input pod-browser-url"
        value={address}
        readOnly={!controlled}
        aria-label={t('地址栏')}
        title={controlled ? undefined : t('接管后才能输网址')}
        onChange={(event) => setAddress(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && controlled) run(api.navigateTab(tab.id, address))
        }}
      />
    </>
  )
}

/**
 * 谁在操作，和你这时能做的事：AI 操作时“接管”；你在操作 bot 的网页时“交还给它”，点开能留一句话再交还。
 * 说明放在状态的悬停提示里，不占画面下面的地方。
 */
export function TabControl(props: { readonly tab: TabView; readonly onError: (message: string) => void }) {
  const { tab } = props
  const run = useTabRun(props.onError)
  const menu = useMenu('end')
  const [note, setNote] = useState('')
  const noteRef = useRef<HTMLInputElement>(null)
  // 菜单先藏着量好位置再显示，藏着时 autoFocus 不起作用：显示出来以后再把光标放进留言框。
  useEffect(() => {
    if (menu.open && menu.style.visibility !== 'hidden') noteRef.current?.focus()
  }, [menu.open, menu.style.visibility])
  if (tab.controller !== 'owner') {
    return (
      <div className="pod-browser-state">
        <span title={t('你只看不动；{ownerName}要点的位置会在画面上标出来', { ownerName: tab.ownerName })}>
          {tab.waitId === null ? <Badge tone="info">{t('AI 操作中')}</Badge> : <Badge tone="warn">{t('等你接管')}</Badge>}
        </span>
        <Button small kind="primary" onClick={() => run(api.takeover(tab.id))}>
          {t('接管')}
        </Button>
      </div>
    )
  }
  const botTab = tab.owner.kind === 'bot'
  const handback = (): void =>
    run(api.handback(tab.id, note), () => {
      setNote('')
      menu.close()
    })
  return (
    <div className="pod-browser-state">
      <span title={t('点画面、滚动、打字都会直接作用到网页{value}', { value: botTab ? t('，{ownerName}在等你交还', { ownerName: tab.ownerName }) : '' })}>
        <Badge tone="warn">{t('你在操作')}</Badge>
      </span>
      {botTab ? (
        <>
          <button ref={menu.anchor} type="button" className="pod-button pod-button-primary pod-button-small" aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
            {t('交还给{ownerName}', { ownerName: tab.ownerName })}
          </button>
          <MenuPanel control={menu} label={t('交还给{ownerName}', { ownerName: tab.ownerName })}>
            <div className="pod-menu-form pod-browser-handback">
              <input
                ref={noteRef}
                className="pod-input"
                value={note}
                placeholder={t('交还时留一句话，例如“已登录”')}
                aria-label={t('交还时留的话')}
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) handback()
                }}
              />
              <button type="button" className="pod-button pod-button-primary pod-button-small" onClick={handback}>
                {t('交还')}
              </button>
            </div>
          </MenuPanel>
        </>
      ) : null}
    </div>
  )
}

/** 工具栏的“更多”：复制选中的文字、截图、动作记录，以及停止或关掉这个标签页。关掉以后 onClosed 换到别的网页。 */
export function BrowserMore(props: { readonly tab: TabView; readonly onLog: () => void; readonly onError: (message: string) => void; readonly onClosed: () => void }) {
  const { tab } = props
  const run = useTabRun(props.onError)
  const menu = useMenu('end')
  const controlled = tab.controller === 'owner'
  const pick = (action: () => void): void => {
    menu.close()
    action()
  }
  const close = (question: string): void => {
    if (window.confirm(question)) run(api.closeTab(tab.id), props.onClosed)
  }
  return (
    <>
      <button ref={menu.anchor} type="button" className="pod-icon-button" aria-label={t('更多')} title={t('更多')} aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
        <Icon name="more" size={15} />
      </button>
      <MenuPanel control={menu} label={t('更多')}>
        <MenuItem icon="copy" label={t('复制页面里选中的文字')} onClick={() => pick(() => void api.tabSelection(tab.id).then(copyText).catch((reason: unknown) => props.onError(errorText(reason))))} />
        <MenuItem icon="image" label={t('截图')} onClick={() => pick(() => window.open(mediaUrl('/browser/screenshot', { tabId: tab.id }), '_blank', 'noopener'))} />
        {tab.actions.length === 0 ? null : <MenuItem icon="history" label={t('动作记录（{length}）', { length: tab.actions.length })} onClick={() => pick(props.onLog)} />}
        {controlled && tab.owner.kind === 'bot' ? null : (
          <>
            <MenuDivider />
            {controlled ? (
              <MenuItem icon="close" danger label={t('关闭标签页')} onClick={() => pick(() => close(t('关掉这个标签页？')))} />
            ) : (
              <MenuItem icon="stop" danger label={t('停止这个标签页')} onClick={() => pick(() => close(t('停止这个标签页？{ownerName}要重新打开才能继续用。', { ownerName: tab.ownerName })))} />
            )}
          </>
        )}
      </MenuPanel>
    </>
  )
}
