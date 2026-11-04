import { t } from 'pod-domain'
import { useNow } from '../../components/common.tsx'
import { resetText } from './aibotText.ts'
import { useAibot } from './useAibot.ts'

/** 用量页里 aibot 的次数：今天还剩几次、什么时候恢复。没开通好、没有免费次数时不显示，下面的开关那行会说现在怎样。 */
export function AibotUsage() {
  const { data: status } = useAibot()
  const now = useNow(60_000)
  const daily = status?.state === 'ready' ? status.dailyFree : null
  if (status === undefined || daily === null) return null
  const used = Math.min(daily.limit, Math.max(0, daily.limit - daily.remaining))
  const ratio = daily.limit === 0 ? 1 : used / daily.limit
  return (
    <section className="pod-card pod-aibot-usage">
      <div className="pod-aibot-numbers">
        <span>
          {t('今日剩余')} <strong>{daily.remaining}</strong> {t('次')}
        </span>
        <span className="pod-muted-inline">{resetText(status, now)}</span>
      </div>
      <div className={`pod-aibot-meter${ratio >= 0.9 ? ' pod-aibot-meter-low' : ''}`} role="meter" aria-label={t('今天用掉的 X 数据次数')} aria-valuemin={0} aria-valuemax={daily.limit} aria-valuenow={used}>
        <span style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <p className="pod-muted-inline">{t('每天免费 {limit} 次，读一次算一次，用你的 X 账号写一次算 4 次，监控不扣', { limit: daily.limit })}</p>
    </section>
  )
}
