import {
  END_REASON_LABELS,
  STAGE_LABELS,
  TASK_STATUS_LABELS,
  TICKET_STAGE_LABELS,
  acceptanceProgress,
  formatCost,
  stageGroup,
  stagesFor,
  t,
  tc,
  type Bot,
  type Task,
  type TaskActivity,
  type TaskSnapshot,
  type TicketStage,
} from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { errorText } from '../api/http.ts'
import { useApp } from '../state/app.ts'
import { useResource } from '../state/resource.ts'
import { Badge, Button, useNow } from './common.tsx'
import { BotName } from './GroupMark.tsx'
import { ProgressBlock } from './Progress.tsx'
import { GroupEntry, SubtaskLine } from './TaskEntry.tsx'
import { ActionButtons, Delivery, ReportLine, Undelivered, actionsFor, elapsed, isTeamTask, useSnapshot, type ControlAction } from './taskParts.tsx'
import { TaskQuestion } from './TaskQuestion.tsx'
import { TriggerLine } from './TriggerLine.tsx'

function ago(time: number | null, now: number): string {
  if (time === null) return ''
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  return seconds < 60 ? t('{seconds} 秒前', { seconds }) : t('{round} 分钟前', { round: Math.round(seconds / 60) })
}

export function segmentTone(task: Task): string {
  switch (task.status) {
    case 'done':
      return 'done'
    case 'running':
    case 'review':
      return 'running'
    case 'waiting':
      return 'waiting'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'queued'
  }
}

/** 分段进度条：一个子任务一段（单个 bot 的任务一条验收项一段），按状态着色。 */
export function SegmentBar(props: { readonly snapshot: TaskSnapshot }) {
  const { task, children } = props.snapshot
  if (children.length > 0) {
    return (
      <div className="pod-segments" role="list">
        {children.map((child) => (
          <span key={child.id} role="listitem" className={`pod-segment pod-segment-${segmentTone(child)}`} title={`${child.title} · ${t(TASK_STATUS_LABELS[child.status])}`}>
            {child.title}
          </span>
        ))}
      </div>
    )
  }
  return (
    <div className="pod-segments pod-segments-thin" role="list">
      {task.acceptance.map((item, index) => (
        <span key={index} role="listitem" className={`pod-segment ${item.done ? 'pod-segment-done' : task.status === 'running' ? 'pod-segment-running' : 'pod-segment-queued'}`} title={item.text} />
      ))}
    </div>
  )
}

function stageTone(stage: TicketStage): 'ok' | 'warn' | 'danger' | 'info' {
  if (stage === 'failed' || stage === 'undelivered') return 'danger'
  if (stageGroup(stage) === 'attention') return 'warn'
  return stage === 'ended' ? 'ok' : 'info'
}

function Stages(props: { readonly task: Task; readonly done: number; readonly total: number }) {
  const stages = stagesFor(props.task.level)
  const current = props.task.stage ?? 'execute'
  const currentIndex = stages.indexOf(current === 'done' ? 'deliver' : current)
  return (
    <div className="pod-stages">
      {stages.map((stage, index) => (
        <span key={stage} className={`pod-stage${index < currentIndex || props.task.status === 'done' ? ' pod-stage-done' : index === currentIndex ? ' pod-stage-current' : ''}`}>
          {t(STAGE_LABELS[stage])}
          {stage === 'execute' && props.total > 0 && index === currentIndex ? ` ${props.done}/${props.total}` : ''}
        </span>
      ))}
    </div>
  )
}

function ActivityLine(props: { readonly activity: TaskActivity | null | undefined; readonly now: number; readonly prefix?: string }) {
  const { activity } = props
  if (activity === null || activity === undefined) return null
  const current = activity.current ?? activity.actions.at(-1)
  return (
    <div className="pod-activity">
      {props.prefix === undefined ? null : <span className="pod-activity-who">{props.prefix}</span>}
      <span>{t('第 {steps} 步{value}', { steps: activity.steps, value: current === undefined ? '' : t('：{current}', { current }) })}</span>
      <span className="pod-muted-inline">{ago(activity.lastEventAt, props.now)}</span>
      {activity.stalled ? <Badge tone="warn">{t('可能在绕圈')}</Badge> : null}
    </div>
  )
}

