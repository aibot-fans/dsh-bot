import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dailyCron, describeCron, nextCronRun, parseCron, weeklyCron } from '../src/cron.ts'
import { wallClock, zonedTime } from '../src/time.ts'

const TZ = 'Asia/Shanghai'
const at = (day: number, hour: number, minute: number): number => zonedTime({ year: 2026, month: 10, day, hour, minute }, TZ)

function next(expression: string, after: number, timeZone = TZ): number | undefined {
  const schedule = parseCron(expression)
  assert.notEqual(typeof schedule, 'string', String(schedule))
  if (typeof schedule === 'string') return undefined
  return nextCronRun(schedule, after, timeZone)
}

test('cron：格式不对时说明原因', () => {
  assert.equal(typeof parseCron('* * *'), 'string')
  assert.equal(typeof parseCron('61 * * * *'), 'string')
  assert.equal(typeof parseCron('*/0 * * * *'), 'string')
  assert.equal(typeof parseCron('5-1 * * * *'), 'string')
})

test('cron：每天 8:30，严格晚于当前时刻', () => {
  assert.equal(next(dailyCron('08:30'), at(23, 9, 0)), at(24, 8, 30))
  assert.equal(next(dailyCron('08:30'), at(23, 8, 0)), at(23, 8, 30))
  assert.equal(next(dailyCron('08:30'), at(23, 8, 30)), at(24, 8, 30))
})

test('cron：步长、范围和工作日', () => {
  assert.equal(next('*/15 9-17 * * 1-5', at(23, 9, 1)), at(23, 9, 15))
  // 2026-10-23 是周五，下一个工作日早上 9 点是周一 26 日
  assert.equal(next('0 9 * * 1-5', at(23, 10, 0)), at(26, 9, 0))
  assert.equal(next(weeklyCron('09:00', [7]), at(23, 10, 0)), at(25, 9, 0))
})

test('cron：日和周都指定时满足任一即可', () => {
  // 每月 1 号或者每周一
  assert.equal(next('0 8 1 * 1', at(23, 10, 0)), at(26, 8, 0))
})

test('cron：按时区求值', () => {
  const time = next('0 9 * * *', Date.UTC(2026, 9, 23, 0, 0), 'America/New_York')
  assert.ok(time !== undefined)
  const clock = wallClock(time ?? 0, 'America/New_York')
  assert.deepEqual({ hour: clock.hour, minute: clock.minute }, { hour: 9, minute: 0 })
})

test('cron：中文说明', () => {
  assert.equal(describeCron('30 8 * * *'), '每天 08:30')
  assert.equal(describeCron('0 9 * * 1,3'), '每周一、三 09:00')
})
