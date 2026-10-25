import { useEffect, useState } from 'react'
import { api, type LibraryItem } from '../../api/endpoints.ts'
import { mediaUrl } from '../../api/http.ts'
import { Empty, RelativeTime } from '../../components/common.tsx'
import { FilePreview } from '../../components/FilePreview.tsx'
import { Icon } from '../../components/Icon.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

const WEEK = 7 * 24 * 3_600_000
const FOLDED = 8

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function Item(props: { readonly item: LibraryItem; readonly onOpen: () => void }) {
  const { item } = props
  return (
    <button type="button" className="pod-lib-item" onClick={props.onOpen}>
      {item.kind === 'image' ? (
        <img className="pod-lib-thumb" src={mediaUrl('/file', { path: item.path })} alt="" loading="lazy" />
      ) : (
        <span className={`pod-lib-icon pod-lib-${item.kind}`} aria-hidden>
          <Icon name={item.kind === 'web' ? 'browser' : 'file'} size={16} />
        </span>
      )}
      <span className="pod-lib-text">
        <span className="pod-ellipsis">{item.name}</span>
        <span className="pod-muted-inline">
          {size(item.size)} · <RelativeTime time={item.modifiedAt} />
        </span>
      </span>
    </button>
  )
}

/** 资料库：对话里产出的文档、截图、网页存档和你上传的文件，按本周和更早分组，点开预览。 */
export function Library(props: { readonly botId?: string; readonly roomId?: string }) {
  const app = useApp()
  const key = `library:${props.botId ?? ''}:${props.roomId ?? ''}`
  const { data, error, reload } = useResource(app.cache, key, () => api.library({ botId: props.botId, roomId: props.roomId }))
  const [open, setOpen] = useState<LibraryItem | undefined>(undefined)
  const [expanded, setExpanded] = useState(false)
  // 每次打开都重新看一眼文件夹：文件是 bot 在工作区里写的，没有事件通知。
  useEffect(() => reload(), [reload])
  if (error !== undefined) return <p className="pod-form-error">{error}</p>
  if (data === undefined) return <p className="pod-muted">正在读取…</p>
  if (data.length === 0) return <Empty title="资料库是空的">对话里产出的文档、截图和你上传的文件会出现在这里。</Empty>
  const now = Date.now()
  const recent = data.filter((item) => now - item.modifiedAt < WEEK)
  const older = data.filter((item) => now - item.modifiedAt >= WEEK)
  const shown = expanded ? older : older.slice(0, FOLDED)
  return (
    <div className="pod-stack">
      {recent.length === 0 ? null : (
        <section className="pod-stack">
          <div className="pod-section-title">本周</div>
          <div className="pod-lib-list">
            {recent.map((item) => (
              <Item key={item.path} item={item} onOpen={() => setOpen(item)} />
            ))}
          </div>
        </section>
      )}
      {older.length === 0 ? null : (
        <section className="pod-stack">
          <div className="pod-section-title">更早</div>
          <div className="pod-lib-list">
            {shown.map((item) => (
              <Item key={item.path} item={item} onOpen={() => setOpen(item)} />
            ))}
          </div>
          {older.length > FOLDED && !expanded ? (
            <button type="button" className="pod-link" onClick={() => setExpanded(true)}>
              展开另外 {older.length - FOLDED} 个
            </button>
          ) : null}
        </section>
      )}
      {open === undefined ? null : <FilePreview path={open.path} onClose={() => setOpen(undefined)} />}
    </div>
  )
}
