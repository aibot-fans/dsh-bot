import { useState } from 'react'
import { MEMORY_TYPES, MEMORY_TYPE_LABELS, type MemoryEntry, type MemoryScopeKind, type MemoryType } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Badge, Button, Empty, RelativeTime, clock } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  owner: '你说的',
  bot: 'bot 记下的',
  web: '来自网页',
  'other-bot': '其他 bot 说的',
  extracted: '自动提取',
  task: '任务复盘',
}

const ACTION_LABELS: Readonly<Record<string, string>> = {
  add: '新增',
  update: '修改',
  supersede: '被替代',
  core: '改核心记忆',
  revert: '撤销',
}

interface ScopeOption {
  readonly key: string
  readonly kind: MemoryScopeKind
  readonly id: string
  readonly label: string
}

function CoreEditor(props: { readonly scope: ScopeOption }) {
  const app = useApp()
  const key = `memory:core:${props.scope.key}`
  const { data: core } = useResource(app.cache, key, () => api.core(props.scope.kind, props.scope.id))
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  const text = draft ?? core?.text ?? ''
  return (
    <section className="pod-settings-section">
      <h2>核心记忆</h2>
      <p className="pod-muted">每段会话开始时放进提示词。{core?.userEdited === true ? '你改过，夜间整理不会改写它。' : ''}</p>
      <textarea className="pod-textarea" rows={5} value={text} onChange={(event) => setDraft(event.target.value)} placeholder="例如：用户是产品经理，喜欢先看结论再看细节" />
      <div className="pod-row">
        <Button
          small
          kind="primary"
          onClick={() => {
            void api.setCore(props.scope.kind, props.scope.id, text).then(() => {
              setDraft(undefined)
              setSaved(true)
              app.cache.invalidate(key)
            })
          }}
        >
          保存
        </Button>
        {saved ? <span className="pod-muted-inline">已保存，从下一段会话开始生效</span> : null}
      </div>
    </section>
  )
}

function EntryRow(props: { readonly entry: MemoryEntry; readonly onChanged: () => void }) {
  const { entry } = props
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(entry.content)
  const [error, setError] = useState<string | undefined>(undefined)
  const act = (work: () => Promise<unknown>): void => {
    work()
      .then(() => {
        setEditing(false)
        props.onChanged()
      })
      .catch((reason: unknown) => setError(errorText(reason)))
  }
  return (
    <li className={`pod-memory${entry.status === 'pending' ? ' pod-memory-pending' : ''}`}>
      <div className="pod-row pod-wrap">
        <Badge>{MEMORY_TYPE_LABELS[entry.type]}</Badge>
        <Badge tone={entry.source === 'web' ? 'warn' : 'muted'}>{SOURCE_LABELS[entry.source] ?? entry.source}</Badge>
        {entry.status === 'pending' ? <Badge tone="warn">待确认</Badge> : null}
        {entry.status === 'archived' ? <Badge>已归档</Badge> : null}
        {entry.pinned ? <Badge tone="info">置顶</Badge> : null}
        {entry.private ? <Badge>私密</Badge> : null}
        <span className="pod-muted-inline">
          <RelativeTime time={entry.updatedAt} />
          {entry.useCount > 0 ? ` · 用过 ${entry.useCount} 次` : ''}
        </span>
      </div>
      {editing ? (
        <div className="pod-row">
          <input className="pod-input" value={content} onChange={(event) => setContent(event.target.value)} />
          <Button small kind="primary" onClick={() => act(() => api.updateMemory(entry.id, { content }))}>
            保存
          </Button>
          <Button small kind="quiet" onClick={() => setEditing(false)}>
            取消
          </Button>
        </div>
      ) : (
        <div className="pod-memory-content">{entry.content}</div>
      )}
      <div className="pod-row pod-wrap">
        {entry.status === 'pending' ? (
          <Button small kind="primary" onClick={() => act(() => api.updateMemory(entry.id, { status: 'active' }))}>
            确认
          </Button>
        ) : null}
        <Button small kind="quiet" onClick={() => setEditing(true)}>
          编辑
        </Button>
        <Button small kind="quiet" onClick={() => act(() => api.updateMemory(entry.id, { pinned: !entry.pinned }))}>
          {entry.pinned ? '取消置顶' : '置顶'}
        </Button>
        {entry.scopeKind === 'owner' ? (
          <Button small kind="quiet" onClick={() => act(() => api.updateMemory(entry.id, { private: !entry.private }))}>
            {entry.private ? '取消私密' : '设为私密'}
          </Button>
        ) : null}
        <Button
          small
          kind="quiet"
          onClick={() => {
            if (window.confirm('删除这条记忆？之后可以在变更日志里撤销。')) act(() => api.deleteMemory(entry.id))
          }}
        >
          删除
        </Button>
      </div>
      {error === undefined ? null : <p className="pod-form-error">{error}</p>}
    </li>
  )
}

