import { PAGE_KIND_LABELS, type Page, type RoomMessage } from 'pod-domain'
import { pageApi } from '../../api/pages.ts'
import { Icon } from '../../components/Icon.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { KindIcon, kindOf } from './kinds.tsx'

/** 在用的页面列表（卡片和小标签共用一份）：用来看页面后来有没有再改、是不是删了。 */
export function usePages(): { readonly pages: readonly Page[] | undefined; readonly find: (id: string) => Page | undefined } {
  const app = useApp()
  const { data: pages } = useResource(app.cache, 'pages', () => pageApi.list())
  return { pages, find: (id) => pages?.find((page) => page.id === id) }
}

/**
 * 对话里的页面卡片：种类图标、标题、种类和第几版、这次改了什么，点一下打开（总是最新版）。
 * 页面后来又改过，提示现在到第几版；删了的卡片变灰。
 */
export function PageCard(props: { readonly message: RoomMessage }) {
  const app = useApp()
  const { data } = props.message
  const { pages, find } = usePages()
  const pageId = String(data.pageId ?? '')
  const kind = kindOf(data.kind)
  const version = typeof data.version === 'number' ? data.version : 1
  const note = typeof data.note === 'string' ? data.note : ''
  const summary = typeof data.summary === 'string' ? data.summary : ''
  const page = find(pageId)
  const gone = pages !== undefined && page === undefined
  const newer = page !== undefined && page.version > version ? page.version : undefined
  return (
    <button type="button" className={`pod-page-card${gone ? ' pod-page-card-gone' : ''}`} disabled={gone} onClick={() => app.openPage(pageId)} title={gone ? undefined : '打开页面'}>
      <KindIcon kind={kind} size={40} />
      <span className="pod-page-card-main">
        <strong className="pod-ellipsis">{String(data.title ?? '页面')}</strong>
        <span className="pod-muted-inline pod-ellipsis">
          {PAGE_KIND_LABELS[kind]} · 第 {version} 版{summary === '' ? '' : ` · ${summary}`}
        </span>
        {note === '' || note === '第一版' ? null : <span className="pod-page-card-note">{note}</span>}
        {newer === undefined ? null : <span className="pod-hint">之后又改过，现在是第 {newer} 版</span>}
        {gone ? <span className="pod-hint">页面已删除，30 天内可以在设置的回收站里恢复</span> : null}
      </span>
      {gone ? null : <span className="pod-page-card-open">打开</span>}
    </button>
  )
}

/** 修改要求和 bot 的回复上的小标签：说明这条消息是关于哪个页面的，点一下打开它。 */
export function PageChip(props: { readonly pageId: string }) {
  const app = useApp()
  const { pages, find } = usePages()
  const page = find(props.pageId)
  return (
    <button type="button" className="pod-page-chip" disabled={pages !== undefined && page === undefined} onClick={() => app.openPage(props.pageId)} title="打开这个页面">
      <Icon name="page" size={12} />
      <span className="pod-ellipsis">{page === undefined ? '页面' : `${PAGE_KIND_LABELS[page.kind]}「${page.title}」`}</span>
    </button>
  )
}
