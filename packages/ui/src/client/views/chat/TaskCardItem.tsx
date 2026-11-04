import { useMemo } from 'react'
import { WAIT_KIND_LABELS, t, type Bot, type TaskSnapshot } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { Avatar, listTime, useNow } from '../../components/common.tsx'
import { TaskStateIcon, bucketLabel, bucketOf, openTaskConversation } from '../../components/TaskEntry.tsx'
import { workLine } from '../../components/taskLines.ts'
import { Undelivered, useSnapshot } from '../../components/taskParts.tsx'
import { useTaskPeople } from '../../components/TaskPeople.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

interface Foot {
  readonly tone: 'live' | 'ask' | 'quiet'
  readonly text: string
}

/** 卡片最下面那行：在做时是这一步在做什么（蓝字），等你时是在等什么、没做成写原因（红字），做完写更新时间。 */
function footOf(snapshot: TaskSnapshot, bots: ReadonlyMap<string, Bot>, now: number): Foot {
  const { task, stage } = snapshot
  const bucket = bucketOf(snapshot)
  if (bucket === 'done') return { tone: 'quiet', text: t('更新于 {time}', { time: listTime(task.updatedAt, now) }) }
  if (bucket === 'ended') return { tone: 'quiet', text: bucketLabel(snapshot, bucket) }
  if (bucket === 'attention') {
    const question = snapshot.question
    if (question !== null) {
      // 要批准的写操作和别的批准一样写“等你批准”。
      const label = WAIT_KIND_LABELS[question.kind === 'write' ? 'approval' : question.kind]
      return { tone: 'ask', text: t('{label}：{text}', { label: t(label), text: question.title }) }
    }
    const label = stage === 'failed' ? t('没做成') : bucketLabel(snapshot, bucket)
    return { tone: 'ask', text: task.note === '' ? label : t('{label}：{text}', { label, text: task.note }) }
  }
  return { tone: 'live', text: workLine(snapshot, bots) }
}

/**
 * Super-agent 开任务时那句话下面的任务卡片：第一行是状态图标和任务名，下面是干活的 bot，最下面一行是这一步在做什么、
 * 在等你什么或者什么时候更新的。点一下在右边小窗打开任务的对话。
 */
export function TaskCardItem(props: { readonly taskId: string; readonly roomId: string }) {
  const app = useApp()
  const now = useNow()
  const { snapshot, error } = useSnapshot(props.taskId)
  const people = useTaskPeople(snapshot)
  const { data: botList } = useResource(app.cache, 'bots', () => api.bots())
  const bots = useMemo(() => new Map((botList ?? []).map((bot): [string, Bot] => [bot.id, bot])), [botList])
  if (snapshot === undefined) return <div className="pod-tcard pod-tcard-loading">{error ?? t('正在读取任务…')}</div>
  const foot = footOf(snapshot, bots, now)
  return (
    <div className="pod-tcard-wrap">
      <button type="button" className={`pod-tcard pod-tcard-${bucketOf(snapshot)}`} onClick={() => openTaskConversation(app, snapshot, props.roomId)}>
        <span className="pod-tcard-head">
          <TaskStateIcon snapshot={snapshot} />
          <span className="pod-tcard-title">{snapshot.task.title}</span>
        </span>
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
        {foot.text === '' ? null : <span className={`pod-tcard-foot pod-tcard-foot-${foot.tone}`}>{foot.text}</span>}
      </button>
      <Undelivered snapshot={snapshot} />
    </div>
  )
}
