import { useEffect, useState } from 'react'
import { REPORT_STATUS_LABELS, stageGroup, t, type Task, type TaskSnapshot } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { useApp } from '../state/app.ts'
import { useResource } from '../state/resource.ts'
import { Button } from './common.tsx'
import { duration } from './duration.ts'
import { FilePreview } from './FilePreview.tsx'
import { Markdown } from './Markdown.tsx'

/** 任务卡、群聊入口和任务群顶上共用的任务快照：任务动了会刷新（整棵树一起记下）。 */
export function useSnapshot(taskId: string): { readonly snapshot: TaskSnapshot | undefined; readonly error: string | undefined } {
  const app = useApp()
  const { data: snapshot, error } = useResource(app.cache, taskId === '' ? null : `snapshot:${taskId}`, () => api.taskSnapshot(taskId))
  useEffect(() => {
    if (snapshot !== undefined) app.rememberTree(snapshot.task.rootId, [snapshot.task.id, ...snapshot.children.map((child) => child.id)])
  }, [app, snapshot])
  return { snapshot, error }
}

export function elapsed(task: Task, now: number): string {
  return duration((task.finishedAt ?? now) - (task.startedAt ?? task.createdAt))
}

export type ControlAction = 'pause' | 'resume' | 'stop' | 'cancel' | 'retry' | 'accept'

const ACTION_LABELS: Readonly<Record<ControlAction, string>> = { pause: '暂停', resume: '继续', stop: '停止', cancel: '取消', retry: '重试', accept: '收下' }
const ACTION_ICONS: Readonly<Record<ControlAction, 'pause' | 'play' | 'stop' | undefined>> = { pause: 'pause', resume: 'play', stop: 'stop', cancel: 'stop', retry: 'play', accept: undefined }

/** 按旧计划组队的团队任务（L2、L3）：没有工单的阶段，按状态给按钮。 */
export function isTeamTask(task: Task): boolean {
  return task.level === 'L2' || task.level === 'L3'
}

/**
 * 工单的按钮按阶段给：在做能暂停、停止；等新消息能继续（等子任务交上来的不能）；等到点的只能停止（要提前跑在任务页点“现在跑一次”）；
 * 受阻、失败能重试；等你验收能收下；你停掉的能继续。子任务由组长验收，没有收下。
 */
export function ticketActions(snapshot: TaskSnapshot): readonly ControlAction[] {
  if (snapshot.task.parentId !== null && snapshot.stage === 'review') return ['stop']
  const running = snapshot.run !== null && snapshot.run.status === 'running'
  switch (snapshot.stage) {
    case 'running':
    case 'queued':
      return running ? ['pause', 'stop'] : ['stop']
    case 'idle':
      // 组长开完子任务在等它们交上来：没什么可“继续”的。
      return snapshot.children.some((child) => child.endedAt === null) ? ['stop'] : ['resume', 'stop']
    case 'scheduled':
      return ['stop']
    case 'blocked':
    case 'failed':
      return ['retry', 'stop']
    case 'review':
      return ['accept', 'retry', 'stop']
    case 'waiting':
    case 'undelivered':
      return running ? ['pause', 'stop'] : ['stop']
    case 'ended':
      return snapshot.task.endReason === 'stopped' ? ['resume'] : []
  }
}

export function teamActions(task: Task): readonly ControlAction[] {
  if (task.status === 'running' || task.status === 'waiting') return ['pause', 'stop']
  if (task.status === 'paused' || task.status === 'stopped') return ['resume']
  return []
}

export function actionsFor(snapshot: TaskSnapshot): readonly ControlAction[] {
  return isTeamTask(snapshot.task) ? teamActions(snapshot.task) : ticketActions(snapshot)
}

/** 一排任务按钮：收下是主按钮，其余都是安静的小按钮。 */
export function ActionButtons(props: { readonly actions: readonly ControlAction[]; readonly control: (action: ControlAction) => void }) {
  return (
    <>
      {props.actions.map((action) => (
        <Button key={action} small kind={action === 'accept' ? 'primary' : 'quiet'} icon={ACTION_ICONS[action]} onClick={() => props.control(action)}>
          {t(ACTION_LABELS[action])}
        </Button>
      ))}
    </>
  )
}

/** 交付：要点、文件（点开预览）、前提和待确认。 */
export function Delivery(props: { readonly snapshot: TaskSnapshot }) {
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

/** 发不出去的消息：交不进会话的，或者发不到聊天室的回复；点重试马上再试。 */
export function Undelivered(props: { readonly snapshot: TaskSnapshot }) {
  const { undelivered, task } = props.snapshot
  if (undelivered === null || undelivered === undefined) return null
  return (
    <div className="pod-task-wait">
      {t('消息没送到：{error}', { error: undelivered.error })}{' '}
      <Button onClick={() => void api.redeliverTask(task.id)}>{t('重试')}</Button>
    </div>
  )
}

/**
 * 最后一句进展和最后一次汇报：这次执行里有进展汇报就写进展；要你处理或等新消息时写那次汇报（它定了现在的阶段）；
 * 重新开工以后、还没新汇报时不写旧的。
 */
export function ReportLine(props: { readonly snapshot: TaskSnapshot }) {
  const { lastReport: report, run, stage } = props.snapshot
  if (report === null) return null
  if (report.status === 'progress') {
    if (run !== null && report.createdAt < run.queuedAt) return null
    return <div className="pod-task-note">{t('进展：{summary}', { summary: report.summary })}</div>
  }
  if (stage !== 'idle' && stage !== 'ended' && stageGroup(stage) !== 'attention') return null
  return <div className="pod-task-note">{t('最近汇报（{status}）：{summary}', { status: t(REPORT_STATUS_LABELS[report.status]), summary: report.summary })}</div>
}
