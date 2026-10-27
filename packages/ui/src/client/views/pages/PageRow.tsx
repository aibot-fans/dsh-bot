import { useState } from 'react'
import { PAGE_KIND_LABELS, PAGE_TITLE_MAX, t, type Page } from 'pod-domain'
import { errorText } from '../../api/http.ts'
import { pageApi } from '../../api/pages.ts'
import { RelativeTime } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { MenuItem, MenuPanel, useMenu } from '../../components/Menu.tsx'
import { RenameInput } from '../../components/RenameInput.tsx'
import { useApp } from '../../state/app.ts'
import { KindIcon } from './kinds.tsx'

/** 页面列表里的一行：点开查看；右边的菜单置顶、改名、删除。 */
export function PageRow(props: { readonly page: Page; readonly onError: (message: string) => void }) {
  const app = useApp()
  const { page } = props
  const menu = useMenu()
  const [renaming, setRenaming] = useState(false)
  const run = (work: Promise<unknown>): void => {
    work.then(() => app.cache.invalidate('pages')).catch((reason: unknown) => props.onError(errorText(reason)))
  }
  return (
    <div className="pod-page-row">
      <button type="button" className="pod-page-row-open" onClick={() => app.openPage(page.id)}>
        <KindIcon kind={page.kind} />
        <span className="pod-page-row-text">
          {renaming ? (
            <RenameInput
              value={page.title}
              max={PAGE_TITLE_MAX}
              label={t('页面标题')}
              onSave={(title) => {
                setRenaming(false)
                run(pageApi.rename(page.id, title))
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <span className="pod-ellipsis">{page.title}</span>
          )}
          <span className="pod-muted-inline">
            {t('{kind} · 第 {version} 版 ·', { kind: t(PAGE_KIND_LABELS[page.kind]), version: page.version })} <RelativeTime time={page.updatedAt} />
          </span>
        </span>
      </button>
      {page.pinned ? (
        <span className="pod-page-row-pin" title={t('已置顶')}>
          <Icon name="pin" size={13} />
        </span>
      ) : null}
      <button ref={menu.anchor} type="button" className="pod-icon-button" aria-label={t('「{title}」的操作', { title: page.title })} title={t('更多')} aria-expanded={menu.open} onClick={menu.toggle}>
        <Icon name="more" size={15} />
      </button>
      <MenuPanel control={menu} label={t('「{title}」的操作', { title: page.title })}>
        <MenuItem
          icon={page.pinned ? 'unpin' : 'pin'}
          label={page.pinned ? t('取消置顶') : t('置顶')}
          onClick={() => {
            menu.close()
            run(pageApi.pin(page.id, !page.pinned))
          }}
        />
        <MenuItem
          icon="edit"
          label={t('改名')}
          onClick={() => {
            menu.close()
            setRenaming(true)
          }}
        />
        <MenuItem
          icon="trash"
          label={t('删除')}
          danger
          onClick={() => {
            menu.close()
            if (window.confirm(t('删除「{title}」？30 天内可以在设置的回收站里恢复。', { title: page.title }))) run(pageApi.remove(page.id))
          }}
        />
      </MenuPanel>
    </div>
  )
}
