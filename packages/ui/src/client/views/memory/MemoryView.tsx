import { useState } from 'react'
import { MEMORY_TYPES, MEMORY_TYPE_LABELS, t, tc, type MemoryEntry, type MemoryScopeKind, type MemoryType } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Badge, Button, Empty, RelativeTime, clock } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { DreamBar, NotesSection } from './Notes.tsx'

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
  core: '改要点',
  revert: '撤销',
  merge: '并进笔记',
  archive: '归档',
  confirm: '确认',
  move: '挪到别处',
  note: '改笔记',
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
      <h2>{t('要点')}</h2>
      <p className="pod-muted">{t('最要紧的几句，每段会话开头都带着；夜里整理时更新。{value}', { value: core?.userEdited === true ? t('你改过，整理时不会再改写它。') : '' })}</p>
      <textarea className="pod-textarea" rows={5} value={text} onChange={(event) => setDraft(event.target.value)} placeholder={t('例如：用户是产品经理，喜欢先看结论再看细节')} />
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
          {t('保存')}
        </Button>
        {saved ? <span className="pod-muted-inline">{t('已保存，从下一段会话开始生效')}</span> : null}
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
        <Badge>{t(MEMORY_TYPE_LABELS[entry.type])}</Badge>
        <Badge tone={entry.source === 'web' ? 'warn' : 'muted'}>{t(SOURCE_LABELS[entry.source] ?? entry.source)}</Badge>
        {entry.status === 'pending' ? <Badge tone="warn">{t('待确认')}</Badge> : null}
        {entry.status === 'archived' ? <Badge>{t('已归档')}</Badge> : null}
        {entry.pinned ? <Badge tone="info">{tc('置顶', '状态')}</Badge> : null}
        {entry.private ? <Badge>{t('私密')}</Badge> : null}
        <span className="pod-muted-inline">
          <RelativeTime time={entry.updatedAt} />
          {entry.useCount > 0 ? t(' · 用过 {useCount} 次', { useCount: entry.useCount }) : ''}
        </span>
      </div>
      {editing ? (
        <div className="pod-row">
          <input className="pod-input" value={content} onChange={(event) => setContent(event.target.value)} />
          <Button small kind="primary" onClick={() => act(() => api.updateMemory(entry.id, { content }))}>
            {t('保存')}
          </Button>
          <Button small kind="quiet" onClick={() => setEditing(false)}>
            {t('取消')}
          </Button>
        </div>
      ) : (
        <div className="pod-memory-content">{entry.content}</div>
      )}
      <div className="pod-row pod-wrap">
        {entry.status === 'pending' ? (
          <Button small kind="primary" onClick={() => act(() => api.updateMemory(entry.id, { status: 'active' }))}>
            {t('确认')}
          </Button>
        ) : null}
        <Button small kind="quiet" onClick={() => setEditing(true)}>
          {t('编辑')}
        </Button>
        <Button small kind="quiet" onClick={() => act(() => api.updateMemory(entry.id, { pinned: !entry.pinned }))}>
          {entry.pinned ? t('取消置顶') : t('置顶')}
        </Button>
        {entry.scopeKind === 'owner' ? (
          <Button small kind="quiet" onClick={() => act(() => api.updateMemory(entry.id, { private: !entry.private }))}>
            {entry.private ? t('取消私密') : t('设为私密')}
          </Button>
        ) : null}
        <Button
          small
          kind="quiet"
          onClick={() => {
            if (window.confirm(t('删除这条记忆？之后可以在变更日志里撤销。'))) act(() => api.deleteMemory(entry.id))
          }}
        >
          {t('删除')}
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
            {t(MEMORY_TYPE_LABELS[item])}
          </option>
        ))}
      </select>
      <input className="pod-input" style={{ flex: 1 }} value={content} placeholder={t('写一条新的记忆')} onChange={(event) => setContent(event.target.value)} />
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
        {t('添加')}
      </Button>
      {error === undefined ? null : <p className="pod-form-error">{error}</p>}
    </div>
  )
}

/** 记忆变更日志：自动提取、夜间整理和你的改动都在这里，可以逐条撤销。 */
function Changes() {
  const app = useApp()
  const { data: changes, reload } = useResource(app.cache, 'memory:changes', () => api.memoryChanges())
  if (changes === undefined || changes.length === 0) return <p className="pod-muted">{t('还没有变更。')}</p>
  return (
    <ol className="pod-events">
      {changes.map((change) => (
        <li key={change.id}>
          <time>{clock(change.createdAt)}</time>
          {t('{value}：{value2}', { value: tc(ACTION_LABELS[change.action] ?? change.action, '变更'), value2: change.after?.content ?? change.before?.content ?? change.reason })}
          <span className="pod-muted-inline"> · {change.reason}</span>
          {change.revertedAt !== null || change.action === 'core' || change.action === 'revert' || change.action === 'note' ? null : (
            <button type="button" className="pod-link" onClick={() => void api.revertMemory(change.id).then(reload)}>
              {' '}
              {t('撤销')}
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

/**
 * 一个范围的记忆，从上到下：上次整理了什么、要点、主题笔记，最后是还没整理进笔记的条目（待确认的在前）。
 * bot 详情、群聊详情和设置里的“你的档案”都用它。
 */
export function MemoryPanel(props: { readonly scope: MemoryScope }) {
  const app = useApp()
  const scope: ScopeOption = { key: `${props.scope.kind}:${props.scope.id}`, ...props.scope }
  const listKey = `memory:list:${scope.key}`
  const { data: entries, reload } = useResource(app.cache, listKey, () => api.memories(scope.kind, scope.id))
  const pending = (entries ?? []).filter((entry) => entry.status === 'pending')
  const others = (entries ?? []).filter((entry) => entry.status !== 'pending')
  return (
    <div className="pod-stack">
      <p className="pod-muted">{t('记忆管“知道什么”。白天 bot 随手记成一条条的；夜里整理时并成主题笔记、更新要点。每段会话开头带要点和笔记目录，别的用到时再查。')}</p>
      <DreamBar scope={scope} />
      <CoreEditor key={scope.key} scope={scope} />
      <NotesSection scope={scope} />
      <div className="pod-section-title">{t('还没整理进笔记的（{count} 条）', { count: others.filter((entry) => entry.status === 'active').length })}</div>
      <AddEntry scope={scope} onAdded={reload} />
      {pending.length === 0 ? null : (
        <section className="pod-stack">
          <div className="pod-section-title">{t('待确认（bot 推断的，确认后才会使用）')}</div>
          <ul className="pod-memories">
            {pending.map((entry) => (
              <EntryRow key={entry.id} entry={entry} onChanged={reload} />
            ))}
          </ul>
        </section>
      )}
      {others.length === 0 && pending.length === 0 ? (
        <Empty title={t('没有零散的条目')}>{t('对 bot 说“记住……”，或者在上面直接添加。')}</Empty>
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
