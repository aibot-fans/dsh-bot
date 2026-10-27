import { useMemo, useState } from 'react'
import { PAGE_KINDS, PAGE_KIND_LABELS, t, tc, type Bot, type PageKind } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { pageApi } from '../../api/pages.ts'
import { Avatar, Empty, ErrorBanner } from '../../components/common.tsx'
import { GroupMark } from '../../components/GroupMark.tsx'
import { Icon } from '../../components/Icon.tsx'
import { PanelClose } from '../../components/PanelClose.tsx'
import { useApp, useNav } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { currentGroupKey, groupPages, matches, type PageGroup } from './grouping.ts'
import { PageRow } from './PageRow.tsx'

function GroupHead(props: { readonly group: PageGroup; readonly bots: ReadonlyMap<string, Bot> }) {
  const { group } = props
  const members = (group.room?.memberIds ?? []).flatMap((id) => props.bots.get(id) ?? [])
  return (
    <div className="pod-page-group-head">
      {group.room !== undefined ? <GroupMark members={members} size={18} /> : <Avatar bot={group.bot} size={18} />}
      <span className="pod-ellipsis">{group.room !== undefined ? t('群聊「{label}」', { label: group.label }) : group.label}</span>
      <span className="pod-muted-inline">{group.pages.length}</span>
    </div>
  )
}

/** 右侧的页面库：搜索、按种类筛；置顶的在最前，其余按 bot（单聊）和群聊分组，当前对话那一组排第一。 */
export function PageLibraryPanel() {
  const app = useApp()
  const nav = useNav()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<PageKind | 'all'>('all')
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const { data: pages, error } = useResource(app.cache, 'pages', () => pageApi.list())
  const { data: botList } = useResource(app.cache, 'bots', () => api.bots())
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const bots = useMemo(() => new Map((botList ?? []).map((bot) => [bot.id, bot])), [botList])
  const all = pages ?? []
  const kinds = PAGE_KINDS.filter((item) => all.some((page) => page.kind === item))
  const shown = all.filter((page) => matches(page, { query, kind }))
  const current = currentGroupKey((rooms ?? []).find((room) => room.id === nav.roomId))
  const { pinned, groups } = groupPages(shown, rooms ?? [], bots, current)
  return (
    <aside className="pod-panel" aria-label={t('页面库')}>
      <div className="pod-panel-top pod-panel-top-row">
        <Icon name="page" size={18} />
        <strong>{t('页面')}</strong>
        <span className="pod-muted-inline">{all.length === 0 ? '' : t('{length} 个', { length: all.length })}</span>
        <span className="pod-grow" />
        <PanelClose label={t('关闭页面库')} onClose={() => app.closePanel()} />
      </div>
      <div className="pod-panel-scroll pod-page-library">
        {error === undefined ? null : <ErrorBanner message={error} />}
        {problem === undefined ? null : <ErrorBanner message={problem} onClose={() => setProblem(undefined)} />}
        {all.length === 0 ? null : (
          <div className="pod-stack">
            <input className="pod-input" value={query} placeholder={t('搜标题')} aria-label={t('搜页面标题')} onChange={(event) => setQuery(event.target.value)} />
            {kinds.length < 2 ? null : (
              <div className="pod-tabs pod-wrap">
                {(['all', ...kinds] as const).map((item) => (
                  <button key={item} type="button" className={`pod-chip${kind === item ? ' pod-chip-active' : ''}`} aria-pressed={kind === item} onClick={() => setKind(item)}>
                    {item === 'all' ? t('全部') : t(PAGE_KIND_LABELS[item])}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {pages === undefined ? <p className="pod-muted">{t('正在读取…')}</p> : null}
        {pages !== undefined && all.length === 0 ? (
          <Empty title={t('还没有页面')}>{t('让 bot 把结果做成报告、看板、跟踪表，或者幻灯片、海报、原型、架构图，比如“把这周的数据做成看板”。做好的页面都在这里。')}</Empty>
        ) : null}
        {all.length > 0 && shown.length === 0 ? <Empty title={t('没有符合条件的页面')}>{t('换个词，或者选“全部”。')}</Empty> : null}
        {pinned.length === 0 ? null : (
          <section className="pod-stack-tight">
            <div className="pod-section-title">{tc('置顶', '状态')}</div>
            <div className="pod-lib-list">
              {pinned.map((page) => (
                <PageRow key={page.id} page={page} onError={setProblem} />
              ))}
            </div>
          </section>
        )}
        {groups.map((group) => (
          <section key={group.key} className="pod-stack-tight">
            <GroupHead group={group} bots={bots} />
            <div className="pod-lib-list">
              {group.pages.map((page) => (
                <PageRow key={page.id} page={page} onError={setProblem} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  )
}
