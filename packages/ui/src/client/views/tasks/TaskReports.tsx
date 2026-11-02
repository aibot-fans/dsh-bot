import { REPORT_STATUS_LABELS, t, type Bot, type TaskReport } from 'pod-domain'
import { Badge, clock } from '../../components/common.tsx'
import { BotName } from '../../components/GroupMark.tsx'
import { Markdown } from '../../components/Markdown.tsx'

function ReportHead(props: { readonly report: TaskReport; readonly bots: ReadonlyMap<string, Bot> }) {
  const { report } = props
  return (
    <div className="pod-row pod-wrap">
      <Badge tone={report.status === 'ready' ? 'ok' : report.status === 'failed' ? 'danger' : 'warn'}>{t(REPORT_STATUS_LABELS[report.status])}</Badge>
      {report.author === 'pod' ? <span>dsh-bot</span> : report.author === 'watchdog' ? <span>{t('看门狗')}</span> : <BotName bot={props.bots.get(report.author)} fallback={report.author} size={14} />}
      <time className="pod-muted-inline">{clock(report.createdAt)}</time>
    </div>
  )
}

/** 任务页里的报告：最新一份完整报告在上面，更早的收起来；聊天里只放摘要。 */
export function TaskReports(props: { readonly reports: readonly TaskReport[]; readonly bots: ReadonlyMap<string, Bot> }) {
  const full = props.reports.filter((report) => report.report !== '')
  const latest = full[0]
  if (latest === undefined) return null
  const older = full.slice(1)
  return (
    <section>
      <div className="pod-section-title">{t('报告')}</div>
      <div className="pod-report">
        <ReportHead report={latest} bots={props.bots} />
        <Markdown text={latest.report} />
      </div>
      {older.length === 0 ? null : (
        <details className="pod-report-older">
          <summary>{t('更早的报告（{count}）', { count: older.length })}</summary>
          {older.map((report) => (
            <div key={report.id} className="pod-report">
              <ReportHead report={report} bots={props.bots} />
              <Markdown text={report.report} />
            </div>
          ))}
        </details>
      )}
    </section>
  )
}
