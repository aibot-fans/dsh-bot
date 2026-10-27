import { beijingClock, intlLocale, t, type AibotStatus } from 'pod-domain'
import { clock } from '../../components/common.tsx'

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })

/** 北京时间的“今早 / 明早 / 10月26日”。 */
function dayWord(at: number, now: number): string {
  const target = DAY.format(new Date(at))
  const morning = Number(beijingClock(at).slice(0, 2)) < 12
  if (target === DAY.format(new Date(now))) return morning ? t('今早') : t('今天')
  if (target === DAY.format(new Date(now + 86_400_000))) return morning ? t('明早') : t('明天')
  return new Date(at).toLocaleDateString(intlLocale(), { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric' })
}

/** 设置页那一行：「aibot · 已开通（免登录）· 今日剩余 N 次」；没开通好时说现在怎样。 */
export function aibotLine(status: AibotStatus): string {
  if (status.state === 'off') return t('aibot · 已关闭')
  if (status.state === 'starting') return t('aibot · 正在开通…')
  if (status.state === 'disabled') return status.message
  if (status.state !== 'ready') return `aibot · ${status.message}`
  const who = status.accountKind === 'account' ? t('已绑定 {value}', { value: status.accountDisplay ?? t('账号') }) : t('已开通（免登录）')
  return status.dailyFree === null ? `aibot · ${who}` : t('aibot · {who} · 今日剩余 {remaining} 次', { who, remaining: status.dailyFree.remaining })
}

/** 免费次数什么时候恢复，按北京时间说：「明早 08:00 恢复」。 */
export function resetText(status: AibotStatus, now: number): string {
  const at = status.dailyFree?.resetAt ?? null
  return at === null ? t('每天早上 8 点（北京时间）恢复') : t('{dayWord} {beijingClock} 恢复（北京时间）', { dayWord: dayWord(at, now), beijingClock: beijingClock(at) })
}

/** 等着自动重试时补一句什么时候再试。 */
export function retryText(status: AibotStatus): string {
  return status.retryAt === null ? '' : t('，{clock} 自动再试', { clock: clock(status.retryAt) })
}
