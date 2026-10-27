import { EVOLUTION_LABELS, t, type EvolutionEntry, type RoomMessage } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Badge, Button, RelativeTime } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

/** 进化日志里的一条：种类、说明、理由、状态，还开着的可以一键回滚。 */
export function EvolutionRow(props: { readonly entry: EvolutionEntry; readonly botName?: string }) {
  const app = useApp()
  const { entry } = props
  const revertible = entry.status !== 'reverted' && entry.kind !== 'revert'
  return (
    <li className="pod-evolution">
      <div className="pod-row">
        <Badge tone={entry.kind === 'revert' ? 'warn' : entry.kind === 'skill' ? 'info' : 'muted'}>{t(EVOLUTION_LABELS[entry.kind])}</Badge>
        <span className="pod-ellipsis">{entry.summary}</span>
        {entry.status === 'reverted' ? <Badge tone="muted">{t('已回滚')}</Badge> : null}
        {entry.status === 'kept' ? <Badge tone="ok">{t('效果稳定')}</Badge> : null}
        <span className="pod-muted-inline">
          <RelativeTime time={entry.createdAt} />
        </span>
        {revertible ? (
          <Button
            small
            kind="quiet"
            icon="restore"
            onClick={() => {
              if (!window.confirm(t('回滚这条改动？\n{summary}', { summary: entry.summary }))) return
              api
                .revertEvolution(entry.id)
                .then(() => app.cache.invalidate('evolution'))
                .catch((reason: unknown) => window.alert(errorText(reason)))
            }}
          >
            {t('回滚')}
          </Button>
        ) : null}
      </div>
      {entry.reason === '' ? null : <div className="pod-hint">{t('理由：{reason}', { reason: entry.reason })}</div>}
    </li>
  )
}

/** “本周变化”卡：这一周改了哪些经验、技能、人设、档位和你的档案，以及自治效果。只看不用处理。 */
export function WeeklyCard(props: { readonly message: RoomMessage }) {
  const app = useApp()
  const since = typeof props.message.data.since === 'number' ? props.message.data.since : props.message.createdAt - 7 * 86_400_000
  const until = typeof props.message.data.until === 'number' ? props.message.data.until : props.message.createdAt
  const { data } = useResource(app.cache, `weekly:${since}`, () => api.weekly(since))
  const entries = (data?.entries ?? []).filter((entry) => entry.createdAt <= until)
  return (
    <div className="pod-card pod-weekly">
      <div className="pod-row">
        <Badge tone="info">{t('本周变化')}</Badge>
        <strong>{t('只看不用处理，哪条不满意一键回滚')}</strong>
      </div>
      <p className="pod-pre">{props.message.body}</p>
      {entries.length === 0 ? null : (
        <ul className="pod-evolution-list">
          {entries.slice(0, 30).map((entry) => (
            <EvolutionRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
      {data === undefined || data.owner.length === 0 ? null : (
        <details>
          <summary>{t('你的档案这一周的变化（{length} 条）', { length: data.owner.length })}</summary>
          <ul>
            {data.owner.slice(0, 20).map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          <Button small kind="quiet" onClick={() => app.openDrawer({ kind: 'memory', scope: 'owner', scopeId: '', label: t('你的档案') })}>
            {t('去记忆页修改')}
          </Button>
        </details>
      )}
    </div>
  )
}
