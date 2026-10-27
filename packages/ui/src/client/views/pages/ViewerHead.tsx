import { useState } from 'react'
import { PAGE_KIND_LABELS, PAGE_TITLE_MAX, t, type Page } from 'pod-domain'
import { errorText } from '../../api/http.ts'
import { exportPage, pageApi, type ExportFormat, type PageTheme } from '../../api/pages.ts'
import { Badge, IconButton } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { MenuPanel, useMenu } from '../../components/Menu.tsx'
import { RenameInput } from '../../components/RenameInput.tsx'
import { useApp } from '../../state/app.ts'
import { KindIcon } from './kinds.tsx'

const FORMATS: readonly (readonly [ExportFormat, string, string])[] = [
  ['pdf', 'PDF', '按页面的版式分页，适合打印和发给别人'],
  ['png', 'PNG 长图', '整页截成一张图，跟着现在的深浅色'],
  ['html', 'HTML 文件', '单个文件，双击就能在浏览器里看，图表能交互'],
]

/** 导出：PDF、长图和单个 HTML 文件。PDF 和长图用共用浏览器生成，要几秒。 */
function ExportButton(props: { readonly page: Page; readonly version: number | undefined; readonly theme: PageTheme; readonly onError: (message: string) => void }) {
  const menu = useMenu()
  const [running, setRunning] = useState<ExportFormat | undefined>(undefined)
  const run = (format: ExportFormat): void => {
    menu.close()
    setRunning(format)
    exportPage({ id: props.page.id, title: props.page.title, format, version: props.version, theme: props.theme })
      .catch((reason: unknown) => props.onError(errorText(reason)))
      .finally(() => setRunning(undefined))
  }
  return (
    <>
      <button ref={menu.anchor} type="button" className="pod-button pod-button-small" aria-expanded={menu.open} disabled={running !== undefined} onClick={menu.toggle}>
        <Icon name="download" size={14} />
        {running === undefined ? t('导出') : running === 'png' ? t('正在生成长图…') : t('正在生成 {format}…', { format: running.toUpperCase() })}
      </button>
      <MenuPanel control={menu} label={t('导出页面')} wide>
        {FORMATS.map(([format, label, hint]) => (
          <button key={format} type="button" role="menuitem" className="pod-menu-item pod-export-item" onClick={() => run(format)}>
            <span>{t(label)}</span>
            <span className="pod-muted-inline">{t(hint)}</span>
          </button>
        ))}
      </MenuPanel>
    </>
  )
}

/** 查看器顶栏：返回对话、种类和标题（点一下改名）、第几版、置顶、导出、页面库。 */
export interface ViewerSide {
  readonly open: boolean
  readonly toggle: () => void
}

/** 查看器顶部。side 只在手机上给：修改和版本收起来时，用这里的按钮打开；手机上只留左边的返回，没有右边的关闭。 */
export function ViewerHead(props: { readonly page: Page; readonly viewing: number; readonly theme: PageTheme; readonly onError: (message: string) => void; readonly side?: ViewerSide }) {
  const app = useApp()
  const { page } = props
  const [renaming, setRenaming] = useState(false)
  const previewing = props.viewing !== page.version
  const run = (work: Promise<unknown>): void => {
    work.then(() => app.cache.invalidate('pages')).catch((reason: unknown) => props.onError(errorText(reason)))
  }
  return (
    <header className="pod-viewer-head">
      <IconButton icon="back" label={t('回到对话')} onClick={() => app.closePage()} />
      {props.side === undefined ? <KindIcon kind={page.kind} size={30} /> : null}
      {renaming ? (
        <RenameInput
          value={page.title}
          max={PAGE_TITLE_MAX}
          label={t('页面标题')}
          className="pod-viewer-rename"
          onSave={(title) => {
            setRenaming(false)
            run(pageApi.rename(page.id, title))
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <button type="button" className="pod-viewer-title" onClick={() => setRenaming(true)} disabled={page.deletedAt !== null} title={t('点一下改名')}>
          <strong>{page.title}</strong>
        </button>
      )}
      <Badge>{t(PAGE_KIND_LABELS[page.kind])}</Badge>
      {previewing ? <Badge tone="warn">{t('在看第 {viewing} 版 · 最新第 {version} 版', { viewing: props.viewing, version: page.version })}</Badge> : <span className="pod-muted-inline">{t('第 {version} 版', { version: page.version })}</span>}
      <span className="pod-convo-head-gap" />
      {page.deletedAt === null ? (
        <IconButton icon={page.pinned ? 'unpin' : 'pin'} label={page.pinned ? t('取消置顶') : t('置顶到页面库最前')} onClick={() => run(pageApi.pin(page.id, !page.pinned))} />
      ) : null}
      <ExportButton page={page} version={previewing ? props.viewing : undefined} theme={props.theme} onError={props.onError} />
      {props.side === undefined ? (
        <>
          <IconButton icon="page" label={t('页面库')} onClick={() => app.showPages()} />
          <IconButton icon="close" label={t('关闭页面')} onClick={() => app.closePage()} />
        </>
      ) : (
        <button type="button" className={`pod-head-button${props.side.open ? ' pod-head-button-on' : ''}`} aria-expanded={props.side.open} aria-label={t('修改和版本')} title={t('修改和版本')} onClick={props.side.toggle}>
          <Icon name="edit" size={18} />
        </button>
      )}
    </header>
  )
}
