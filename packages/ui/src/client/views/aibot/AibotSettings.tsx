import { useEffect, useState } from 'react'
import { t, type AibotBind, type AibotStatus, type PodSettings } from 'pod-domain'
import { aibotApi } from '../../api/aibot.ts'
import { errorText } from '../../api/http.ts'
import { Badge, Button, Switch } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { Row, type Update } from '../settings/Row.tsx'
import { aibotLine, retryText } from './aibotText.ts'
import { useAibot } from './useAibot.ts'

/** 第一行下面那句小字：现在怎样、为什么。 */
function detailOf(status: AibotStatus): string {
  switch (status.state) {
    case 'off':
      return t('关掉后不调 aibot、不收监控动态；开通信息保留，再打开接着用')
    case 'starting':
      return t('第一次用自动开通，不用注册登录')
    case 'disabled':
      return t('不会自动重新开通；aibot 那边恢复以后，点“重试”就能接着用')
    case 'ready': {
      if (status.message !== '') return status.message
      const free = status.dailyFree === null ? '' : t('每天免费 {limit} 次，读一次算一次，用你的 X 账号写一次算 4 次，监控不扣', { limit: status.dailyFree.limit })
      const key = status.keyTail === '' ? '' : t('Key 尾号 {keyTail}', { keyTail: status.keyTail })
      return [free, key].filter((part) => part !== '').join(' · ')
    }
    default:
      return retryText(status).replace(/^(，|,\s*)/, '')
  }
}

/** 设置里的 aibot：开关和今日剩余次数、监控、绑定账号（aibot 开放了才显示）。 */
export function AibotRows(props: { readonly settings: PodSettings; readonly update: Update }) {
  const app = useApp()
  const { data: status, error } = useAibot()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const retry = (): void => {
    setBusy(true)
    setProblem(undefined)
    aibotApi
      .retry()
      .then((next) => app.cache.update<AibotStatus>('aibot', () => next))
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  const toggle = <Switch checked={props.settings.aibotEnabled} label={t('X 数据和监控')} onChange={(aibotEnabled) => props.update({ aibotEnabled })} />
  if (status === undefined) {
    return (
      <Row label={t('X 数据和监控')} hint={error ?? t('正在读取 aibot 的状态…')}>
        {toggle}
      </Row>
    )
  }
  const detail = detailOf(status)
  const canRetry = status.state === 'waiting' || status.state === 'error' || status.state === 'disabled'
  const monitor = status.state === 'ready' ? status.monitor : null
  return (
    <>
      <Row
        label={t('X 数据和监控')}
        hint={
          <>
            <span className={status.state === 'disabled' ? 'pod-aibot-alert' : undefined}>{aibotLine(status)}</span>
            {detail === '' ? null : <span className="pod-aibot-detail">{detail}</span>}
            {problem === undefined ? null : <span className="pod-aibot-detail pod-aibot-alert">{problem}</span>}
          </>
        }
      >
        {canRetry ? (
          <Button small kind="quiet" disabled={busy} onClick={retry}>
            {busy ? t('正在检查…') : t('重试')}
          </Button>
        ) : null}
        {toggle}
      </Row>
      {monitor === null ? null : (
        <Row
          label={t('X 监控')}
          hint={t('已监控 {activeSubscriptionCount} / {accountLimit} 个账号，新动态发到「X 监控」群聊{value}', { activeSubscriptionCount: monitor.activeSubscriptionCount, accountLimit: monitor.accountLimit, value: monitor.pausedBySystem ? t('；30 天没用暂停了，下次调用后自动恢复') : '' })}
        >
          {status.stream === 'connected' ? <Badge tone="ok">{t('实时接收中')}</Badge> : null}
          {status.stream === 'retrying' ? <Badge tone="warn">{t('正在连接')}</Badge> : null}
          {status.roomId === null ? null : (
            <Button small kind="quiet" onClick={() => app.openRoom(status.roomId ?? '')}>
              {t('打开群聊')}
            </Button>
          )}
        </Row>
      )}
      {status.state === 'ready' && status.accountKind === 'account' ? (
        <Row label={t('aibot 账号')} hint={t('已绑定 {value}，监控和次数都算在这个账号上', { value: status.accountDisplay ?? t('账号') })}>
          <Badge tone="ok">{t('已绑定')}</Badge>
        </Row>
      ) : null}
      {status.state === 'ready' && status.bindAvailable && status.accountKind !== 'account' ? <BindRow /> : null}
    </>
  )
}

type BindOutcome = { readonly tone: 'ok' | 'warn'; readonly text: string }

/** 绑定账号：申请一个码，在 aibot 网页上核对、同意；这边每隔几秒查一次结果。 */
function BindRow() {
  const app = useApp()
  const [bind, setBind] = useState<AibotBind | undefined>(undefined)
  const [outcome, setOutcome] = useState<BindOutcome | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (bind === undefined) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (next: BindOutcome): void => {
      setBind(undefined)
      setOutcome(next)
      app.cache.invalidate('aibot')
    }
    const poll = (): void => {
      timer = setTimeout(() => {
        aibotApi
          .bindPoll(bind.id)
          .then((result) => {
            if (stopped) return
            if (result.status === 'approved') finish({ tone: 'ok', text: t('绑定好了{value}', { value: result.accountDisplay === null ? '' : t('：{accountDisplay}', { accountDisplay: result.accountDisplay }) }) })
            else if (result.status === 'denied') finish({ tone: 'warn', text: t('你在网页上拒绝了这次绑定') })
            else if (result.status === 'expired') finish({ tone: 'warn', text: t('码过期了，重新申请一个') })
            else poll()
          })
          .catch((reason: unknown) => {
            if (!stopped) finish({ tone: 'warn', text: errorText(reason) })
          })
      }, bind.pollIntervalSeconds * 1000)
    }
    poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [app, bind])
  const start = (): void => {
    setBusy(true)
    setOutcome(undefined)
    aibotApi
      .bindStart()
      .then(setBind)
      .catch((reason: unknown) => setOutcome({ tone: 'warn', text: errorText(reason) }))
      .finally(() => setBusy(false))
  }
  if (bind !== undefined) {
    return (
      <Row
        label={t('绑定 aibot 账号')}
        hint={
          <>
            <span>
              {t('在打开的网页上核对这个码：')}<code className="pod-aibot-code">{bind.code}</code>
            </span>
            <span className="pod-aibot-detail">{t('是同一个码再点同意，10 分钟内有效；这边会自己等结果')}</span>
          </>
        }
      >
        <a className="pod-button pod-button-default pod-button-small" href={bind.url} target="_blank" rel="noopener noreferrer">
          {t('打开网页核对')}
        </a>
        <Button small kind="quiet" onClick={() => setBind(undefined)}>
          {t('取消')}
        </Button>
      </Row>
    )
  }
  return (
    <Row
      label={t('绑定 aibot 账号')}
      hint={
        <>
          <span>{t('绑定后这台电脑上 dsh-bot 的监控和次数都算在你的 aibot 账号上，Key 不变')}</span>
          {outcome === undefined ? null : <span className={`pod-aibot-detail${outcome.tone === 'warn' ? ' pod-aibot-alert' : ' pod-aibot-ok'}`}>{outcome.text}</span>}
        </>
      }
    >
      <Button small disabled={busy} onClick={start}>
        {busy ? t('正在申请…') : t('绑定账号')}
      </Button>
    </Row>
  )
}
