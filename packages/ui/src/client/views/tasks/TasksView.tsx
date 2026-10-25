import { useEffect, useState } from 'react'
import {
  SESSION_KIND_LABELS,
  TASK_STATUS_LABELS,
  acceptanceProgress,
  formatCost,
  type Bot,
  type TaskSnapshot,
} from 'pod-domain'
import { api, type TaskDetail as TaskDetailData, type TaskEvent } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Avatar, Badge, Button, Drawer, Empty, RelativeTime, clock } from '../../components/common.tsx'
import { BotName } from '../../components/GroupMark.tsx'
import { TaskCard, segmentTone } from '../../components/TaskCard.tsx'
import { WaitView } from '../../components/WaitCard.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

export function TaskTile(props: { readonly snapshot: TaskSnapshot; readonly bots: ReadonlyMap<string, Bot>; readonly onOpen: () => void }) {
  const { task, children } = props.snapshot
  const progress = acceptanceProgress(task.acceptance)
  const owner = task.ownerBotId === null ? undefined : props.bots.get(task.ownerBotId)
  const done = children.filter((child) => child.status === 'done').length
  return (
    <button type="button" className={`pod-tile pod-tile-${segmentTone(task)}`} onClick={props.onOpen}>
      <div className="pod-row">
        {owner === undefined ? null : <Avatar bot={owner} size={20} />}
        <strong className="pod-ellipsis">{task.title}</strong>
      </div>
      <div className="pod-tile-meta">
        <span>{TASK_STATUS_LABELS[task.status]}</span>
        {children.length > 0 ? <span>子任务 {done}/{children.length}</span> : progress.total > 0 ? <span>验收项 {progress.done}/{progress.total}</span> : null}
        {props.snapshot.cost > 0 ? <span>{formatCost(props.snapshot.cost)}</span> : null}
        {props.snapshot.waits > 0 ? <Badge tone="warn">等你 {props.snapshot.waits}</Badge> : null}
      </div>
      <div className="pod-tile-time">
        <RelativeTime time={task.updatedAt} />
      </div>
    </button>
  )
}

const EVENT_LABELS: Readonly<Record<string, string>> = {
  planned: '提交团队计划',
  approved: '确认计划',
  started: '开工',
  submitted: '提交子任务',
  reviewed: '验收',
  reassigned: '改派给',
  revised: '出新版计划',
  delivered: '交付',
  'change-proposed': '转达需求变更',
  delegated: '派给',
  checked: '勾选验收项',
  completed: '提交结果',
  relayed: '转达',
  'owner-talk': '你直接对任务说',
  stalled: '停滞',
  lesson: '记下经验',
  'control.pause': '暂停',
  'control.resume': '继续',
  'control.stop': '停止',
  'control.cancel': '取消',
}

/** 决策链一行里做事的人：你、Pod，或者带图标的 bot。 */
function Actor(props: { readonly actor: string; readonly bots: ReadonlyMap<string, Bot> }) {
  if (props.actor === 'owner') return <>你</>
  if (props.actor === 'pod') return <>Pod</>
  return <BotName bot={props.bots.get(props.actor)} fallback={props.actor} size={14} />
}

/** 决策链一行里做事的人后面的那部分。 */
function eventLine(event: TaskEvent, bots: ReadonlyMap<string, Bot>): string {
  const label = EVENT_LABELS[event.kind] ?? event.kind
  const to = typeof event.data.to === 'string' ? ` ${bots.get(event.data.to)?.name ?? event.data.to}` : ''
  const reason = typeof event.data.reason === 'string' && event.data.reason !== '' ? `：${event.data.reason}` : ''
  const items = Array.isArray(event.data.items) ? `：${(event.data.items as unknown[]).join('、')}` : ''
  const quote = typeof event.data.quote === 'string' ? `：「${event.data.quote}」` : ''
  const verdict = event.kind === 'reviewed' ? (event.data.pass === true ? '：通过' : `：打回（${String(event.data.feedback ?? '')}）`) : ''
  const version = event.kind === 'revised' ? `：第 ${String(event.data.version ?? '')} 版，${String(event.data.reason ?? '')}` : ''
  return `${label}${to}${reason}${items}${quote}${verdict}${version}`
}

