import { useState } from 'react'
import { noteLines, t, type MemoryEntry, type MemoryNote, type MemoryScopeKind } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Badge, Button, RelativeTime } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { Evidence } from './DreamOps.tsx'
import { dreamSummary } from './Dreams.tsx'

export interface NoteScope {
  readonly key: string
  readonly kind: MemoryScopeKind
  readonly id: string
}

function shortDate(time: number): string {
  const date = new Date(time)
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

/**
 * 一页笔记：收起时只有标题和一句说明；点开是正文，每句后面是它的日期，拿不准的标出来；
 * 每句话能看出处（并进来的条目、原话、最近什么时候核对过、替了原来的哪一句）；下面列着相关的页；能改、能归档。
 */
function NoteCard(props: { readonly note: MemoryNote; readonly merged: ReadonlyMap<string, MemoryEntry>; readonly titles: ReadonlyMap<string, string>; readonly onChanged: () => void }) {
  const { note } = props
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(note.title)
  const [description, setDescription] = useState(note.description)
  const [body, setBody] = useState(note.body)
  const [error, setError] = useState<string | undefined>(undefined)
  const save = (patch: unknown): void => {
    api
      .updateNote(note.id, patch)
      .then(() => {
        setEditing(false)
        setError(undefined)
        props.onChanged()
      })
      .catch((reason: unknown) => setError(errorText(reason)))
  }
  return (
    <li className={`pod-note${note.status === 'archived' ? ' pod-note-archived' : ''}`}>
      <button type="button" className="pod-note-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="pod-note-title">{note.title}</span>
        <span className="pod-note-about">{note.description}</span>
        {note.userEdited ? <Badge>{t('你改过')}</Badge> : null}
        {note.status === 'archived' ? <Badge>{t('已归档')}</Badge> : null}
        <span className="pod-muted-inline">
          <RelativeTime time={note.updatedAt} />
        </span>
      </button>
      {!open ? null : editing ? (
        <div className="pod-stack">
          <input className="pod-input" value={title} onChange={(event) => setTitle(event.target.value)} aria-label={t('标题')} />
          <input className="pod-input" value={description} onChange={(event) => setDescription(event.target.value)} aria-label={t('一句说明')} placeholder={t('一句说明：这页里有什么')} />
          <textarea className="pod-textarea" rows={Math.min(16, Math.max(4, noteLines(body).length + 1))} value={body} onChange={(event) => setBody(event.target.value)} aria-label={t('正文')} />
          <p className="pod-muted">{t('一行一句。你改过的页，夜里的整理不会再改写它。')}</p>
          <div className="pod-row">
            <Button small kind="primary" onClick={() => save({ title, description, body })}>
              {t('保存')}
            </Button>
            <Button small kind="quiet" onClick={() => setEditing(false)}>
              {t('取消')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="pod-stack">
          <ul className="pod-note-lines">
            {noteLines(note.body).map((line) => {
              const source = note.sources.find((item) => item.line === line)
              const entries = (source?.entries ?? []).map((id) => props.merged.get(id)).filter((entry): entry is MemoryEntry => entry !== undefined)
              const traced = source !== undefined && (entries.length + source.evidence.length > 0 || source.doubt !== undefined || source.replaces !== undefined || source.checkedAt !== undefined)
              return (
                <li key={line}>
                  <div className="pod-row">
                    <span className="pod-note-line">{line}</span>
                    {source?.doubt === undefined ? null : <Badge tone="warn">{t('拿不准')}</Badge>}
                    <span className="pod-muted-inline pod-note-date">{shortDate(source?.at ?? note.updatedAt)}</span>
                    {traced ? (
                      <button type="button" className="pod-link pod-note-trace" onClick={() => setShown(shown === line ? undefined : line)}>
                        {t('出处')}
                      </button>
                    ) : null}
                  </div>
                  {shown === line && source !== undefined ? (
                    <>
                      {source.doubt === undefined && source.replaces === undefined && source.checkedAt === undefined ? null : (
                        <ul className="pod-dream-evidence">
                          {source.doubt === undefined ? null : <li>{t('拿不准：{why}', { why: source.doubt })}</li>}
                          {source.replaces === undefined ? null : <li>{t('替了原来的：{old}', { old: source.replaces })}</li>}
                          {source.checkedAt === undefined ? null : <li>{t('最近核对：{date}', { date: shortDate(source.checkedAt) })}</li>}
                        </ul>
                      )}
                      {entries.length === 0 ? null : (
                        <ul className="pod-dream-evidence">
                          {entries.map((entry) => (
                            <li key={entry.id}>
                              {t('并进来的条目：{content}', { content: entry.content })}
                              <span className="pod-muted-inline">
                                {' '}
                                <RelativeTime time={entry.createdAt} />
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <Evidence items={source.evidence} />
                    </>
                  ) : null}
                </li>
              )
            })}
          </ul>
          {note.links.some((id) => props.titles.has(id)) ? (
            <p className="pod-muted">
              {t('相关：{titles}', {
                titles: note.links
                  .flatMap((id) => props.titles.get(id) ?? [])
                  .map((title) => `《${title}》`)
                  .join(t('、')),
              })}
            </p>
          ) : null}
          <div className="pod-row pod-wrap">
            <Button small kind="quiet" onClick={() => setEditing(true)}>
              {t('编辑')}
            </Button>
            <Button small kind="quiet" onClick={() => save({ status: note.status === 'archived' ? 'active' : 'archived' })}>
              {note.status === 'archived' ? t('恢复') : t('归档')}
            </Button>
          </div>
        </div>
      )}
      {error === undefined ? null : <p className="pod-form-error">{error}</p>}
    </li>
  )
}

/** 一个范围的主题笔记：整理过以后，说同一件事的条目并在一页里；每段会话开头带的是这些页的目录。 */
export function NotesSection(props: { readonly scope: NoteScope }) {
  const app = useApp()
  const { scope } = props
  const { data, reload } = useResource(app.cache, `memory:notes:${scope.key}`, () => api.notes(scope.kind, scope.id))
  const notes = data?.notes ?? []
  const merged = new Map((data?.merged ?? []).map((entry) => [entry.id, entry]))
  const titles = new Map(notes.filter((note) => note.status === 'active').map((note) => [note.id, note.title]))
  return (
    <section className="pod-stack">
      <div className="pod-section-title">{t('主题笔记（{count} 页）', { count: notes.filter((note) => note.status === 'active').length })}</div>
      {notes.length === 0 ? (
        <p className="pod-muted">{t('还没有笔记。整理过一次以后，说同一件事的条目会并成一页，每段会话开头带这些页的目录。')}</p>
      ) : (
        <ul className="pod-notes">
          {notes.map((note) => (
            <NoteCard key={`${note.id}:${note.updatedAt}`} note={note} merged={merged} titles={titles} onChanged={reload} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** “整理时留意什么”：给这个范围写一句，夜里整理时带着它。 */
function Guide(props: { readonly scope: NoteScope; readonly guide: string; readonly onSaved: () => void }) {
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const text = draft ?? props.guide
  return (
    <details className="pod-dream-guide">
      <summary>{t('整理时留意什么')}</summary>
      <div className="pod-row">
        <input className="pod-input" style={{ flex: 1 }} value={text} placeholder={t('比如：多留命令和踩过的坑，一次性的数字不要')} onChange={(event) => setDraft(event.target.value)} />
        <Button
          small
          onClick={() => {
            void api.setGuide(props.scope.kind, props.scope.id, text).then(() => {
              setDraft(undefined)
              props.onSaved()
            })
          }}
        >
          {t('保存')}
        </Button>
      </div>
    </details>
  )
}

/** 记忆页最上面那一条：上次整理了什么、有没有等你看的，能现在整理、看整理记录。 */
export function DreamBar(props: { readonly scope: NoteScope }) {
  const app = useApp()
  const { scope } = props
  const { data: dreams } = useResource(app.cache, 'memory:dreams', () => api.dreams())
  const { data: notes, reload } = useResource(app.cache, `memory:notes:${scope.key}`, () => api.notes(scope.kind, scope.id))
  const [error, setError] = useState<string | undefined>(undefined)
  const list = dreams ?? []
  const working = list.some((dream) => dream.status === 'running' || dream.status === 'paused')
  const waiting = list.find((dream) => dream.status === 'preview')
  const last = list.find((dream) => dream.status === 'applied' || dream.status === 'empty')
  return (
    <section className="pod-dream-bar">
      <div className="pod-row pod-wrap">
        <span className="pod-dream-bar-text">
          {working ? t('正在整理…') : waiting !== undefined ? t('整理好了一版，等你看：{summary}', { summary: dreamSummary(waiting) }) : last === undefined ? t('还没有整理过：条目多了以后，开头只带得下最近的几条。') : t('上次整理：{summary}', { summary: dreamSummary(last) })}
        </span>
        {waiting === undefined ? null : (
          <Button small kind="primary" onClick={() => app.openDrawer({ kind: 'dreams', dreamId: waiting.id })}>
            {t('去看')}
          </Button>
        )}
        <Button
          small
          disabled={working || waiting !== undefined}
          onClick={() => {
            setError(undefined)
            api
              .startDream(scope.kind, scope.id)
              .then(() => app.cache.invalidate('memory'))
              .catch((reason: unknown) => setError(errorText(reason)))
          }}
        >
          {t('现在整理')}
        </Button>
        <Button small kind="quiet" onClick={() => app.openDrawer({ kind: 'dreams' })}>
          {t('整理记录')}
        </Button>
      </div>
      {error === undefined ? null : <p className="pod-form-error">{error}</p>}
      <Guide key={notes?.guide ?? ''} scope={scope} guide={notes?.guide ?? ''} onSaved={reload} />
    </section>
  )
}