function AddEntry(props: { readonly scope: ScopeOption; readonly onAdded: () => void }) {
  const [content, setContent] = useState('')
  const [type, setType] = useState<MemoryType>('preference')
  const [error, setError] = useState<string | undefined>(undefined)
  return (
    <div className="pod-row pod-wrap">
      <select className="pod-input pod-input-number" value={type} onChange={(event) => setType(event.target.value as MemoryType)}>
        {MEMORY_TYPES.map((item) => (
          <option key={item} value={item}>
            {MEMORY_TYPE_LABELS[item]}
          </option>
        ))}
      </select>
      <input className="pod-input" style={{ flex: 1 }} value={content} placeholder="写一条新的记忆" onChange={(event) => setContent(event.target.value)} />
      <Button
        small
        kind="primary"
        onClick={() => {
          api
            .addMemory({ scope: props.scope.kind, scopeId: props.scope.id, type, content })
            .then(() => {
              setContent('')
              props.onAdded()
            })
            .catch((reason: unknown) => setError(errorText(reason)))
        }}
      >
        添加
      </Button>
      {error === undefined ? null : <p className="pod-form-error">{error}</p>}
    </div>
  )
}

/** 记忆变更日志：自动提取、夜间整理和你的改动都在这里，可以逐条撤销。 */
function Changes() {
  const app = useApp()
  const { data: changes, reload } = useResource(app.cache, 'memory:changes', () => api.memoryChanges())
  if (changes === undefined || changes.length === 0) return <p className="pod-muted">还没有变更。</p>
  return (
    <ol className="pod-events">
      {changes.map((change) => (
        <li key={change.id}>
          <time>{clock(change.createdAt)}</time>
          {ACTION_LABELS[change.action] ?? change.action}：{change.after?.content ?? change.before?.content ?? change.reason}
          <span className="pod-muted-inline"> · {change.reason}</span>
          {change.revertedAt !== null || change.action === 'core' || change.action === 'revert' ? null : (
            <button type="button" className="pod-link" onClick={() => void api.revertMemory(change.id).then(reload)}>
              {' '}
              撤销
            </button>
          )}
        </li>
      ))}
    </ol>
  )
}

export interface MemoryScope {
  readonly kind: MemoryScopeKind
  readonly id: string
  readonly label: string
}

/** 一个作用域的记忆：核心记忆、添加、待确认和已有条目。bot 详情、群聊详情和设置里的“你的档案”都用它。 */
export function MemoryPanel(props: { readonly scope: MemoryScope }) {
  const app = useApp()
  const scope: ScopeOption = { key: `${props.scope.kind}:${props.scope.id}`, ...props.scope }
  const listKey = `memory:list:${scope.key}`
  const { data: entries, reload } = useResource(app.cache, listKey, () => api.memories(scope.kind, scope.id))
  const pending = (entries ?? []).filter((entry) => entry.status === 'pending')
  const others = (entries ?? []).filter((entry) => entry.status !== 'pending')
  return (
    <div className="pod-stack">
      <p className="pod-muted">记忆管“知道什么”。核心记忆每段会话开始时放进提示词；条目数量不限，用到时再取。网页来源的条目单独标记。</p>
      <CoreEditor key={scope.key} scope={scope} />
      <AddEntry scope={scope} onAdded={reload} />
      {pending.length === 0 ? null : (
        <section className="pod-stack">
          <div className="pod-section-title">待确认（bot 推断的，确认后才会使用）</div>
          <ul className="pod-memories">
            {pending.map((entry) => (
              <EntryRow key={entry.id} entry={entry} onChanged={reload} />
            ))}
          </ul>
        </section>
      )}
      {others.length === 0 && pending.length === 0 ? (
        <Empty title="还没有记忆">对 bot 说“记住……”，或者在上面直接添加。</Empty>
      ) : (
        <ul className="pod-memories">
          {others.map((entry) => (
            <EntryRow key={entry.id} entry={entry} onChanged={reload} />
          ))}
        </ul>
      )}
    </div>
  )
}

export { Changes as MemoryChanges }
