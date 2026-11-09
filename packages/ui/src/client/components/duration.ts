import { t } from 'pod-domain'

/** 用了多久：一小时以内写分钟，再长写几小时几分。 */
export function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  return minutes < 60 ? t('{minutes} 分钟', { minutes }) : t('{floor} 小时 {value} 分', { floor: Math.floor(minutes / 60), value: minutes % 60 })
}

/** 干了多久：不到一分钟写「不到 1 分钟」，别的同 duration。 */
export function spent(ms: number): string {
  return ms < 60_000 ? t('不到 1 分钟') : duration(ms)
}
