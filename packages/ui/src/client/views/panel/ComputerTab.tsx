import { t, type ComputerUser } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { computerApi } from '../../api/computer.ts'
import { Button, Empty, RelativeTime } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

/**
 * bot 详情、群聊详情的「电脑」页：这个 bot（群里的成员）现在在不在用这台 Mac 上的应用，在用的点“看画面”打开电脑面板；
 * 用电脑关着、缺系统权限时说一句，带去设置的按钮。同一时间只有一个任务能用电脑，别人在用时也写出来。
 */
export function ComputerTab(props: { readonly mine: (user: ComputerUser) => boolean; readonly name: string }) {
  const app = useApp()
  const { data: status, error } = useResource(app.cache, 'computer', () => computerApi.status())
  const { data: settings } = useResource(app.cache, 'settings', () => api.settings())
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  if (status === undefined) return <p className="pod-muted">{error ?? t('正在读取…')}</p>
  const toSettings = (
    <span>
      <Button small onClick={() => app.openSettings('computer')}>
        {t('去设置')}
      </Button>
    </span>
  )
  if (settings !== undefined && !settings.computerUse) {
    return (
      <Empty title={t('用电脑关着')}>
        <div className="pod-stack">
          <span>{t('打开以后，做任务的 bot 能在后台用这台 Mac 上别的应用，它在用的应用窗口会出现在电脑面板里。')}</span>
          {toSettings}
        </div>
      </Empty>
    )
  }
  if (status.state !== 'ready') return <Empty title={t('用不了电脑')}>{status.message}</Empty>
  const permissions = status.permissions
  const lacking = permissions !== null && !(permissions.accessibility && permissions.screenRecording)
  const user = status.user
  const userName = user === null ? '' : (bots?.find((bot) => bot.id === user.botId)?.name ?? user.botId)
  return (
    <div className="pod-stack">
      {lacking ? (
        <section className="pod-fix" role="status">
          <strong>{t('小助手还缺系统权限')}</strong>
          <span>{t('bot 现在用不了电脑：去设置的“用电脑”页按步骤授权。')}</span>
          {toSettings}
        </section>
      ) : null}
      {user === null ? (
        <Empty title={t('{name}现在没在用电脑', { name: props.name })}>{t('做任务要用这台 Mac 上的应用时会先问你；用的时候，它在用的应用窗口会出现在电脑面板里，你随时可以接管。')}</Empty>
      ) : (
        <section className="pod-box pod-task-section">
          <div className="pod-box-head">
            <strong>{props.mine(user) ? t('{name}在用「{app}」', { name: userName, app: user.app ?? user.apps.join(t('、')) }) : t('现在是{name}在用电脑', { name: userName })}</strong>
          </div>
          <p className="pod-task-section-body">
            {t('任务「{task}」', { task: user.taskTitle })}
            {user.last === null ? null : (
              <>
                {' · '}
                {user.last.label} <RelativeTime time={user.last.at} />
              </>
            )}
          </p>
          {props.mine(user) ? null : <p className="pod-task-section-body pod-muted">{t('同一时间只有一个任务能用电脑，几分钟没动静会自动让出来。')}</p>}
          <div className="pod-task-section-body">
            <Button small kind="primary" onClick={() => app.openComputer()}>
              {t('看画面')}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
