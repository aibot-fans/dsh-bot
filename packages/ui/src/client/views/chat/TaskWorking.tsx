import { t, type Bot } from 'pod-domain'
import { nameColor, useNow } from '../../components/common.tsx'
import { spent } from '../../components/duration.ts'
import { workingNow } from '../../components/taskLines.ts'
import { useSnapshot } from '../../components/taskParts.tsx'

/**
 * 任务对话输入框上面那一行：「运维师 正在处理 · 1 分钟 · 在运行命令」。时间是这一轮干了多久；
 * 群里负责的 bot 在等子任务时写正在干活的成员。没有谁在干活时不显示。
 */
export function TaskWorking(props: { readonly taskId: string; readonly bots: ReadonlyMap<string, Bot> }) {
  const { snapshot } = useSnapshot(props.taskId)
  const now = useNow(15_000)
  const work = snapshot === undefined ? undefined : workingNow(snapshot, props.bots)
  if (work === undefined) return null
  const parts = [t('正在处理'), spent(now - work.since), ...(work.step === '' ? [] : [work.step])]
  return (
    <div className="pod-task-working" role="status">
      <span className="pod-spinner" aria-hidden />
      <strong className="pod-bot-name" style={nameColor(props.bots.get(work.botId ?? ''))}>
        {work.name}
      </strong>
      <span className="pod-task-working-text">{parts.join(' · ')}</span>
    </div>
  )
}