/** 任务在用的浏览器标签页：卡片上直接打开对应的画面。 */
function TaskTabs(props: { readonly snapshot: TaskSnapshot }) {
  const app = useApp()
  const { data } = useResource(app.cache, 'browser', () => api.browser())
  const ids = new Set([props.snapshot.task.id, ...props.snapshot.children.map((child) => child.id)])
  const tabs = (data?.tabs ?? []).filter((tab) => tab.taskId !== null && ids.has(tab.taskId))
  if (tabs.length === 0) return null
  return (
    <>
      {tabs.slice(0, 3).map((tab) => (
        <Button key={tab.id} small kind="quiet" icon="browser" title={tab.url} onClick={() => app.openBrowserTab(tab.id)}>
          {t('{value}：{value2}', { value: tab.controller === 'owner' ? t('你在操作') : t('浏览器'), value2: (tab.title || tab.url).slice(0, 16) })}
        </Button>
      ))}
    </>
  )
}

/**
 * 单聊里开的任务：在做时只是一行“在做”和最近一句进展，过程在详情里；做完原地变成结果（标明是谁做的）；
 * 要你处理（验收、答复、重试）时展开成完整的卡。
 */
function InlineTask(props: { readonly snapshot: TaskSnapshot; readonly now: number; readonly control: (action: ControlAction) => void; readonly owner: Bot | undefined }) {
  const app = useApp()
  const { snapshot, now } = props
  const { task } = snapshot
  const done = task.status === 'done'
  const details = (
    <Button small kind="quiet" onClick={() => app.openTask(task.rootId)}>
      {done ? t('看报告') : t('详情')}
    </Button>
  )
  if (done) {
    return (
      <div className="pod-task-inline-done">
        <Delivery snapshot={snapshot} />
        <div className="pod-task-inline-meta">
          {snapshot.ownerName === null ? null : <BotName bot={props.owner} fallback={snapshot.ownerName} size={14} />}
          <span>{t('「{title}」 · 用时 {elapsed}', { title: task.title, elapsed: elapsed(task, now) })}</span>
          {details}
        </div>
        <Undelivered snapshot={snapshot} />
      </div>
    )
  }
  return (
    <div className="pod-task-inline">
      <span className="pod-task-inline-title">{snapshot.stage === 'scheduled' ? t('等到点：{title}', { title: task.title }) : t('在做：{title}', { title: task.title })}</span>
      {snapshot.stage === 'scheduled' ? <TriggerLine snapshot={snapshot} /> : <span className="pod-muted-inline">{t('已用')} {elapsed(task, now)}</span>}
      {snapshot.lastReport !== null && snapshot.lastReport.status === 'progress' && (snapshot.run === null || snapshot.lastReport.createdAt >= snapshot.run.queuedAt) ? (
        <span className="pod-task-inline-progress">{snapshot.lastReport.summary}</span>
      ) : null}
      <span className="pod-task-inline-actions">
        <Button small kind="quiet" icon="stop" onClick={() => props.control('stop')}>
          {t('停止')}
        </Button>
        {details}
      </span>
    </div>
  )
}

/**
 * 原地刷新的任务卡：阶段、分段进度条、验收项、正在做什么、等你的事；
 * 任务完成后变成交付卡：要点、文件、用时、花费、前提和待确认。
 * 放在聊天里时（给了 roomId）：开了群的任务在群外只是一个进群的入口，子任务在任务群里只占一行。
 */
