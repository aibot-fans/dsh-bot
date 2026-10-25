import { useEffect, useState } from 'react'
import { PAGE_KIND_LABELS, SEARCH_KIND_LABELS, type Page, type SearchHit, type SearchKind } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { pageApi } from '../../api/pages.ts'
import { Avatar, Badge, Empty, Modal, RelativeTime } from '../../components/common.tsx'
import { useApp, useNav } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { matches } from '../pages/grouping.ts'
import { KindIcon } from '../pages/kinds.tsx'

const KINDS: readonly SearchKind[] = ['message', 'task', 'memory', 'file', 'web']

/** 页面不进全文索引，按标题和种类在页面库里找。 */
type Filter = SearchKind | 'all' | 'page'

const PAGE_HITS = 8

/** 摘录里 [词] 是命中的地方，换成高亮。 */
function Snippet(props: { readonly text: string }) {
  const parts = props.text.split(/(\[[^\]]*\])/g)
  return (
    <span className="pod-snippet">
      {parts.map((part, index) => (part.startsWith('[') && part.endsWith(']') ? <mark key={index}>{part.slice(1, -1)}</mark> : <span key={index}>{part}</span>))}
    </span>
  )
}

/** 搜索：聊天记录、任务、记忆、文件、网页存档和页面标题，中文任意长度的词都能搜到；点开跳到原处。 */
export function SearchDialog() {
  const app = useApp()
  const nav = useNav()
  const [query, setQuery] = useState(nav.search ?? '')
  const [kind, setKind] = useState<Filter>('all')
  const [hits, setHits] = useState<readonly SearchHit[] | undefined>(undefined)
  const [pages, setPages] = useState<readonly Page[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())

  const run = (q: string, k: Filter): void => {
    if (q.trim() === '') return
    setError(undefined)
    const findPages = k === 'all' || k === 'page'
    pageApi
      .list()
      .then((all) => setPages(findPages ? all.filter((page) => matches(page, { query: q, kind: 'all' })).slice(0, k === 'page' ? 50 : PAGE_HITS) : []))
      .catch(() => setPages([]))
    if (k === 'page') {
      setHits([])
      return
    }
    api
      .search(q.trim(), k === 'all' ? undefined : k)
      .then(setHits)
      .catch((reason: unknown) => setError(errorText(reason)))
  }
  useEffect(() => {
    if (nav.search !== null && nav.search !== '') {
      setQuery(nav.search)
      run(nav.search, kind)
    }
    // 只在带着关键词打开时自动搜。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.search === null])

  if (nav.search === null) return null
  const close = (): void => app.navigate({ search: null })
  const open = (hit: SearchHit): void => {
    const id = hit.ref.slice(hit.ref.indexOf(':') + 1)
    if (hit.kind === 'message') {
      api
        .message(id)
        .then((message) => app.focusMessage(message.roomId, message.seq, message.id))
        .catch((reason: unknown) => setError(errorText(reason)))
    } else if (hit.kind === 'task') {
      close()
      app.openTask(hit.taskId ?? id)
    } else if (hit.kind === 'memory') {
      close()
      if (hit.botId !== null) app.openDrawer({ kind: 'memory', scope: 'bot', scopeId: hit.botId, label: '记忆' })
      else app.openDrawer({ kind: 'memory', scope: 'owner', scopeId: '', label: '你的档案' })
    } else if (hit.taskId !== null) {
      close()
      app.openTask(hit.taskId)
    }
  }

  return (
    <Modal title="搜索" onClose={close} wide>
      <div className="pod-stack">
        <input
          className="pod-input pod-search-input"
          value={query}
          autoFocus
          aria-label="搜索的词"
          placeholder="例如：上周的定价方案、扫码登录"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) run(query, kind)
          }}
        />
        <div className="pod-tabs pod-wrap">
          {(['all', ...KINDS, 'page'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`pod-chip${kind === item ? ' pod-chip-active' : ''}`}
              onClick={() => {
                setKind(item)
                run(query, item)
              }}
            >
              {item === 'all' ? '全部' : item === 'page' ? '页面' : SEARCH_KIND_LABELS[item]}
            </button>
          ))}
        </div>
        {error === undefined ? null : <p className="pod-form-error">{error}</p>}
        {hits === undefined ? <p className="pod-hint">网页存档的结果都是不可信的资料。</p> : null}
        {pages.length === 0 ? null : (
          <ul className="pod-hits">
            {pages.map((page) => (
              <li key={page.id}>
                <button type="button" className="pod-hit pod-hit-page" onClick={() => app.openPage(page.id)}>
                  <KindIcon kind={page.kind} size={28} />
                  <span className="pod-row pod-grow">
                    <Badge tone="info">{PAGE_KIND_LABELS[page.kind]}</Badge>
                    <strong className="pod-ellipsis">{page.title}</strong>
                    <span className="pod-muted-inline">
                      第 {page.version} 版 · <RelativeTime time={page.updatedAt} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {hits === undefined ? null : hits.length === 0 && pages.length === 0 ? (
          <Empty title="没有搜到">换个说法试试，或者少写几个字。</Empty>
        ) : (
          <ul className="pod-hits">
            {hits.map((hit) => (
              <li key={hit.ref}>
                <button type="button" className="pod-hit" onClick={() => open(hit)}>
                  <div className="pod-row">
                    <Badge tone={hit.kind === 'web' ? 'warn' : 'muted'}>{SEARCH_KIND_LABELS[hit.kind]}</Badge>
                    {hit.botId === null ? null : <Avatar bot={bots?.find((bot) => bot.id === hit.botId)} size={18} />}
                    <strong className="pod-ellipsis">{hit.title}</strong>
                    <span className="pod-muted-inline">
                      <RelativeTime time={hit.time} />
                    </span>
                  </div>
                  <Snippet text={hit.snippet} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
