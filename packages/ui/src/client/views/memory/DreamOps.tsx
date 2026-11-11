import { noteLines, t, type DreamEvidence, type DreamOp, type MemoryEntry } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { Badge } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'

const KIND_LABELS: Readonly<Record<DreamOp['kind'], string>> = {
  'note-upsert': '笔记',
  'note-archive': '归档笔记',
  'entry-supersede': '替掉',
  'entry-archive': '归档',
  'entry-move': '挪走',
  'entry-add': '新记',
  'entry-confirm': '确认',
  'core-set': '要点',
}

/** 一句话的出处：谁说的、原话是什么；聊天里的一句能点过去看。 */
export function Evidence(props: { readonly items: readonly DreamEvidence[] }) {
  const app = useApp()
  if (props.items.length === 0) return null
  const open = (ref: string): void => {
    api
      .message(ref.slice('message:'.length))
      .then((message) => app.focusMessage(message.roomId, message.seq, message.id))
      .catch(() => undefined)
  }
  return (
    <ul className="pod-dream-evidence">
      {props.items.map((item, index) => (
        <li key={`${item.ref}:${index}`}>
          {t('{who}的原话：「{quote}」', { who: item.by === 'owner' ? t('你') : item.by, quote: item.quote })}
          {item.ref.startsWith('message:') ? (
            <button type="button" className="pod-link" onClick={() => open(item.ref)}>
              {' '}
              {t('看原文')}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/** 一页笔记这一晚的样子：新加的句子标出来，去掉的划掉；每句下面是并进来的条目和原话。 */
function NoteChange(props: { readonly op: DreamOp }) {
  const { op } = props
  const draft = op.after.note
  if (draft === undefined) return null
  const before = new Set(noteLines(op.before.note?.body ?? ''))
  const after = noteLines(draft.body)
  const gone = [...before].filter((line) => !after.includes(line))
  const merged = new Map((op.before.merged ?? []).map((entry: MemoryEntry) => [entry.id, entry]))
  const priorTitle = op.before.note?.title
  return (
    <div className="pod-dream-note">
      <div className="pod-dream-note-title">
        {t('《{title}》', { title: draft.title })}
        {draft.description === '' ? null : <span className="pod-muted-inline"> {draft.description}</span>}
        {priorTitle === undefined || priorTitle === draft.title ? null : <span className="pod-muted-inline"> {t('原来叫《{title}》', { title: priorTitle })}</span>}
      </div>
      <ul className="pod-dream-lines">
        {after.map((line) => {
          const source = draft.sources.find((item) => item.line === line)
          const prior = op.before.note?.sources.find((item) => item.line === line)
          const fresh = !before.has(line)
          const checked = !fresh && source?.checkedAt !== undefined && source.checkedAt !== prior?.checkedAt
          const doubted = source?.doubt !== undefined && source.doubt !== prior?.doubt
          const entries = (source?.entries ?? []).map((id) => merged.get(id)).filter((entry): entry is MemoryEntry => entry !== undefined)
          return (
            <li key={line} className={fresh ? 'pod-dream-line-new' : undefined}>
              <div>
                {line}
                {checked ? (
                  <>
                    {' '}
                    <Badge tone="ok">{t('核对过')}</Badge>
                  </>
                ) : null}
                {doubted ? (
                  <>
                    {' '}
                    <Badge tone="warn">{t('拿不准')}</Badge>
                  </>
                ) : null}
              </div>
              {doubted ? (
                <ul className="pod-dream-evidence">
                  <li>{t('拿不准：{why}', { why: source?.doubt ?? '' })}</li>
                </ul>
              ) : null}
              {fresh && source?.replaces !== undefined ? (
                <ul className="pod-dream-evidence">
                  <li>{t('替了原来的：{old}', { old: source.replaces })}</li>
                </ul>
              ) : null}
              {fresh && entries.length > 0 ? (
                <ul className="pod-dream-evidence">
                  {entries.map((entry) => (
                    <li key={entry.id}>{t('并进来的条目：{content}', { content: entry.content })}</li>
                  ))}
                </ul>
              ) : null}
              {fresh || checked || doubted ? <Evidence items={source?.evidence ?? []} /> : null}
            </li>
          )
        })}
        {gone.map((line) => (
          <li key={`gone:${line}`} className="pod-dream-line-gone">
            {line}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Body(props: { readonly op: DreamOp }) {
  const { op } = props
  switch (op.kind) {
    case 'note-upsert':
      return <NoteChange op={op} />
    case 'note-archive':
      return <div>{t('《{title}》', { title: op.before.note?.title ?? '' })}</div>
    case 'entry-add':
      return (
        <div>
          {op.after.entry?.content}
          {op.after.entry?.status === 'pending' ? (
            <>
              {' '}
              <Badge tone="warn">{t('待确认')}</Badge>
            </>
          ) : null}
        </div>
      )
    case 'core-set':
      return (
        <div className="pod-dream-core">
          {op.before.text === undefined || op.before.text === '' ? null : <pre className="pod-dream-core-old">{op.before.text}</pre>}
          <pre>{op.after.text}</pre>
        </div>
      )
    default:
      return <div>{op.before.entry?.content}</div>
  }
}

/** 一处改动：种类、改的是什么、原因和出处。预览时前面有勾，去掉就不做这一处。 */
export function OpRow(props: { readonly op: DreamOp; readonly preview: boolean; readonly checked: boolean; readonly onToggle: () => void }) {
  const { op } = props
  const label = t(KIND_LABELS[op.kind])
  return (
    <li className={`pod-dream-op${op.revertedAt !== null || op.skipped !== '' ? ' pod-dream-op-off' : ''}`}>
      <div className="pod-row pod-wrap">
        {props.preview ? <input type="checkbox" checked={props.checked} onChange={props.onToggle} aria-label={t('做这一处改动')} /> : null}
        <Badge tone={op.kind === 'entry-supersede' || op.kind === 'entry-archive' || op.kind === 'note-archive' ? 'warn' : 'info'}>{label}</Badge>
        <span className="pod-muted-inline">{op.reason}</span>
        {op.revertedAt !== null ? <Badge>{t('已撤销')}</Badge> : null}
        {op.skipped === '' ? null : <Badge tone="warn">{t('没做：{why}', { why: op.skipped })}</Badge>}
      </div>
      <Body op={op} />
      {op.kind === 'note-upsert' ? null : <Evidence items={op.evidence} />}
    </li>
  )
}
