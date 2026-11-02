import { t, type TaskSnapshot } from 'pod-domain'
import { stamp } from './duration.ts'

/** 任务卡上的触发器：什么时候叫醒、下次几点；暂停了标出来，挂了几个的说一声。 */
export function TriggerLine(props: { readonly snapshot: TaskSnapshot }) {
  const trigger = props.snapshot.trigger
  if (trigger === null || props.snapshot.stage === 'ended') return null
  const next = !trigger.enabled ? t('已暂停') : trigger.nextAt === null ? '' : t('下次 {time}', { time: stamp(trigger.nextAt) })
  return (
    <div className="pod-task-trigger">
      {t('到点叫醒：{text}', { text: trigger.text })}
      {next === '' ? null : <span className="pod-muted-inline"> · {next}</span>}
      {trigger.count > 1 ? <span className="pod-muted-inline"> · {t('共 {count} 个', { count: trigger.count })}</span> : null}
    </div>
  )
}
