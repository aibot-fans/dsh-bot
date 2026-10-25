import { useMemo, useState, type ReactNode } from 'react'
import { api, type UsageRange, type UsageReport, type UsageShare } from '../../api/endpoints.ts'
import { Avatar, money, Segmented, tokens } from '../../components/common.tsx'
import { GroupMark } from '../../components/GroupMark.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { AibotUsage } from '../aibot/AibotUsage.tsx'

const RANGES: readonly (readonly [UsageRange, string])[] = [
  ['today', '今天'],
  ['7d', '最近 7 天'],
  ['30d', '最近 30 天'],
]

/** 纵轴刻度取整：0、0.2、0.4……，最高的一格盖住最大值。 */
function niceMax(value: number): number {
  if (value <= 0) return 0.01
  const power = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].map((item) => item * power).find((item) => item * 3 >= value) ?? power * 10
  return step * 3
}

/** 有价格时按花费画；模型没有价格（花费全是 0）时按 token 画。 */
type Measure = 'cost' | 'tokens'

function measureOf(report: UsageReport): Measure {
  return report.cost > 0 || report.tokens === 0 ? 'cost' : 'tokens'
}

function show(measure: Measure, value: number): string {
  return measure === 'cost' ? money(value) : tokens(value)
}

function Chart(props: { readonly report: UsageReport }) {
  const { report } = props
  const measure = measureOf(report)
  const valueOf = (bucket: { readonly cost: number; readonly tokens: number }): number => (measure === 'cost' ? bucket.cost : bucket.tokens)
  const [table, setTable] = useState(false)
  const now = Date.now()
  // 今天只画到现在为止的小时；按天的全画。
  const bars = report.range === 'today' ? report.series.filter((bucket) => bucket.start <= now) : report.series
  const top = niceMax(Math.max(...bars.map(valueOf), 0))
  const peak = bars.reduce((best, bucket, index) => (valueOf(bucket) > valueOf(bars[best] ?? { cost: -1, tokens: -1 }) ? index : best), 0)
  const ticks = [0, 1, 2, 3].map((step) => (top / 3) * step)
  const slots = report.range === 'today' ? report.series.length : bars.length
  const every = report.range === '30d' ? 7 : report.range === 'today' ? 6 : 1
  const label = (bucket: { readonly label: string }, index: number): string => (report.range === 'today' ? `${bucket.label}:00` : index === bars.length - 1 ? '今天' : bucket.label)
  return (
    <section className="pod-card pod-usage-chart">
      <div className="pod-row">
        <strong>
          {report.range === 'today' ? '每小时' : '每天'}
          {measure === 'cost' ? '花费' : ' token'}
        </strong>
        {measure === 'tokens' ? <span className="pod-muted-inline">现在用的模型没有价格，按 token 看</span> : null}
        <span className="pod-grow" />
        <button type="button" className="pod-button pod-button-small" aria-pressed={table} onClick={() => setTable((value) => !value)}>
          {table ? '看图' : '看表格'}
        </button>
      </div>
      {table ? (
        <table className="pod-usage-table">
          <thead>
            <tr>
              <th scope="col">{report.range === 'today' ? '时段' : '日期'}</th>
              <th scope="col">花费</th>
              <th scope="col">Token</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((bucket, index) => (
              <tr key={bucket.start}>
                <td>{label(bucket, index)}</td>
                <td>{money(bucket.cost)}</td>
                <td>{tokens(bucket.tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="pod-chart">
          <div className="pod-chart-plot">
            {ticks.map((tick) => (
              <div key={tick} className="pod-chart-grid" style={{ bottom: `${(tick / top) * 100}%` }}>
                <span>{tick === 0 ? (measure === 'cost' ? '$0' : '0') : show(measure, tick)}</span>
              </div>
            ))}
            <div className="pod-chart-cols" style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}>
              {bars.map((bucket, index) => {
                const height = (valueOf(bucket) / top) * 100
                const capped = index === peak || index === bars.length - 1
                return (
                  <div key={bucket.start} className="pod-chart-col" tabIndex={0} role="img" aria-label={`${label(bucket, index)} ${show(measure, valueOf(bucket))}`}>
                    <span className="pod-chart-bar" style={{ height: `${height}%` }} />
                    {capped && valueOf(bucket) > 0 ? (
                      <span className="pod-chart-cap" style={{ bottom: `calc(${height}% + 4px)` }}>
                        {show(measure, valueOf(bucket))}
                      </span>
                    ) : null}
                    <span className={`pod-chart-tip${index < 2 ? ' pod-chart-tip-left' : index > bars.length - 3 ? ' pod-chart-tip-right' : ''}`} style={{ bottom: `calc(${height}% + ${capped ? 24 : 8}px)` }}>
                      <strong>{show(measure, valueOf(bucket))}</strong>
                      <span>
                        {label(bucket, index)} · {measure === 'cost' ? `${tokens(bucket.tokens)} token` : money(bucket.cost)}
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="pod-chart-x" style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }} aria-hidden>
            {bars.map((bucket, index) => (
              <span key={bucket.start}>{index % every === 0 || index === bars.length - 1 ? label(bucket, index) : ''}</span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function Breakdown(props: { readonly report: UsageReport }) {
  const app = useApp()
  const [by, setBy] = useState<'bot' | 'room'>('bot')
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const botById = useMemo(() => new Map((bots ?? []).map((bot) => [bot.id, bot])), [bots])
  const names = useMemo(() => new Map([...(bots ?? []).map((bot) => [bot.id, bot.name] as const), ...(rooms ?? []).map((room) => [room.id, room.kind === 'direct' ? `和${room.title}的单聊` : room.title] as const)]), [bots, rooms])
  /** 每一行前面的图标：成员用它的小图标；单聊用对方的小图标，群聊用成员拼成的群图标。 */
  const iconOf = (id: string | null): ReactNode => {
    if (id === null) return <span className="pod-usage-icon-blank" aria-hidden />
    if (by === 'bot') return <Avatar bot={botById.get(id)} size={20} />
    const room = (rooms ?? []).find((item) => item.id === id)
    if (room === undefined) return <span className="pod-usage-icon-blank" aria-hidden />
    if (room.kind === 'direct') return <Avatar bot={room.botId === null ? undefined : botById.get(room.botId)} size={20} />
    return <GroupMark members={room.memberIds.flatMap((member) => botById.get(member) ?? [])} size={20} />
  }
  const measure = measureOf(props.report)
  const valueOf = (item: UsageShare): number => (measure === 'cost' ? item.cost : item.tokens)
  const list: readonly UsageShare[] = (by === 'bot' ? props.report.byBot : props.report.byRoom).slice(0, 10)
  const max = Math.max(...list.map(valueOf), 0.0001)
  const total = (measure === 'cost' ? props.report.cost : props.report.tokens) || 1
  return (
    <section className="pod-card">
      <div className="pod-row">
        <strong>花在哪儿</strong>
        <span className="pod-grow" />
        <Segmented
          value={by}
          options={[
            ['bot', '按成员'],
            ['room', '按对话'],
          ]}
          onChange={setBy}
          label="分组方式"
        />
      </div>
      {list.length === 0 ? <p className="pod-muted">这段时间还没有用量。</p> : null}
      {list.map((item) => {
        const name = item.id === null ? (by === 'bot' ? '后台（记忆、复盘）' : '不在对话里') : (names.get(item.id) ?? (by === 'bot' ? '已删除的 bot' : '已删除的对话'))
        const share = Math.round((valueOf(item) / total) * 100)
        return (
          <div key={item.id ?? 'none'} className="pod-usage-line" tabIndex={0} aria-label={`${name}，${show(measure, valueOf(item))}，占 ${share}%`}>
            <span className="pod-usage-name">
              {iconOf(item.id)}
              <span className="pod-ellipsis">{name}</span>
            </span>
            <span className="pod-usage-track">
              <span className="pod-usage-fill" style={{ width: `${Math.max(2, (valueOf(item) / max) * 80)}%` }} />
              <span className="pod-usage-amount">{show(measure, valueOf(item))}</span>
            </span>
            <span className="pod-chart-tip pod-usage-tip">
              <strong>{show(measure, valueOf(item))}</strong>
              <span>
                占 {share}% · {measure === 'cost' ? `${tokens(item.tokens)} token` : money(item.cost)}
              </span>
            </span>
          </div>
        )
      })}
    </section>
  )
}

/** 设置里的用量：所有 bot、群聊和后台加在一起；选时间范围，看总数、走势和花在哪儿；最下面是 aibot 今天还剩几次。 */
export function UsagePage() {
  const app = useApp()
  const [range, setRange] = useState<UsageRange>('7d')
  const { data: report, error } = useResource(app.cache, `usage:${range}`, () => api.usage(range))
  return (
    <div className="pod-stack">
      <div className="pod-row pod-wrap">
        <Segmented value={range} options={RANGES} onChange={setRange} label="时间范围" />
        <span className="pod-muted-inline">所有 bot、群聊和后台加在一起</span>
      </div>
      {error === undefined ? null : <p className="pod-form-error">{error}</p>}
      {report === undefined ? (
        <p className="pod-muted">正在统计…</p>
      ) : (
        <>
          <div className="pod-tiles">
            <div className="pod-tile-stat">
              <span>花费</span>
              <strong>{money(report.cost)}</strong>
            </div>
            <div className="pod-tile-stat">
              <span>Token</span>
              <strong>{tokens(report.tokens)}</strong>
            </div>
            <div className="pod-tile-stat">
              <span>缓存命中</span>
              <strong>{Math.round(report.cacheHit * 100)}%</strong>
            </div>
            <div className="pod-tile-stat">
              <span>闲时运行省下</span>
              <strong>{money(report.saved)}</strong>
            </div>
          </div>
          <Chart report={report} />
          <Breakdown report={report} />
        </>
      )}
      <AibotUsage />
    </div>
  )
}
