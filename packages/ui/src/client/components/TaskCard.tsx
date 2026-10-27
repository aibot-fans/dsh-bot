import { useEffect, useState } from 'react'
import {
  STAGE_LABELS,
  TASK_STATUS_LABELS,
  acceptanceProgress,
  formatCost,
  stagesFor,
  t,
  tc,
  type Task,
  type TaskActivity,
  type TaskSnapshot,
} from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { errorText } from '../api/http.ts'
import { useApp } from '../state/app.ts'
import { useResource } from '../state/resource.ts'
import { Badge, Button, useNow } from './common.tsx'
import { FilePreview } from './FilePreview.tsx'
import { BotName } from './GroupMark.tsx'
import { Markdown } from './Markdown.tsx'
import { ProgressBlock } from './Progress.tsx'

function elapsed(task: Task, now: number): string {
  const end = task.finishedAt ?? now
  const minutes = Math.max(0, Math.round((end - (task.startedAt ?? task.createdAt)) / 60_000))
  return minutes < 60 ? t('{minutes} 分钟', { minutes }) : t('{floor} 小时 {value} 分', { floor: Math.floor(minutes / 60), value: minutes % 60 })
}

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

function Delivery(props: { readonly snapshot: TaskSnapshot }) {
  const result = props.snapshot.task.result
  const [preview, setPreview] = useState<string | undefined>(undefined)
  if (result === null) return null
  const caveats = [...result.assumptions.map((item) => t('假设：{item}', { item })), ...result.unverified.map((item) => t('未核实：{item}', { item })), ...result.skipped.map((item) => t('跳过：{item}', { item }))]
  return (
    <div className="pod-delivery">
      <Markdown text={result.summary} />
      {result.files.length === 0 ? null : (
        <div className="pod-delivery-files">
          <span className="pod-label">{t('文件')}</span>
          {result.files.map((file) => (
            <button key={file} type="button" className="pod-file" title={t('预览')} onClick={() => setPreview(file)}>
              {file}
            </button>
          ))}
        </div>
      )}
      {preview === undefined ? null : <FilePreview path={preview} taskId={props.snapshot.task.id} onClose={() => setPreview(undefined)} />}
      {caveats.length === 0 ? null : (
        <div className="pod-caveats">
          <span className="pod-label">{t('前提和待确认')}</span>
          <ul>
            {caveats.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * 原地刷新的任务卡：阶段、分段进度条、验收项、正在做什么、等你的事；
 * 任务完成后变成交付卡：要点、文件、用时、花费、前提和待确认。
 */
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

export function TaskCard(props: { readonly taskId: string; readonly compact?: boolean }) {
  const app = useApp()
  const now = useNow(5000)
  const { data: snapshot, error } = useResource(app.cache, `snapshot:${props.taskId}`, () => api.taskSnapshot(props.taskId))
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  useEffect(() => {
    if (snapshot !== undefined) app.rememberTree(snapshot.task.rootId, [snapshot.task.id, ...snapshot.children.map((child) => child.id)])
  }, [app, snapshot])
  if (snapshot === undefined) return <div className="pod-task-card pod-task-card-loading">{error === undefined ? t('正在读取任务…') : error}</div>
  const { task } = snapshot
  const progress = acceptanceProgress(task.acceptance)
  const finished = task.status === 'done'
  const control = (action: 'pause' | 'resume' | 'stop' | 'cancel'): void => {
    api.controlTask(task.id, action).catch((reason: unknown) => window.alert(errorText(reason)))
  }
  const sessionId = snapshot.sessionId ?? undefined
  return (
    <div className={`pod-task-card${finished ? ' pod-task-card-done' : ''}`}>
      <div className="pod-task-head">
        <div className="pod-task-title">
          {finished ? <Badge tone="ok">{t('交付')}</Badge> : <Badge tone={task.status === 'waiting' ? 'warn' : task.status === 'failed' ? 'danger' : 'info'}>{t(TASK_STATUS_LABELS[task.status])}</Badge>}
          <strong>{task.title}</strong>
          {snapshot.ownerName === null || snapshot.children.length > 0 ? null : <BotName bot={bots?.find((bot) => bot.id === task.ownerBotId)} fallback={snapshot.ownerName} size={16} />}
        </div>
        <span className="pod-muted-inline">
          {finished ? t('用时') : t('已用')} {elapsed(task, now)}
          {snapshot.cost > 0 ? t(' · 已花 {formatCost}', { formatCost: formatCost(snapshot.cost) }) : ''}
        </span>
      </div>
      {finished ? (
        <Delivery snapshot={snapshot} />
      ) : (
        <>
          <Stages task={task} done={snapshot.children.length > 0 ? snapshot.children.filter((child) => child.status === 'done').length : progress.done} total={snapshot.children.length > 0 ? snapshot.children.length : progress.total} />
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
          {task.note === '' ? null : <div className="pod-task-note">{t('进度说明：{note}', { note: task.note })}</div>}
          {snapshot.waits > 0 ? <div className="pod-task-wait">{t('等你处理：{waits} 件', { waits: snapshot.waits })}</div> : null}
        </>
      )}
      <div className="pod-task-actions">
        {task.status === 'running' || task.status === 'waiting' ? (
          <>
            <Button small kind="quiet" icon="pause" onClick={() => control('pause')}>
              {t('暂停')}
            </Button>
            <Button small kind="quiet" icon="stop" onClick={() => control('stop')}>
              {t('停止')}
            </Button>
          </>
        ) : null}
        {task.status === 'paused' || task.status === 'stopped' ? (
          <Button small kind="quiet" icon="play" onClick={() => control('resume')}>
            {t('继续')}
          </Button>
        ) : null}
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
