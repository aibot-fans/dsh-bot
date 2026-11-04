import { TASK_STATUS_LABELS, t, type Task } from 'pod-domain'
import { Avatar, Empty } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { Markdown } from '../../components/Markdown.tsx'
import { PanelClose } from '../../components/PanelClose.tsx'
import { TaskStateIcon } from '../../components/TaskEntry.tsx'
import { useTaskPeople } from '../../components/TaskPeople.tsx'
import { useSnapshot } from '../../components/taskParts.tsx'
import { useApp, type PanelState } from '../../state/app.ts'
import { TaskFacts } from './TaskFacts.tsx'

/** 子任务一行：状态和标题，点一下看它的详情（左上角能回到这个任务）。 */
function ChildRow(props: { readonly task: Task; readonly onOpen: () => void }) {
  return (
    <button type="button" className="pod-task-child" onClick={props.onOpen}>
      <span className="pod-ellipsis">{props.task.title}</span>
      <span className="pod-muted-inline">{t(TASK_STATUS_LABELS[props.task.status])}</span>
    </button>
  )
}

/**
 * 任务详情：在任务干活的对话里（群、任务单聊）点任务卡、任务记号，或者在详情的任务页点一个任务时从右边打开。
 * 最上面是任务名和在做的 bot；下面是状态、来源、开始时间和暂停停止，连着进展；再下面是交代、结果和子任务。
 * 结果、问题和过程照旧在对话里，这里是把一件事的来龙去脉放在一处看。
 */
export function TaskPanel(props: { readonly taskId: string; readonly back?: PanelState }) {
  const app = useApp()
  const { snapshot, error } = useSnapshot(props.taskId)
  const people = useTaskPeople(snapshot)
  const back = props.back ?? null
  const here: PanelState = back === null ? { kind: 'task', taskId: props.taskId } : { kind: 'task', taskId: props.taskId, back }
  return (
    <aside className="pod-panel" aria-label={t('任务详情')}>
      <div className={`pod-panel-top${back === null ? '' : ' pod-panel-top-back'}`}>
        {back === null ? null : (
          <button type="button" className="pod-back" onClick={() => app.navigate({ panel: back })}>
            <Icon name="back" size={16} />
            <span className="pod-ellipsis">{t('返回')}</span>
          </button>
        )}
        <PanelClose label={t('关闭任务详情')} onClose={() => app.closePanel()} stacked={back !== null} />
      </div>
      {snapshot === undefined ? (
        <Empty title={error ?? t('正在读取…')} />
      ) : (
        <div className="pod-panel-scroll pod-stack">
          <header className="pod-task-hero">
            <div className="pod-row">
              <TaskStateIcon snapshot={snapshot} />
              <strong className="pod-task-hero-title">{snapshot.task.title}</strong>
            </div>
            {people.length === 0 ? null : (
              <span className="pod-tcard-people">
                {people.map((bot) => (
                  <span key={bot.id} className="pod-tcard-person">
                    <Avatar bot={bot} size={18} />
                    {bot.name}
                  </span>
                ))}
              </span>
            )}
          </header>
          <TaskFacts taskId={snapshot.task.id} title={t('概况')} />
          {snapshot.task.brief.trim() === '' ? null : (
            <section className="pod-box pod-task-section">
              <div className="pod-box-head">
                <strong>{t('交代')}</strong>
              </div>
              <Markdown className="pod-task-section-body" text={snapshot.task.brief} />
            </section>
          )}
          {snapshot.task.result === null || snapshot.task.result.summary.trim() === '' ? null : (
            <section className="pod-box pod-task-section">
              <div className="pod-box-head">
                <strong>{t('结果')}</strong>
              </div>
              <Markdown className="pod-task-section-body" text={snapshot.task.result.summary} />
              {snapshot.task.result.files.length === 0 ? null : <p className="pod-task-section-body pod-muted">{t('文件：{files}', { files: snapshot.task.result.files.join(t('、')) })}</p>}
            </section>
          )}
          {snapshot.children.length === 0 ? null : (
            <section className="pod-box pod-task-section">
              <div className="pod-box-head">
                <strong>{t('子任务')}</strong>
              </div>
              {snapshot.children.map((child) => (
                <ChildRow key={child.id} task={child} onOpen={() => app.showTask(child.id, here)} />
              ))}
            </section>
          )}
        </div>
      )}
    </aside>
  )
}
