import { useMemo, useState } from 'react'
import { TICKET_STAGE_LABELS, t, type Bot, type PodSettings } from 'pod-domain'
import { api, type ActiveItem } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Badge, Button, IconButton, useNow } from '../../components/common.tsx'
import { duration } from '../../components/duration.ts'
import { BotName } from '../../components/GroupMark.tsx'
import { useNarrow } from '../../components/media.ts'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { problemLabel } from '../SystemBanners.tsx'
import { AttentionRow } from './AttentionRow.tsx'

/** 系统好不好：系统问题、暂停处理的开关、任务名额用了几个；没问题时只占一行。 */
function Health(props: { readonly slots: { readonly used: number; readonly total: number } | undefined }) {
  const app = useApp()
  const { data: health } = useResource(app.cache, 'health', () => api.health())
  const { data: settings } = useResource(app.cache, 'settings', () => api.settings())
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const paused = settings?.paused === true
  const problems = health?.problems ?? []
  const togglePause = (): void => {
    setProblem(undefined)
    api
      .updateSettings({ paused: !paused })
      .then((next) => app.cache.update<PodSettings>('settings', () => next))
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  const retry = (kind: string): void => {
    setBusy(kind)
    setProblem(undefined)
    api
      .retryProblem(kind)
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(null))
  }
  return (
    <section className="pod-overview-section">
      <div className="pod-section-title">{t('系统好不好')}</div>
      <div className="pod-health-line">
        {paused ? <Badge tone="warn">{t('处理已暂停')}</Badge> : problems.length === 0 ? <Badge tone="ok">{t('正常')}</Badge> : <Badge tone="danger">{t('{count} 个问题', { count: problems.length })}</Badge>}
        {props.slots === undefined ? null : <span className="pod-muted-inline">{t('任务名额 {used}/{total}', { used: props.slots.used, total: props.slots.total })}</span>}
        <span className="pod-grow" />
        <Button small kind={paused ? 'primary' : 'quiet'} icon={paused ? 'play' : 'pause'} onClick={togglePause}>
          {paused ? t('继续处理') : t('暂停处理')}
        </Button>
      </div>
      {problems.map((item) => (
        <div key={item.id} className="pod-problem">
          <span className="pod-problem-text">
            <strong>{problemLabel(item.kind)}</strong>
            <span>{item.detail}</span>
            <span className="pod-problem-meta">{t('连续 {count} 次', { count: item.failures })}</span>
          </span>
          <Button small disabled={busy === item.kind} onClick={() => retry(item.kind)}>
            {t('重试')}
          </Button>
        </div>
      ))}
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
    </section>
  )
}

function ActiveRow(props: { readonly item: ActiveItem; readonly bot: Bot | undefined; readonly now: number }) {
  const app = useApp()
  const { item } = props
  return (
    <li>
      <button type="button" className="pod-active-row" onClick={() => app.openTask(item.taskId)}>
        <Badge tone="info">{t(TICKET_STAGE_LABELS[item.stage])}</Badge>
        <span className="pod-active-main">
          <strong className="pod-ellipsis">{item.title}</strong>
          {item.progress === null ? null : <span className="pod-attention-summary">{item.progress}</span>}
        </span>
        {item.botId === null ? null : <BotName bot={props.bot} size={14} />}
        <span className="pod-muted-inline">{t('已用 {time}', { time: duration(props.now - item.since) })}</span>
      </button>
    </li>
  )
}

/** 一件事的来龙去脉：搜一条消息或一个任务，打开它的任务页。 */
function Trace() {
  const app = useApp()
  const [query, setQuery] = useState('')
  return (
    <section className="pod-overview-section">
      <div className="pod-section-title">{t('一件事的来龙去脉')}</div>
      <form
        className="pod-row"
        onSubmit={(event) => {
          event.preventDefault()
          app.openSearch(query.trim())
        }}
      >
        <input className="pod-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('搜一条消息或一个任务，打开它的任务页')} />
        <Button small type="submit" icon="search">
          {t('搜索')}
        </Button>
      </form>
    </section>
  )
}

/** 概览：现在要我处理什么（等了最久的在前）、系统好不好、进行中的、一件事的来龙去脉。 */
export function OverviewView() {
  const app = useApp()
  const narrow = useNarrow()
  const now = useNow(30_000)
  const { data, error } = useResource(app.cache, 'overview', () => api.overview())
  const { data: botList } = useResource(app.cache, 'bots', () => api.bots())
  const bots = useMemo(() => new Map((botList ?? []).map((bot): [string, Bot] => [bot.id, bot])), [botList])
  return (
    <main className="pod-convo pod-overview">
      <header className="pod-viewer-head">
        {narrow ? <IconButton icon="back" label={t('返回')} onClick={() => app.showList()} /> : null}
        <strong className="pod-grow">{t('概览')}</strong>
        {narrow ? null : <IconButton icon="close" label={t('关闭概览')} onClick={() => app.navigate({ overview: false })} />}
      </header>
      <div className="pod-overview-body">
        <section className="pod-overview-section">
          <div className="pod-section-title">{data === undefined ? t('现在要我处理什么') : t('现在要我处理什么（{count}）', { count: data.attention.length })}</div>
          {data === undefined ? (
            <p className="pod-muted">{error ?? t('正在读取…')}</p>
          ) : data.attention.length === 0 ? (
            <p className="pod-muted">{t('没有要你处理的事。')}</p>
          ) : (
            <ul className="pod-attention-list">
              {data.attention.map((item) => (
                <AttentionRow key={item.key} item={item} bot={item.botId === null ? undefined : bots.get(item.botId)} />
              ))}
            </ul>
          )}
        </section>
        <Health slots={data?.slots} />
        <section className="pod-overview-section">
          <div className="pod-section-title">{data === undefined ? t('进行中') : t('进行中（{count}）', { count: data.active.length })}</div>
          {data === undefined ? null : data.active.length === 0 ? (
            <p className="pod-muted">{t('现在没有在做的任务。')}</p>
          ) : (
            <ul className="pod-active-list">
              {data.active.map((item) => (
                <ActiveRow key={item.taskId} item={item} bot={item.botId === null ? undefined : bots.get(item.botId)} now={now} />
              ))}
            </ul>
          )}
        </section>
        <Trace />
      </div>
    </main>
  )
}
