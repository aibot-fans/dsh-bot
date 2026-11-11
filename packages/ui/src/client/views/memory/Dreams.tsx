import { useState } from 'react'
import { t, type DreamDetail, type DreamQuestion, type MemoryDream } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Badge, Button, Empty, money, tokens } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { OpRow } from './DreamOps.tsx'

const STATUS_LABELS: Readonly<Record<MemoryDream['status'], string>> = {
  running: '正在整理',
  paused: '先停着',
  preview: '等你看',
  applied: '已生效',
  discarded: '你没要',
  reverted: '已撤销',
  failed: '没做成',
  empty: '没有要改的',
}

const STATUS_TONES: Readonly<Record<MemoryDream['status'], 'warn' | 'info' | 'ok' | 'muted' | 'danger'>> = {
  running: 'info',
  paused: 'muted',
  preview: 'warn',
  applied: 'ok',
  discarded: 'muted',
  reverted: 'muted',
  failed: 'danger',
  empty: 'muted',
}

function stamp(time: number): string {
  const date = new Date(time)
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** 一晚整理了什么，一句话。 */
export function dreamSummary(dream: MemoryDream): string {
  const { stats } = dream
  if (dream.status === 'running') return t('正在读记录、核对记忆……')
  if (dream.status === 'paused') return t('有任务在跑，先停着，空了接着做')
  if (dream.status === 'failed') return t('没做成：{error}', { error: dream.error })
  if (dream.status === 'empty') return t('读了 {records} 份记录，没有要改的', { records: stats.records })
  const parts = [
    stats.notes > 0 ? t('写了 {notes} 页笔记', { notes: stats.notes }) : '',
    stats.merged > 0 ? t('并进 {merged} 条', { merged: stats.merged }) : '',
    stats.changed > 0 ? t('替掉、归档 {changed} 条', { changed: stats.changed }) : '',
    stats.added > 0 ? t('新记 {added} 条', { added: stats.added }) : '',
    stats.questions > 0 ? t('有 {questions} 件想跟你确认', { questions: stats.questions }) : '',
  ].filter((part) => part !== '')
  return t('读了 {records} 份记录；{changes}', { records: stats.records, changes: parts.length === 0 ? t('没有要改的') : parts.join(t('，')) })
}

function Question(props: { readonly dreamId: string; readonly question: DreamQuestion; readonly onDone: () => void; readonly onError: (message: string) => void }) {
  const { question } = props
  return (
    <li className="pod-dream-question">
      <div>{question.text}</div>
      <div className="pod-row pod-wrap">
        {question.options.map((option) => (
          <Button
            key={option.label}
            small
            kind={question.answer === option.label ? 'primary' : 'default'}
            disabled={question.answer !== null}
            onClick={() => {
              api
                .answerDream(props.dreamId, question.id, option.label)
                .then(props.onDone)
                .catch((reason: unknown) => props.onError(errorText(reason)))
            }}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </li>
  )
}

/** 一晚的全部改动：按范围分开列；等你看的可以去掉几处再生效，生效了的能整晚撤销。 */
function DreamView(props: { readonly id: string }) {
  const app = useApp()
  const key = `memory:dream:${props.id}`
  const { data, reload } = useResource<DreamDetail>(app.cache, key, () => api.dream(props.id))
  const [skip, setSkip] = useState<ReadonlySet<number>>(new Set())
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  if (data === undefined) return <p className="pod-muted">{t('加载中…')}</p>
  const { dream, ops } = data
  const preview = dream.status === 'preview'
  const act = (work: () => Promise<unknown>): void => {
    setBusy(true)
    setError(undefined)
    work()
      .then(() => {
        app.cache.invalidate('memory')
        reload()
      })
      .catch((reason: unknown) => setError(errorText(reason)))
      .finally(() => setBusy(false))
  }
  const answers = new Set(dream.questions.flatMap((question) => question.options.flatMap((option) => option.ops)))
  const main = ops.filter((op) => !op.held)
  const chosen = ops.filter((op) => op.held && answers.has(op.seq) && op.appliedAt !== null)
  const scopes = [...new Set(main.map((op) => `${op.scopeKind}:${op.scopeId}`))]
  const label = (scope: string): string => dream.scopes.find((item) => `${item.kind}:${item.id}` === scope)?.label ?? scope
  const toggle = (seq: number): void => {
    const next = new Set(skip)
    if (next.has(seq)) next.delete(seq)
    else next.add(seq)
    setSkip(next)
  }
  return (
    <div className="pod-dream-detail">
      {preview && dream.held !== '' ? <p className="pod-dream-held">{dream.held}</p> : null}
      {dream.questions.length === 0 ? null : (
        <section className="pod-stack">
          <div className="pod-section-title">{t('想跟你确认的')}</div>
          <ul className="pod-dream-ops">
            {dream.questions.map((question) => (
              <Question key={question.id} dreamId={dream.id} question={question} onDone={() => act(() => Promise.resolve())} onError={setError} />
            ))}
          </ul>
        </section>
      )}
      {scopes.map((scope) => (
        <section key={scope} className="pod-stack">
          <div className="pod-section-title">{label(scope)}</div>
          <ul className="pod-dream-ops">
            {main
              .filter((op) => `${op.scopeKind}:${op.scopeId}` === scope)
              .map((op) => (
                <OpRow key={op.seq} op={op} preview={preview} checked={!skip.has(op.seq)} onToggle={() => toggle(op.seq)} />
              ))}
          </ul>
        </section>
      ))}
      {chosen.length === 0 ? null : (
        <section className="pod-stack">
          <div className="pod-section-title">{t('你回答以后做的')}</div>
          <ul className="pod-dream-ops">
            {chosen.map((op) => (
              <OpRow key={op.seq} op={op} preview={false} checked onToggle={() => undefined} />
            ))}
          </ul>
        </section>
      )}
      {dream.rejected.length === 0 ? null : (
        <details className="pod-dream-rejected">
          <summary>{t('核对没过、没有落库的 {count} 条', { count: dream.stats.rejected })}</summary>
          <ul>
            {dream.rejected.map((item, index) => (
              <li key={`${index}:${item.what}`}>
                {item.what}
                <span className="pod-muted-inline"> · {item.why}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="pod-row pod-wrap">
        {preview ? (
          <>
            <Button small kind="primary" disabled={busy || main.length === skip.size} onClick={() => act(() => api.applyDream(dream.id, [...skip]))}>
              {skip.size === 0 ? t('让这些改动生效') : t('让勾着的 {count} 处生效', { count: main.length - skip.size })}
            </Button>
            <Button small kind="quiet" disabled={busy} onClick={() => act(() => api.discardDream(dream.id))}>
              {t('这一版不要了')}
            </Button>
          </>
        ) : null}
        {dream.status === 'applied' && main.some((op) => op.appliedAt !== null) ? (
          <Button
            small
            kind="quiet"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t('把这一次整理的改动全部撤回去？之后又改过的那几处不动。'))) act(() => api.revertDream(dream.id))
            }}
          >
            {t('整晚撤销')}
          </Button>
        ) : null}
        <span className="pod-muted-inline">
          {t('用了 {input} 输入、{output} 输出', { input: tokens(dream.stats.inputTokens), output: tokens(dream.stats.outputTokens) })}
          {dream.stats.cost > 0 ? t('，约 {cost}', { cost: money(dream.stats.cost) }) : ''}
          {dream.model === '' ? '' : ` · ${dream.model}`}
        </span>
      </div>
      {error === undefined ? null : <p className="pod-form-error">{error}</p>}
    </div>
  )
}

/** 整理记录：一晚一行，点开看这一晚的全部改动。最上面能随时叫它整理一次。 */
export function DreamsPanel(props: { readonly dreamId?: string }) {
  const app = useApp()
  const { data: dreams } = useResource(app.cache, 'memory:dreams', () => api.dreams())
  const [picked, setPicked] = useState<string | null | undefined>(props.dreamId)
  const [error, setError] = useState<string | undefined>(undefined)
  const list = dreams ?? []
  const working = list.some((dream) => dream.status === 'running' || dream.status === 'paused')
  // 没点过哪一行时，等你看的那一次自己展开。
  const open = picked === undefined ? list.find((dream) => dream.status === 'preview')?.id : (picked ?? undefined)
  return (
    <div className="pod-stack">
      <p className="pod-muted">
        {t('每晚空下来的时候，dsh-bot 拿当天的对话核对记忆：说同一件事的条目并成一页笔记，过时的说法换掉，再重写每段会话开头带的要点。每句话都留着出处，每一处改动都留着改之前的样子，能整晚撤销。')}
      </p>
      <div className="pod-row pod-wrap">
        <Button
          small
          kind="primary"
          disabled={working}
          onClick={() => {
            setError(undefined)
            api
              .startDream()
              .then(() => app.cache.invalidate('memory'))
              .catch((reason: unknown) => setError(errorText(reason)))
          }}
        >
          {working ? t('正在整理…') : t('现在整理')}
        </Button>
        {error === undefined ? null : <span className="pod-form-error">{error}</span>}
      </div>
      {list.length === 0 ? (
        <Empty title={t('还没有整理过')}>{t('点上面的“现在整理”，或者等今晚自动做。头 3 次的结果先给你看，点了才生效。')}</Empty>
      ) : (
        <ul className="pod-dreams">
          {list.map((dream) => (
            <li key={dream.id} className="pod-dream">
              <button type="button" className="pod-dream-head" onClick={() => setPicked(open === dream.id ? null : dream.id)} aria-expanded={open === dream.id}>
                <time>{stamp(dream.startedAt)}</time>
                <Badge tone={STATUS_TONES[dream.status]}>{t(STATUS_LABELS[dream.status])}</Badge>
                <span className="pod-dream-summary">{dreamSummary(dream)}</span>
                <span className="pod-muted-inline">{dream.trigger === 'manual' ? t('你叫的') : t('夜里自动')}</span>
              </button>
              {open === dream.id && dream.status !== 'running' && dream.status !== 'paused' ? <DreamView id={dream.id} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
