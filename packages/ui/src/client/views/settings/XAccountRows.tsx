import { useState } from 'react'
import { SITE_MODE_LABELS, t, withXWriteMode, xWriteMode, type PodSettings, type SiteMode, type XAccountStatus } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { xApi } from '../../api/x.ts'
import { Badge, Button, Segmented } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { Row, type Update } from './Row.tsx'

const LOGIN_URL = 'https://x.com/i/flow/login'

function badgeOf(status: XAccountStatus) {
  switch (status.state) {
    case 'ready':
      return <Badge tone="ok">@{status.handle}</Badge>
    case 'signed-out':
      return <Badge tone="muted">{t('未登录')}</Badge>
    case 'locked':
      return <Badge tone="danger">{t('账号受限')}</Badge>
    case 'error':
      return <Badge tone="danger">{t('检查出错')}</Badge>
    default:
      return null
  }
}

function hintOf(status: XAccountStatus): string {
  switch (status.state) {
    case 'ready':
      return t('bot 用这个账号发推、点赞、转推、关注{name}', { name: status.name === '' ? '' : t('（{name}）', { name: status.name }) })
    case 'signed-out':
      return t('dsh-bot 的浏览器里没登录 X：点“登录”在浏览器里登录，登录好回来点“检查”')
    case 'locked':
    case 'error':
      return status.message
    default:
      return t('bot 发推、点赞、转推、关注用 dsh-bot 浏览器里登录的 X 账号；点“检查”看看登录的是谁')
  }
}

/** 设置里的 X 账号：dsh-bot 浏览器里登录的 X 账号（x_ 工具用它），和 X 写操作要不要先问你。 */
export function XAccountRows(props: { readonly settings: PodSettings; readonly update: Update }) {
  const app = useApp()
  const { data: status, error } = useResource(app.cache, 'x-account', () => xApi.status())
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const check = (): void => {
    setBusy(true)
    setProblem(undefined)
    xApi
      .check()
      .then((next) => app.cache.update<XAccountStatus>('x-account', () => next))
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  const login = (): void => {
    setProblem(undefined)
    api
      .openTab(LOGIN_URL)
      .then((tab) => {
        app.navigate({ settings: null })
        app.openBrowserTab(tab.id)
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  const mode = xWriteMode(props.settings.siteRules)
  // 禁止连 x.com 都打不开，这里不给选；已经是禁止时才列出来。
  const modes: readonly SiteMode[] = mode === 'blocked' ? ['approve-writes', 'free', 'read-only', 'blocked'] : ['approve-writes', 'free', 'read-only']
  return (
    <>
      <Row
        label={t('X 账号')}
        hint={
          <>
            <span>{status === undefined ? (error ?? t('正在读取…')) : hintOf(status)}</span>
            {problem === undefined ? null : <span className="pod-aibot-detail pod-aibot-alert">{problem}</span>}
          </>
        }
      >
        {status === undefined ? null : badgeOf(status)}
        {status?.state === 'ready' ? null : (
          <Button small onClick={login}>
            {t('登录')}
          </Button>
        )}
        <Button small kind="quiet" disabled={busy} onClick={check}>
          {busy ? t('正在检查…') : t('检查')}
        </Button>
      </Row>
      <Row label={t('X 写操作')} hint={t('bot 用 X 账号发推、删推、点赞、转推、关注时；和浏览器站点规则里的 x.com 是同一条。dsh web 对外开放时一律不做')}>
        <Segmented value={mode} options={modes.map((item) => [item, t(SITE_MODE_LABELS[item])] as const)} onChange={(next) => props.update({ siteRules: withXWriteMode(props.settings.siteRules, next) })} label={t('X 写操作')} />
      </Row>
    </>
  )
}
