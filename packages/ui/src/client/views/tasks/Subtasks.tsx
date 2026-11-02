import { TASK_STATUS_LABELS, acceptanceProgress, t, type Bot } from 'pod-domain'
import { api, type TaskDetail as TaskDetailData } from '../../api/endpoints.ts'
import { Badge, Button } from '../../components/common.tsx'
import { BotName } from '../../components/GroupMark.tsx'
import { segmentTone } from '../../components/TaskCard.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

/** 子任务树：负责人、状态、验收项、进度说明和结果，每个都能查看过程。 */
export function Subtasks(props: { readonly detail: TaskDetailData; readonly bots: ReadonlyMap<string, Bot> }) {
  const app = useApp()
  const { children } = props.detail.snapshot
  const rootId = props.detail.snapshot.task.rootId
  const { data: plan } = useResource(app.cache, `plan:${rootId}`, () => api.taskPlan(rootId))
  if (children.length === 0) return null
  const keyOf = new Map(Object.entries(plan?.keys ?? {}).map(([key, id]) => [id, key]))
  return (
    <section>
      <div className="pod-section-title">{t('子任务')}</div>
      <ol className="pod-subtasks">
        {children.map((child) => {
          const progress = acceptanceProgress(child.acceptance)
          const session = props.detail.sessions.find((item) => item.taskId === child.id && item.status === 'active')
          return (
            <li key={child.id} className={`pod-subtask pod-tile-${segmentTone(child)}`}>
              <div className="pod-row pod-wrap">
                <span className="pod-muted-inline">{keyOf.get(child.id) ?? ''}</span>
                <button type="button" className="pod-link" onClick={() => app.openTask(child.id)}>
                  <strong>{child.title}</strong>
                </button>
                <Badge tone={child.status === 'done' ? 'ok' : child.status === 'waiting' ? 'warn' : child.status === 'failed' ? 'danger' : 'muted'}>{t(TASK_STATUS_LABELS[child.status])}</Badge>
                <span className="pod-muted-inline">
                  {child.ownerBotId === null ? t('未指定') : <BotName bot={props.bots.get(child.ownerBotId)} size={14} />} {t('· 验收项 {done}/{total}{value}', { done: progress.done, total: progress.total, value: child.attempts > 0 ? t(' · 打回 {attempts} 次', { attempts: child.attempts }) : '' })}
                </span>
                {session === undefined ? null : (
                  <Button small kind="quiet" icon="open" onClick={() => app.host.openSession(session.id)}>
                    {t('查看过程')}
                  </Button>
                )}
              </div>
              {child.note === '' ? null : <div className="pod-muted">{child.note}</div>}
              {child.result === null ? null : <div className="pod-muted">{t('结果：{split}', { split: child.result.summary.split('\n')[0] })}</div>}
            </li>
          )
        })}
      </ol>
      {plan === undefined ? null : (
        <div className="pod-plan-meta">
          <div>
            {t('计划第 {version} 版{value}', { version: plan.plan.version, value: plan.plan.revision === null ? '' : t('：{reason}', { reason: plan.plan.revision.reason }) })}
          </div>
          {plan.plan.assumptions.length === 0 ? null : <div>{t('前提：{assumptions}', { assumptions: plan.plan.assumptions.map((item) => item.text).join(t('；')) })}</div>}
          {plan.plan.conventions.length === 0 ? null : <div>{t('任务约定：{conventions}', { conventions: plan.plan.conventions.join(t('；')) })}</div>}
        </div>
      )}
    </section>
  )
}
