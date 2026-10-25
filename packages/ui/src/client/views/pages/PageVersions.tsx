import { OWNER, PAGE_SOURCE_LABELS, type Bot, type Page, type PageVersionInfo } from 'pod-domain'
import { Badge, Button, RelativeTime } from '../../components/common.tsx'

function authorName(author: string, bots: ReadonlyMap<string, Bot>): string {
  if (author === OWNER) return '你'
  return bots.get(author)?.name ?? '已删除的 bot'
}

/**
 * 版本列表：第几版、什么时候、谁改的、怎么来的、改了什么。点一版在左边预览；
 * 预览旧版时可以“恢复成这一版”：把它复制成新的一版，中间的版本都还在。
 */
export function PageVersions(props: {
  readonly page: Page
  readonly versions: readonly PageVersionInfo[]
  readonly viewing: number
  readonly bots: ReadonlyMap<string, Bot>
  readonly busy: boolean
  readonly onPreview: (version: number | undefined) => void
  readonly onRestore: (version: number) => void
}) {
  const { page } = props
  return (
    <ol className="pod-page-versions">
      {props.versions.map((item) => {
        const latest = item.version === page.version
        const active = item.version === props.viewing
        return (
          <li key={item.version} className={active ? 'pod-page-version-on' : undefined}>
            <button type="button" className="pod-page-version" aria-current={active ? 'true' : undefined} onClick={() => props.onPreview(latest ? undefined : item.version)}>
              <span className="pod-row">
                <strong>第 {item.version} 版</strong>
                {latest ? <Badge tone="info">最新</Badge> : null}
                <span className="pod-grow" />
                <span className="pod-muted-inline">
                  <RelativeTime time={item.createdAt} />
                </span>
              </span>
              <span className="pod-muted-inline">
                {authorName(item.author, props.bots)} · {PAGE_SOURCE_LABELS[item.source]}
                {item.title === page.title ? '' : ` · 当时叫「${item.title}」`}
              </span>
              {item.note === '' ? null : <span className="pod-page-version-note">{item.note}</span>}
            </button>
            {active && !latest ? (
              <div className="pod-page-version-actions">
                <Button small kind="primary" icon="restore" disabled={props.busy} onClick={() => props.onRestore(item.version)}>
                  恢复成这一版
                </Button>
              </div>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