/** 子任务树：负责人、状态、验收项、进度说明和结果，每个都能查看过程。 */
function Subtasks(props: { readonly detail: TaskDetailData; readonly bots: ReadonlyMap<string, Bot> }) {
  const app = useApp()
  const { children } = props.detail.snapshot
  const rootId = props.detail.snapshot.task.rootId
  const { data: plan } = useResource(app.cache, `plan:${rootId}`, () => api.taskPlan(rootId))
  if (children.length === 0) return null
  const keyOf = new Map(Object.entries(plan?.keys ?? {}).map(([key, id]) => [id, key]))
  return (
    <section>
      <div className="pod-section-title">子任务</div>
      <ol className="pod-subtasks">
        {children.map((child) => {
          const progress = acceptanceProgress(child.acceptance)
          const session = props.detail.sessions.find((item) => item.taskId === child.id && item.status === 'active')
          return (
            <li key={child.id} className={`pod-subtask pod-tile-${segmentTone(child)}`}>
              <div className="pod-row pod-wrap">
                <span className="pod-muted-inline">{keyOf.get(child.id) ?? ''}</span>
                <strong>{child.title}</strong>
                <Badge tone={child.status === 'done' ? 'ok' : child.status === 'waiting' ? 'warn' : child.status === 'failed' ? 'danger' : 'muted'}>{TASK_STATUS_LABELS[child.status]}</Badge>
                <span className="pod-muted-inline">
                  {child.ownerBotId === null ? '未指定' : <BotName bot={props.bots.get(child.ownerBotId)} size={14} />} · 验收项 {progress.done}/{progress.total}
                  {child.attempts > 0 ? ` · 打回 ${child.attempts} 次` : ''}
                </span>
                {session === undefined ? null : (
                  <Button small kind="quiet" icon="open" onClick={() => app.host.openSession(session.id)}>
                    查看过程
                  </Button>
                )}
              </div>
              {child.note === '' ? null : <div className="pod-muted">{child.note}</div>}
              {child.result === null ? null : <div className="pod-muted">结果：{child.result.summary.split('\n')[0]}</div>}
            </li>
          )
        })}
      </ol>
      {plan === undefined ? null : (
        <div className="pod-plan-meta">
          <div>
            计划第 {plan.plan.version} 版{plan.plan.revision === null ? '' : `：${plan.plan.revision.reason}`}
          </div>
          {plan.plan.assumptions.length === 0 ? null : <div>前提：{plan.plan.assumptions.map((item) => item.text).join('；')}</div>}
          {plan.plan.conventions.length === 0 ? null : <div>任务约定：{plan.plan.conventions.join('；')}</div>}
        </div>
      )}
    </section>
  )
}

/** 任务详情：实时进度、子任务、“直接对任务说”、会话列表和决策链。 */
export function TaskDetail(props: { readonly taskId: string; readonly bots: ReadonlyMap<string, Bot>; readonly onClose: () => void }) {
  const app = useApp()
  const { data: detail, error } = useResource(app.cache, `detail:${props.taskId}`, () => api.taskDetail(props.taskId))
  const [talk, setTalk] = useState('')
  const [talkError, setTalkError] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (detail !== undefined) app.rememberTree(detail.snapshot.task.rootId, [detail.snapshot.task.id, ...detail.snapshot.children.map((child) => child.id)])
  }, [app, detail])
  const send = (): void => {
    if (talk.trim() === '') return
    api
      .talkToTask(props.taskId, talk.trim())
      .then(() => setTalk(''))
      .catch((reason: unknown) => setTalkError(errorText(reason)))
  }
  return (
    <Drawer title="任务详情" onClose={props.onClose} wide>
      {detail === undefined ? (
        <p className="pod-muted">{error ?? '正在读取…'}</p>
      ) : (
        <div className="pod-stack">
          <TaskCard taskId={props.taskId} />
          <Subtasks detail={detail} bots={props.bots} />
          {detail.snapshot.task.brief === '' ? null : (
            <section>
              <div className="pod-section-title">任务说明</div>
              <p className="pod-pre">{detail.snapshot.task.brief}</p>
            </section>
          )}
          {detail.waits.length === 0 ? null : (
            <section>
              <div className="pod-section-title">等你处理</div>
              {detail.waits.map((wait) => (
                <WaitView key={wait.id} wait={wait} />
              ))}
            </section>
          )}
          <section>
            <div className="pod-section-title">直接对任务说</div>
            <p className="pod-hint">这里的话直接进任务会话（正在运行时下一步送达），适合你在旁边一步步带着它做。</p>
            <div className="pod-row">
              <input className="pod-input" value={talk} onChange={(event) => setTalk(event.target.value)} onKeyDown={(event) => (event.key === 'Enter' ? send() : undefined)} placeholder="例如：先别查官网了，用第三方数据" />
              <Button kind="primary" small onClick={send}>
                发送
              </Button>
            </div>
            {talkError === undefined ? null : <p className="pod-form-error">{talkError}</p>}
          </section>
          <section>
            <div className="pod-section-title">会话</div>
            {detail.sessions.map((session) => (
              <div key={session.id} className="pod-row pod-session-row">
                <Avatar bot={props.bots.get(session.botId)} size={20} />
                <span>
                  {props.bots.get(session.botId)?.name ?? session.botId} · {SESSION_KIND_LABELS[session.kind]}
                  {session.status === 'retired' ? '（已换段）' : ''}
                </span>
                <span className="pod-muted-inline">{session.steps} 步</span>
                <Button small kind="quiet" icon="open" onClick={() => app.host.openSession(session.id)}>
                  查看过程
                </Button>
              </div>
            ))}
          </section>
          <section>
            <div className="pod-section-title">决策链</div>
            <ol className="pod-events">
              {detail.events.map((event) => (
                <li key={event.id}>
                  <time>{clock(event.createdAt)}</time> <Actor actor={event.actor} bots={props.bots} /> {eventLine(event, props.bots)}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Drawer>
  )
}
