import { t, type UpdateStatus } from 'pod-domain'
import { updateApi } from '../../api/update.ts'
import { Icon } from '../../components/Icon.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

type Tone = 'info' | 'warn' | 'danger'

/** 侧栏上怎么提：有能装的新版、正在更新、要重启、没更新成；都没有就不显示。 */
function reminderOf(status: UpdateStatus): { readonly label: string; readonly title: string; readonly tone: Tone } | undefined {
  const { job } = status
  if (job?.outcome === null) return { label: t('正在更新'), title: t('正在更新到 {to}', { to: job.to }), tone: 'info' }
  if (job?.outcome === 'restart') return { label: t('重启后生效'), title: t('{to} 装好了，重启 dsh web 后生效', { to: job.to }), tone: 'warn' }
  if (job?.outcome === 'failed') return { label: t('更新没成'), title: t('这次没更新成，点开看原因'), tone: 'danger' }
  if (status.target !== null) return { label: t('新版 {target}', { target: status.target }), title: t('dsh-bot 有新版本 {target}，点开看更新了什么', { target: status.target }), tone: 'info' }
  return undefined
}

/** 侧栏底部“设置”旁边的新版本提醒，点开是更新弹窗。侧栏收起时是一个带圆点的图标。 */
export function UpdateButton(props: { readonly collapsed: boolean }) {
  const app = useApp()
  const { data: status } = useResource(app.cache, 'update', () => updateApi.status())
  const reminder = status === undefined ? undefined : reminderOf(status)
  if (reminder === undefined) return null
  if (props.collapsed) {
    return (
      <button type="button" className="pod-side-row pod-update-mini" title={reminder.title} aria-label={reminder.title} onClick={() => app.openUpdate()}>
        <Icon name="update" size={18} />
        <span className={`pod-update-dot pod-update-${reminder.tone}`} />
      </button>
    )
  }
  return (
    <button type="button" className={`pod-update-pill pod-update-${reminder.tone}`} title={reminder.title} onClick={() => app.openUpdate()}>
      <span className="pod-update-pill-dot" />
      {reminder.label}
    </button>
  )
}
