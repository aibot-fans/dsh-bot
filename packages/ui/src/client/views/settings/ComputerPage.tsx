import { useEffect, useRef, useState } from 'react'
import { t, type ComputerStatus, type PodSettings } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { computerApi } from '../../api/computer.ts'
import { errorText } from '../../api/http.ts'
import { Badge, Button, Switch } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { Row, type Update } from './Row.tsx'

type Busy = 'check' | 'permissions'

/**
 * 用电脑：开关、小助手（随 dsh-bot 一起装，不用另外装）、系统权限、现在谁在用（点“看画面”打开电脑面板）。
 * 第一次打开这页顺手问一下权限；还缺权限时，从系统设置切回来就再问一次。
 */
export function ComputerPage(props: { readonly settings: PodSettings; readonly update: Update }) {
  const app = useApp()
  const { settings, update } = props
  const { data: status, error } = useResource(app.cache, 'computer', () => computerApi.status())
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  const [busy, setBusy] = useState<Busy | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const inFlight = useRef(false)
  const act = (kind: Busy, call: () => Promise<ComputerStatus>): void => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(kind)
    setProblem(undefined)
    call()
      .then((next) => app.cache.update<ComputerStatus>('computer', () => next))
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => {
        inFlight.current = false
        setBusy(undefined)
      })
  }
  const ready = settings.computerUse && status?.state === 'ready'
  const permissions = status?.permissions ?? null
  const unchecked = ready && permissions === null
  const missing = ready && permissions !== null && !(permissions.accessibility && permissions.screenRecording)
  // 只在还没问过权限时问一次（会按需拉起小助手）。
  useEffect(() => {
    if (unchecked) act('check', computerApi.check)
  }, [unchecked])
  // 还缺权限：多半是去系统设置里授权了，切回这个页面时再问一次，不用手动点“检查”。
  useEffect(() => {
    if (!missing) return undefined
    const recheck = (): void => {
      if (document.visibilityState === 'visible') act('check', computerApi.check)
    }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [missing])
  if (status === undefined) return <p className="pod-muted">{error ?? t('正在读取…')}</p>
  if (status.state === 'unsupported') return <p className="pod-muted">{status.message}</p>
  const user = status.user
  return (
    <div className="pod-settings-body">
      <Row label={t('用电脑')} hint={t('做任务的 bot 能在后台用这台 Mac 上别的应用：看窗口内容、点按钮、填字，不占用你的鼠标键盘。每个任务第一次用某个应用前先问你；浏览器、终端、系统设置和密码类应用不让碰。关掉时收回所有授权')}>
        <Switch checked={settings.computerUse} label={t('用电脑')} onChange={(computerUse) => update({ computerUse })} />
      </Row>
      <Row
        label={t('小助手')}
        hint={
          <>
            <span>{status.message}</span>
            <span className="pod-aibot-detail">{t('读写窗口、推画面靠开源项目 Comma（AGPL-3.0）的 macOS 小助手，只在这台电脑上运行')}</span>
          </>
        }
      >
        {status.state === 'ready' ? <Badge tone="ok">{t('已装好')}</Badge> : <Badge tone="muted">{t('没带')}</Badge>}
      </Row>
      {!ready ? null : (
        <Row
          label={t('系统权限')}
          hint={
            <>
              <span>{t('小助手要辅助功能（读窗口、点按钮）和屏幕录制（截窗口的图、推画面）两项授权：点“打开授权窗口”，按提示在系统设置里打开 dsh-bot Computer Use')}</span>
              {missing ? <span className="pod-aibot-detail">{t('系统设置里开着、这里还显示没授权：系统记着的是旧版小助手（dsh-bot 升级换了小助手就会这样），只打开开关不管用。在系统设置对应的那一项里选中 dsh-bot Computer Use，点“−”删掉，再回来点“打开授权窗口”重新加上')}</span> : null}
            </>
          }
        >
          {permissions === null ? null : (
            <>
              <Badge tone={permissions.accessibility ? 'ok' : 'danger'}>{permissions.accessibility ? t('辅助功能已授权') : t('辅助功能没授权')}</Badge>
              <Badge tone={permissions.screenRecording ? 'ok' : 'danger'}>{permissions.screenRecording ? t('屏幕录制已授权') : t('屏幕录制没授权')}</Badge>
            </>
          )}
          <Button small disabled={busy !== undefined} onClick={() => act('permissions', computerApi.permissions)}>
            {t('打开授权窗口')}
          </Button>
          <Button small kind="quiet" disabled={busy !== undefined} onClick={() => act('check', computerApi.check)}>
            {busy === 'check' ? t('正在检查…') : t('检查')}
          </Button>
        </Row>
      )}
      {user === null ? null : (
        <Row label={t('现在在用')} hint={t('同一时间只有一个任务能用电脑；几分钟没动静会自动让出来')}>
          <span>{t('{bot}（任务「{task}」）', { bot: bots?.find((bot) => bot.id === user.botId)?.name ?? user.botId, task: user.taskTitle })}</span>
          <Button small onClick={() => app.openComputer()}>
            {t('看画面')}
          </Button>
        </Row>
      )}
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
    </div>
  )
}
