import { REPORT_STATUS_LABELS, RUN_OUTCOME_LABELS, RUN_REASON_LABELS, t, type Bot } from 'pod-domain'
import type { TimelineItem, TimelineMessage } from '../../api/endpoints.ts'
import { Badge, clock } from '../../components/common.tsx'
import { stamp } from '../../components/duration.ts'
import { FoldText } from '../../components/FoldText.tsx'
import { Markdown } from '../../components/Markdown.tsx'
import { useApp } from '../../state/app.ts'
import { Actor, eventLine } from './events.tsx'

function keyOf(item: TimelineItem): string {
  switch (item.kind) {
    case 'message':
      return `m:${item.message.id}`
    case 'run':
      return `r:${item.run.id}`
    case 'report':
      return `p:${item.report.id}`
    case 'wait':
      return `w:${item.wait.id}`
    case 'route':
      return `t:${item.route.id}`
    case 'event':
      return `e:${item.event.id}`
  }
}

/** 话题里的一条消息：谁说的、说了什么；送进任务的标出读过没有，点一下回到聊天里的原消息。 */
function MessageLine(props: { readonly message: TimelineMessage; readonly bots: ReadonlyMap<string, Bot> }) {
  const app = useApp()
  const { message } = props
  return (
    <>
      <span className="pod-tl-who">
        <Actor actor={message.author} bots={props.bots} />
      </span>
      {message.read === null ? null : message.read ? <Badge tone="ok">{t('读过')}</Badge> : <Badge tone="warn">{t('还没读')}</Badge>}
      <button type="button" className="pod-link pod-tl-jump" onClick={() => app.focusMessage(message.roomId, message.seq, message.id)}>
        {t('在聊天里看')}
      </button>
      <p className="pod-tl-text">
        <FoldText text={message.body} />
      </p>
    </>
  )
}

function Line(props: { readonly item: TimelineItem; readonly bots: ReadonlyMap<string, Bot> }) {
  const { item, bots } = props
  switch (item.kind) {
    case 'message':
      return <MessageLine message={item.message} bots={bots} />
    case 'run': {
      const { run } = item
      const end =
        run.endedAt === null
          ? run.status === 'queued'
            ? t('排队中')
            : t('进行中')
          : t('{time} 结束（{outcome}）', { time: clock(run.endedAt), outcome: run.outcome === null ? '' : t(RUN_OUTCOME_LABELS[run.outcome]) })
      return (
        <>
          <strong>
            {run.reason === 'trigger' && typeof run.detail.trigger === 'string'
              ? t('开工：触发器「{trigger}」', { trigger: run.detail.trigger })
              : t('开工：{reason}', { reason: t(RUN_REASON_LABELS[run.reason]) })}
          </strong>
          <span className="pod-muted-inline">{end}</span>
          {run.error === null || run.error === '' ? null : <p className="pod-tl-text pod-form-error">{run.error}</p>}
        </>
      )
    }
    case 'report': {
      const { report } = item
      return (
        <>
          <Badge tone={report.status === 'ready' ? 'ok' : report.status === 'failed' ? 'danger' : report.status === 'progress' ? 'info' : 'warn'}>{t(REPORT_STATUS_LABELS[report.status])}</Badge>
          <span className="pod-tl-who">
            <Actor actor={report.author} bots={bots} />
          </span>
          <p className="pod-tl-text">
            <FoldText text={report.summary} />
          </p>
          {report.question === '' ? null : <p className="pod-tl-text">{t('问题：{question}', { question: report.question })}</p>}
          {report.report === '' ? null : (
            <details className="pod-tl-report">
              <summary>{t('看报告')}</summary>
              <Markdown text={report.report} />
            </details>
          )}
        </>
      )
    }
    case 'wait': {
      const { wait } = item
      return (
        <>
          <strong>{t('等你：{title}', { title: wait.title })}</strong>
          {wait.status === 'open' || wait.status === 'bypassed' ? <Badge tone="warn">{t('待答复')}</Badge> : null}
          {wait.answer === null || wait.answer === '' ? null : <p className="pod-tl-text">{t('你的答复：{answer}', { answer: wait.answer })}</p>}
        </>
      )
    }
    case 'route': {
      const { route } = item
      const text =
        route.route === 'acked'
          ? t('确认收到「{excerpt}」', { excerpt: item.excerpt })
          : route.route === 'handed_back'
            ? t('交还了「{excerpt}」：{note}', { excerpt: item.excerpt, note: route.note })
            : t('没读到「{excerpt}」，退回前台', { excerpt: item.excerpt })
      return (
        <>
          {route.decidedBy === 'code' ? null : (
            <span className="pod-tl-who">
              <Actor actor={route.decidedBy} bots={bots} />
            </span>
          )}
          <span>{text}</span>
        </>
      )
    }
    case 'event':
      return (
        <>
          <span className="pod-event-id">#{item.event.id}</span>
          <span className="pod-tl-who">
            <Actor actor={item.event.actor} bots={bots} />
          </span>
          <span>{eventLine(item.event, bots)}</span>
        </>
      )
  }
}

/** 任务页的时间线：话题里的消息、每次执行、每次汇报、等你、交还和确认、看门狗的结论和决策链里别的事，按时间排。 */
export function TaskTimeline(props: { readonly items: readonly TimelineItem[]; readonly bots: ReadonlyMap<string, Bot> }) {
  if (props.items.length === 0) return null
  return (
    <section>
      <div className="pod-section-title">{t('时间线')}</div>
      <ol className="pod-timeline">
        {props.items.map((item) => (
          <li key={keyOf(item)} className={`pod-tl pod-tl-${item.kind}`}>
            <time className="pod-tl-time">{stamp(item.at)}</time>
            <div className="pod-tl-body">
              <Line item={item} bots={props.bots} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
