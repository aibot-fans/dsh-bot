import { useAibot } from './useAibot.ts'

/** 首次引导里的一句：开通好了说每天免费几次、能监控几个账号（数字来自 aibot）。 */
export function AibotIntro() {
  const { data: status } = useAibot()
  if (status === undefined || status.state === 'off' || status.state === 'disabled') return null
  if (status.state === 'starting') return <p className="pod-aibot-intro">正在开通 X 数据和监控…</p>
  if (status.state !== 'ready') return <p className="pod-aibot-intro">X 数据和监控还没开通好：{status.message}。会自动再试，也可以在设置里点“重试”。</p>
  const limit = status.dailyFree?.limit
  const accounts = status.monitor?.accountLimit
  const numbers = limit === undefined || accounts === undefined ? '' : `：每天免费 ${limit} 次，免费监控 ${accounts} 个账号`
  return (
    <p className="pod-aibot-intro">
      已开通 X 数据和监控{numbers}。想查推文、盯某个账号，去「X 监控」群里跟 X 情报员说。
    </p>
  )
}
