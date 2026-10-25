import { useState, type ReactNode } from 'react'
import type { Page } from 'pod-domain'
import { pageApi } from '../../api/pages.ts'
import { Empty, ErrorBanner } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { matches } from './grouping.ts'
import { PageRow } from './PageRow.tsx'

/** 页面多到这个数才给搜索框。 */
const SEARCH_FROM = 6

const order = (left: Page, right: Page): number => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt

/**
 * bot 详情、群聊详情里的“页面”页：只列这个 bot 做的、或这个群里做的页面，置顶的在前，其余按更新时间；
 * 页面多了能搜标题。全部页面在页面库里。
 */
export function ScopedPages(props: { readonly match: (page: Page) => boolean; readonly empty: ReactNode }) {
  const app = useApp()
  const [query, setQuery] = useState('')
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const { data: pages, error } = useResource(app.cache, 'pages', () => pageApi.list())
  const mine = (pages ?? []).filter(props.match)
  const shown = mine.filter((page) => matches(page, { query, kind: 'all' })).sort(order)
  return (
    <div className="pod-stack">
      {error === undefined ? null : <ErrorBanner message={error} />}
      {problem === undefined ? null : <ErrorBanner message={problem} onClose={() => setProblem(undefined)} />}
      {mine.length < SEARCH_FROM ? null : <input className="pod-input" value={query} placeholder="搜标题" aria-label="搜页面标题" onChange={(event) => setQuery(event.target.value)} />}
      {pages === undefined ? <p className="pod-muted">正在读取…</p> : null}
      {pages !== undefined && mine.length === 0 ? <Empty title="还没有页面">{props.empty}</Empty> : null}
      {mine.length > 0 && shown.length === 0 ? <Empty title="没有符合条件的页面">换个词试试。</Empty> : null}
      {shown.length === 0 ? null : (
        <div className="pod-lib-list">
          {shown.map((page) => (
            <PageRow key={page.id} page={page} onError={setProblem} />
          ))}
        </div>
      )}
      {pages === undefined || pages.length === mine.length ? null : (
        <button type="button" className="pod-link pod-center" onClick={() => app.showPages()}>
          查看全部 {pages.length} 个页面
        </button>
      )}
    </div>
  )
}
