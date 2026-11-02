import { t } from 'pod-domain'

/** 用了多久：一小时以内写分钟，再长写几小时几分。 */
export function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  return minutes < 60 ? t('{minutes} 分钟', { minutes }) : t('{floor} 小时 {value} 分', { floor: Math.floor(minutes / 60), value: minutes % 60 })
}

/** 今天的只写钟点，别的天带上月日。 */
export function stamp(time: number): string {
  const date = new Date(time)
  const today = new Date()
  const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return sameDay ? clock : `${date.getMonth() + 1}/${date.getDate()} ${clock}`
}
