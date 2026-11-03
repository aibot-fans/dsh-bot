import { useState } from 'react'
import { t, type PodSettings } from 'pod-domain'
import { api, type SystemProblem } from '../api/endpoints.ts'
import { errorText } from '../api/http.ts'
import { Button, RelativeTime } from '../components/common.tsx'
import { useApp } from '../state/app.ts'
import { useResource } from '../state/resource.ts'

const EFFECT_LABELS: Readonly<Record<string, string>> = {
  open: '开任务会话',
  deliver: '把消息交给会话',
  relay: '转交消息',
  notify: '发通知',
  reply: '往聊天室发消息',
  judge: '自动来源的判断',
  front: '把消息交给前台',
}

/** 系统问题的种类说成人话。 */
export function problemLabel(kind: string): string {
  if (kind.startsWith('effect:')) {
    const effect = kind.slice('effect:'.length)
    const label = EFFECT_LABELS[effect]
    return label === undefined ? effect : t(label)
  }
  if (kind.startsWith('model:')) {
    const model = kind.slice('model:'.length)
    return t('模型服务（{model}）', { model: model === 'default' ? t('默认模型') : model })
  }
  if (kind === 'front:missed') return t('前台漏掉了消息')
  return kind
}

function retryable(kind: string): boolean {
  return kind.startsWith('effect:') || kind.startsWith('model:') || kind === 'front:missed'
}

/** 处理暂停了：一直提示，一键继续。 */
function PausedBanner() {
  const app = useApp()
  const { data: settings } = useResource(app.cache, 'settings', () => api.settings())
  const [problem, setProblem] = useState<string | undefined>(undefined)
  if (settings === undefined || !settings.paused) return null
  const resume = (): void => {
    setProblem(undefined)
    api
      .updateSettings({ paused: false })
      .then((next) => app.cache.update<PodSettings>('settings', () => next))
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  return (
    <div className="pod-banner pod-banner-action" role="status">
      <span>
        {t('处理已暂停：不开工、不往会话里送消息、不往聊天室发，例程到点先不跑；消息照旧记下。')}
        {problem === undefined ? null : ` ${problem}`}
      </span>
      <Button small kind="primary" onClick={resume}>
        {t('继续处理')}
      </Button>
    </div>
  )
}

function ProblemRow(props: { readonly problem: SystemProblem; readonly busy: boolean; readonly onRetry: () => void }) {
  const { problem } = props
  return (
    <div className="pod-problem">
      <span className="pod-problem-text">
        <strong>{problemLabel(problem.kind)}</strong>
        <span>{problem.detail}</span>
        <span className="pod-problem-meta">
          {t('连续 {count} 次', { count: problem.failures })} · {t('开始于')} <RelativeTime time={problem.startedAt} />
        </span>
      </span>
      {retryable(problem.kind) ? (
        <Button small disabled={props.busy} onClick={props.onRetry}>
          {t('重试')}
        </Button>
      ) : null}
    </div>
  )
}

/** 还没恢复的系统问题：种类、最后一次错误、连续失败几次、从什么时候开始，可以点重试。 */
function ProblemsBanner() {
  const app = useApp()
  const { data: health } = useResource(app.cache, 'health', () => api.health())
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | undefined>(undefined)
  if (health === undefined || health.problems.length === 0) return null
  const retry = (kind: string): void => {
    setBusy(kind)
    setNote(undefined)
    api
      .retryProblem(kind)
      .then((result) => setNote(t('已重试 {count} 项', { count: result.retried })))
      .catch((reason: unknown) => setNote(errorText(reason)))
      .finally(() => {
        setBusy(null)
        app.cache.invalidate('health')
      })
  }
  return (
    <div className="pod-banner pod-problems" role="alert">
      {health.problems.map((problem) => (
        <ProblemRow key={problem.id} problem={problem} busy={busy === problem.kind} onRetry={() => retry(problem.kind)} />
      ))}
      {note === undefined ? null : <div className="pod-problem-note">{note}</div>}
    </div>
  )
}

/** 页面顶部的系统横条：处理暂停了、有系统问题；没问题时什么都没有。 */
export function SystemBanners() {
  return (
    <>
      <PausedBanner />
      <ProblemsBanner />
    </>
  )
}
