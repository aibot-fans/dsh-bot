import { useState } from 'react'
import { EVOLUTION_LABELS, formatCost, type EvolutionKind, type Scorecard } from 'pod-domain'
import { api, type SkillView } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Badge, Button, Drawer, Empty, Field, RelativeTime } from '../../components/common.tsx'
import { Markdown } from '../../components/Markdown.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { EvolutionRow } from '../chat/WeeklyCard.tsx'

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

/** 评分卡：验收通过率、返工、你的评分、费用、耗时，以及找你、先绕过、被你改的次数。 */
export function ScorecardStrip(props: { readonly card: Scorecard }) {
  const { card } = props
  if (card.tasks === 0) return <p className="pod-hint">还没做过任务，没有评分卡。</p>
  const minutes = Math.round(card.avgDurationMs / 60_000)
  return (
    <div className="pod-scorecard">
      <div>
        <span className="pod-hint">一次通过</span>
        <strong>{percent(card.firstPassRate)}</strong>
      </div>
      <div>
        <span className="pod-hint">完成 / 失败</span>
        <strong>
          {card.done} / {card.failed}
        </strong>
      </div>
      <div>
        <span className="pod-hint">返工</span>
        <strong>{card.reworks}</strong>
      </div>
      <div>
        <span className="pod-hint">你的评分</span>
        <strong>{card.rating === null ? '—' : card.rating > 0 ? `好评 ${card.ratings}` : card.rating < 0 ? `差评居多（${card.ratings}）` : `${card.ratings} 次`}</strong>
      </div>
      <div>
        <span className="pod-hint">平均花费</span>
        <strong>{formatCost(card.avgCost)}</strong>
      </div>
      <div>
        <span className="pod-hint">平均耗时</span>
        <strong>{minutes < 1 ? '不到 1 分钟' : `${minutes} 分钟`}</strong>
      </div>
      <div>
        <span className="pod-hint">找你 / 绕过 / 被改</span>
        <strong>
          {card.asksPerTask} / {card.bypassPerTask} / {card.editsPerTask}
        </strong>
      </div>
    </div>
  )
}

/** 所有 bot 的评分卡。 */
export function ScorecardsPanel() {
  const app = useApp()
  const { data } = useResource(app.cache, 'scorecards', () => api.scorecards())
  if (data === undefined) return null
  return (
    <div className="pod-grid">
      {data.map((item) => (
        <article key={item.botId} className="pod-card">
          <div className="pod-row">
            <strong>{item.name}</strong>
            {item.temporary ? <Badge>临时</Badge> : null}
          </div>
          <ScorecardStrip card={item.card} />
        </article>
      ))}
    </div>
  )
}