export function TaskCard(props: { readonly taskId: string; readonly compact?: boolean; readonly inline?: boolean; readonly roomId?: string }) {
  const app = useApp()
  const now = useNow(5000)
  const { snapshot, error } = useSnapshot(props.taskId)
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  if (snapshot === undefined) return <div className="pod-task-card pod-task-card-loading">{error === undefined ? t('正在读取任务…') : error}</div>
  const { task } = snapshot
  const progress = acceptanceProgress(task.acceptance)
  const finished = task.status === 'done'
  const team = isTeamTask(task)
  const control = (action: ControlAction): void => {
    api.controlTask(task.id, action).catch((reason: unknown) => window.alert(errorText(reason)))
  }
  const owner = bots?.find((bot) => bot.id === task.ownerBotId)
  // 旧版运行时的快照没有这一项：当作没开群。
  const group = snapshot.groupRoomId ?? null
  if (props.roomId !== undefined && group !== null) {
    if (task.parentId === null && props.roomId !== group) return <GroupEntry snapshot={snapshot} now={now} control={control} owner={owner} />
    if (task.parentId !== null && props.roomId === group) return <SubtaskLine snapshot={snapshot} now={now} owner={owner} />
  }
  const sessionId = snapshot.sessionId ?? undefined
  const inline = props.inline === true && !team && (task.status === 'done' || (snapshot.stage !== 'ended' && stageGroup(snapshot.stage) !== 'attention'))
  if (inline) return <InlineTask snapshot={snapshot} now={now} control={control} owner={owner} />
  const stageLabel =
    snapshot.stage === 'ended' && task.endReason !== null
      ? t(END_REASON_LABELS[task.endReason])
      : task.parentId !== null && snapshot.stage === 'review'
        ? t('等组长验收')
        : t(TICKET_STAGE_LABELS[snapshot.stage])
  return (
    <div className={`pod-task-card${finished ? ' pod-task-card-done' : ''}`}>
      <div className="pod-task-head">
        <div className="pod-task-title">
          {finished ? <Badge tone="ok">{t('交付')}</Badge> : <Badge tone={stageTone(snapshot.stage)}>{stageLabel}</Badge>}
          <strong>{task.title}</strong>
          {snapshot.ownerName === null || snapshot.children.length > 0 ? null : <BotName bot={owner} fallback={snapshot.ownerName} size={16} />}
        </div>
        {snapshot.stage === 'scheduled' ? null : (
          <span className="pod-muted-inline">
            {finished ? t('用时') : t('已用')} {elapsed(task, now)}
            {snapshot.cost > 0 ? t(' · 已花 {formatCost}', { formatCost: formatCost(snapshot.cost) }) : ''}
          </span>
        )}
      </div>
      {finished ? (
        <>
          <Delivery snapshot={snapshot} />
          <Undelivered snapshot={snapshot} />
        </>
      ) : (
        <>
          {team ? (
            <Stages task={task} done={snapshot.children.length > 0 ? snapshot.children.filter((child) => child.status === 'done').length : progress.done} total={snapshot.children.length > 0 ? snapshot.children.length : progress.total} />
          ) : null}
          <ReportLine snapshot={snapshot} />
          <TriggerLine snapshot={snapshot} />
          <SegmentBar snapshot={snapshot} />
          {props.compact === true || snapshot.children.length > 0 || task.acceptance.length === 0 ? null : (
            <ul className="pod-acceptance">
              {task.acceptance.map((item, index) => (
                <li key={index} className={item.done ? 'pod-acceptance-done' : ''}>
                  <span className="pod-check">{item.done ? '✓' : ''}</span>
                  {item.text}
                </li>
              ))}
            </ul>
          )}
          {task.status !== 'running' ? null : snapshot.activity?.running === true && snapshot.activity.progress !== null ? (
            <ProgressBlock progress={snapshot.activity.progress} label={snapshot.activity.current ?? ''} streaming={false} stalled={snapshot.activity.stalled} />
          ) : (
            <ActivityLine activity={snapshot.activity} now={now} prefix={tc('正在做', '任务卡')} />
          )}
          {snapshot.children
            .filter((child) => child.status === 'running' && snapshot.childActivity[child.id] !== undefined)
            .slice(0, 3)
            .map((child) => (
              <ActivityLine key={child.id} activity={snapshot.childActivity[child.id]} now={now} prefix={child.title} />
            ))}
          {task.note === '' || (snapshot.lastReport !== null && snapshot.lastReport.summary === task.note) ? null : <div className="pod-task-note">{t('进度说明：{note}', { note: task.note })}</div>}
          {snapshot.question !== null && snapshot.question !== undefined ? (
            <TaskQuestion wait={snapshot.question} more={Math.max(0, snapshot.waits - 1)} />
          ) : snapshot.waits > 0 ? (
            <div className="pod-task-wait">{t('等你处理：{waits} 件', { waits: snapshot.waits })}</div>
          ) : null}
          <Undelivered snapshot={snapshot} />
        </>
      )}
      <div className="pod-task-actions">
        <ActionButtons actions={actionsFor(snapshot)} control={control} />
        {sessionId === undefined ? null : (
          <Button small kind="quiet" icon="open" onClick={() => app.host.openSession(sessionId)}>
            {t('查看过程')}
          </Button>
        )}
        <Button small kind="quiet" onClick={() => app.openTask(task.rootId)}>
          {t('详情')}
        </Button>
        {finished ? null : <TaskTabs snapshot={snapshot} />}
      </div>
    </div>
  )
}
