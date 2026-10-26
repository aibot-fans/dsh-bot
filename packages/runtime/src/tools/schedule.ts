import { EVERY_MIN_MINUTES, dailyCron, everyCron, weeklyCron } from 'pod-domain'
import type { JsonSchema } from '../dsh.ts'
import { int, intList, str, text } from './define.ts'

const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** 只跑一次最远能约到多久以后（分钟）：一周。 */
const LATER_MAX = 7 * 24 * 60

/** 例程服务认的时间写法：cron 是重复，at 和 runAt 是只跑一次。 */
export type Schedule = { readonly cron: string } | { readonly at: string } | { readonly runAt: number }

/** 新建和修改例程共用的时间参数：几种写法只能写一种。 */
export const SCHEDULE_PROPS: Readonly<Record<string, JsonSchema>> = {
  time: str('每天几点，HH:MM；配 weekdays 是每周几'),
  weekdays: intList('每周哪几天，1=周一…7=周日（和 time 一起写）'),
  every_minutes: int(`每隔多少分钟一次，从整点算起：${EVERY_MIN_MINUTES}、10、15、20、30，或者能整除一天的整小时（60、120、180、240、360、480、720、1440）`),
  cron: str('五段式 cron（分 时 日 月 周），上面几种写不出的时间表用它'),
  at: str('只跑一次：HH:MM（今天，过了就是明天）或 YYYY-MM-DD HH:MM'),
  in_minutes: int('只跑一次：多少分钟以后'),
}

/** 读工具参数里的时间：都没写返回 undefined，写了不止一种或者写错了返回说明。 */
export function readSchedule(args: Readonly<Record<string, unknown>>, now: number): Schedule | string | undefined {
  const time = text(args, 'time')
  const cron = text(args, 'cron')
  const at = text(args, 'at')
  const every = typeof args.every_minutes === 'number' ? args.every_minutes : undefined
  const later = typeof args.in_minutes === 'number' ? args.in_minutes : undefined
  const weekdays = Array.isArray(args.weekdays) ? args.weekdays.filter((day): day is number => typeof day === 'number' && day >= 1 && day <= 7) : []
  const given = [time !== '' || weekdays.length > 0, cron !== '', every !== undefined, at !== '', later !== undefined].filter(Boolean).length
  if (given === 0) return undefined
  if (given > 1) return 'time（加 weekdays）、every_minutes、cron、at、in_minutes 只能写一种'
  if (cron !== '') return { cron }
  if (at !== '') return { at }
  if (later !== undefined) return Number.isInteger(later) && later >= 1 && later <= LATER_MAX ? { runAt: now + later * 60_000 } : `in_minutes 写 1 到 ${LATER_MAX} 之间的整数`
  if (every !== undefined) {
    const expression = everyCron(every)
    return expression === undefined ? `every_minutes 不能是 ${every}：要能整除一小时（最少 ${EVERY_MIN_MINUTES} 分钟），或者是能整除一天的整小时；别的间隔写 cron` : { cron: expression }
  }
  if (!CLOCK.test(time)) return 'time 写成 HH:MM'
  return { cron: weekdays.length > 0 ? weeklyCron(time, weekdays) : dailyCron(time) }
}