function SkillEditor(props: { readonly skill?: SkillView; readonly botId?: string; readonly onDone: () => void }) {
  const app = useApp()
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  const { data: teams } = useResource(app.cache, 'teams', () => api.teams())
  const [title, setTitle] = useState(props.skill?.title ?? '')
  const [name, setName] = useState(props.skill?.name ?? '')
  const [description, setDescription] = useState(props.skill?.description ?? '')
  const [content, setContent] = useState(props.skill?.content ?? '## 步骤\n1. \n\n## 容易出错的地方\n- \n\n## 输出模板\n')
  const [scope, setScope] = useState(props.skill === undefined ? `bot:${props.botId ?? bots?.[0]?.id ?? ''}` : `${props.skill.scopeKind}:${props.skill.scopeId}`)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const save = (): void => {
    const [scopeKind, scopeId] = scope.split(':')
    api
      .saveSkill({ name, title, description, content, scopeKind, scopeId })
      .then(props.onDone)
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  return (
    <div className="pod-stack">
      <Field label="标题">
        <input className="pod-input" value={title} onChange={(event) => setTitle(event.target.value)} />
      </Field>
      <Field label="技能名" hint="英文小写加连字符，bot 用它加载技能">
        <input className="pod-input" value={name} placeholder="pricing-research" disabled={props.skill !== undefined} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="什么时候用">
        <input className="pod-input" value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <Field label="给谁用">
        <select className="pod-input" value={scope} disabled={props.skill !== undefined} onChange={(event) => setScope(event.target.value)}>
          {(bots ?? []).filter((bot) => bot.archivedAt === null).map((bot) => (
            <option key={bot.id} value={`bot:${bot.id}`}>
              {bot.name}
            </option>
          ))}
          {(teams ?? []).filter((team) => team.archivedAt === null).map((team) => (
            <option key={team.id} value={`team:${team.id}`}>
              团队：{team.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="内容" hint="步骤、容易出错的地方、输出模板（Markdown）；你写的技能 bot 不会改">
        <textarea className="pod-textarea" rows={14} value={content} onChange={(event) => setContent(event.target.value)} />
      </Field>
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
      <Button kind="primary" onClick={save}>
        保存
      </Button>
    </div>
  )
}

function SkillVersions(props: { readonly skill: SkillView; readonly onClose: () => void }) {
  const app = useApp()
  const { data } = useResource(app.cache, `skill-versions:${props.skill.id}`, () => api.skillVersions(props.skill.id))
  return (
    <Drawer title={`「${props.skill.title}」的版本`} onClose={props.onClose} wide>
      <ol className="pod-versions">
        {(data ?? []).map((version) => (
          <li key={version.version}>
            <div className="pod-row">
              <strong>第 {version.version} 版</strong>
              {version.version === props.skill.version ? <Badge tone="ok">当前</Badge> : null}
              <span className="pod-muted-inline">
                <RelativeTime time={version.createdAt} />
              </span>
              <span className="pod-muted-inline">{version.reason}</span>
            </div>
            <details>
              <summary>内容</summary>
              <Markdown text={version.content} />
            </details>
            {version.version === props.skill.version ? null : (
              <Button
                small
                kind="quiet"
                icon="restore"
                onClick={() => {
                  api
                    .rollbackSkill(props.skill.id, version.version)
                    .then(() => {
                      app.cache.invalidate('skills')
                      app.cache.invalidate(`skill-versions:${props.skill.id}`)
                    })
                    .catch((reason: unknown) => window.alert(errorText(reason)))
                }}
              >
                回到这一版
              </Button>
            )}
          </li>
        ))}
      </ol>
    </Drawer>
  )
}

const STATUS_LABELS = { active: '启用', pending: '等你批准', archived: '停用' } as const

/** 技能：bot 沉淀的流程和你写的技能，都留版本；带脚本的要你批准后才启用。 */
/** 技能：bot 自己沉淀的、复盘提出的和你写的；给了 botId 就只看这个 bot 的。 */
export function SkillsPanel(props: { readonly botId?: string }) {
  const app = useApp()
  const { data: all } = useResource(app.cache, 'skills', () => api.skills())
  const data = props.botId === undefined ? all : all?.filter((skill) => skill.scopeKind === 'bot' && skill.scopeId === props.botId)
  const [editing, setEditing] = useState<SkillView | 'new' | undefined>(undefined)
  const [versions, setVersions] = useState<SkillView | undefined>(undefined)
  const status = (skill: SkillView, next: 'active' | 'archived'): void => {
    api
      .setSkillStatus(skill.id, next)
      .then(() => app.cache.invalidate('skills'))
      .catch((reason: unknown) => window.alert(errorText(reason)))
  }
  return (
    <div className="pod-stack">
      <div>
        <Button icon="plus" onClick={() => setEditing('new')}>
          写一个技能
        </Button>
      </div>
      {data !== undefined && data.length === 0 ? <Empty title="还没有技能">任务做成功、流程能复用时，bot 会自己沉淀技能，复盘时也会提出。</Empty> : null}
      <div className="pod-grid">
        {(data ?? []).map((skill) => (
          <article key={skill.id} className={`pod-card${skill.status === 'archived' ? ' pod-card-muted' : ''}`}>
            <div className="pod-row">
              <strong>{skill.title}</strong>
              <Badge tone={skill.status === 'active' ? 'ok' : skill.status === 'pending' ? 'warn' : 'muted'}>{STATUS_LABELS[skill.status]}</Badge>
              {skill.hasScript ? <Badge tone="warn">带脚本</Badge> : null}
            </div>
            <div className="pod-hint">
              {skill.name} · {skill.scopeKind === 'team' ? '团队：' : ''}
              {skill.scopeName} · 第 {skill.version} 版 · {skill.source === 'owner' ? '你写的' : skill.source === 'retro' ? '复盘沉淀' : 'bot 沉淀'}
            </div>
            <p className="pod-persona">{skill.description}</p>
            <div className="pod-card-actions">
              <Button small onClick={() => setEditing(skill)}>
                编辑
              </Button>
              <Button small kind="quiet" icon="history" onClick={() => setVersions(skill)}>
                版本
              </Button>
              {skill.status === 'active' ? (
                <Button small kind="quiet" onClick={() => status(skill, 'archived')}>
                  停用
                </Button>
              ) : (
                <Button small kind="quiet" onClick={() => status(skill, 'active')}>
                  {skill.status === 'pending' ? '批准并启用' : '启用'}
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {editing === undefined ? null : (
        <Drawer title={editing === 'new' ? '写一个技能' : `编辑「${editing.title}」`} onClose={() => setEditing(undefined)} wide>
          <SkillEditor
            skill={editing === 'new' ? undefined : editing}
            botId={props.botId}
            onDone={() => {
              setEditing(undefined)
              app.cache.invalidate('skills')
            }}
          />
        </Drawer>
      )}
      {versions === undefined ? null : <SkillVersions skill={versions} onClose={() => setVersions(undefined)} />}
    </div>
  )
}

/** 进化日志：所有自动改动，按种类筛选，可以一键回滚。 */
export function EvolutionPanel(props: { readonly botId?: string }) {
  const app = useApp()
  const { data } = useResource(app.cache, 'evolution', () => api.evolution())
  const [kind, setKind] = useState<EvolutionKind | ''>('')
  const entries = (data ?? []).filter((entry) => (kind === '' || entry.kind === kind) && (props.botId === undefined || entry.botId === props.botId))
  return (
    <div className="pod-stack">
      <p className="pod-muted">自我优化默认自治：改动直接生效、记在这里；改后的任务明显变差会自动退回。只有带脚本的技能要你批准。</p>
      <div className="pod-tabs">
        <button type="button" className={`pod-chip${kind === '' ? ' pod-chip-active' : ''}`} onClick={() => setKind('')}>
          全部
        </button>
        {(Object.keys(EVOLUTION_LABELS) as EvolutionKind[]).map((item) => (
          <button key={item} type="button" className={`pod-chip${kind === item ? ' pod-chip-active' : ''}`} onClick={() => setKind(item)}>
            {EVOLUTION_LABELS[item]}
          </button>
        ))}
      </div>
      {data !== undefined && entries.length === 0 ? <Empty title="还没有改动" /> : null}
      <ul className="pod-evolution-list">
        {entries.map((entry) => (
          <EvolutionRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </div>
  )
}
