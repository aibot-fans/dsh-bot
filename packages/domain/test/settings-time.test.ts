import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS, applySettingsPatch, normalizeSettings } from '../src/settings.ts'
import { inDailyRange, isDeepSeekPeak, localDate, nextDailyAt, wallClock, zonedTime } from '../src/time.ts'

test('设置：部分修改只改给了的项', () => {
  const result = applySettingsPatch(DEFAULT_SETTINGS, { autonomy: 'careful', taskConcurrency: 6 })
  assert.ok(result.ok)
  if (!result.ok) return
  assert.equal(result.value.autonomy, 'careful')
  assert.equal(result.value.taskConcurrency, 6)
  assert.equal(result.value.chatConcurrency, DEFAULT_SETTINGS.chatConcurrency)
})

test('设置：坏值被拒绝并说明原因', () => {
  const bad = applySettingsPatch(DEFAULT_SETTINGS, { timezone: 'Mars/Olympus' })
  assert.equal(bad.ok, false)
  const badClock = applySettingsPatch(DEFAULT_SETTINGS, { quietHours: { start: '25:00' } })
  assert.equal(badClock.ok, false)
  const unknown = applySettingsPatch(DEFAULT_SETTINGS, { nope: 1 })
  assert.equal(unknown.ok, false)
})

test('设置：读回时丢掉坏字段、补齐缺的字段', () => {
  const settings = normalizeSettings({ timezone: 'Asia/Tokyo', taskConcurrency: 'x', dailyBrief: { time: '07:00' } })
  assert.equal(settings.timezone, 'Asia/Tokyo')
  assert.equal(settings.taskConcurrency, DEFAULT_SETTINGS.taskConcurrency)
  assert.deepEqual(settings.dailyBrief, { enabled: true, time: '07:00' })
})

test('时区：钟表时间和时刻互换', () => {
  const time = Date.UTC(2026, 9, 23, 1, 30) // 北京时间 09:30
  const clock = wallClock(time, 'Asia/Shanghai')
  assert.deepEqual({ hour: clock.hour, minute: clock.minute, weekday: clock.weekday }, { hour: 9, minute: 30, weekday: 5 })
  assert.equal(zonedTime({ year: 2026, month: 10, day: 23, hour: 9, minute: 30 }, 'Asia/Shanghai'), time)
  assert.equal(localDate(time, 'Asia/Shanghai'), '2026-10-23')
})

test('时区：夏令时地区也能换算', () => {
  const time = zonedTime({ year: 2026, month: 7, day: 1, hour: 12, minute: 0 }, 'America/New_York')
  assert.equal(time, Date.UTC(2026, 6, 1, 16, 0))
})

test('每天的时段：跨午夜也算对', () => {
  const at = (hour: number): number => zonedTime({ year: 2026, month: 10, day: 23, hour, minute: 0 }, 'Asia/Shanghai')
  assert.equal(inDailyRange(at(23), 'Asia/Shanghai', '22:00', '08:00'), true)
  assert.equal(inDailyRange(at(3), 'Asia/Shanghai', '22:00', '08:00'), true)
  assert.equal(inDailyRange(at(12), 'Asia/Shanghai', '22:00', '08:00'), false)
})

test('DeepSeek 高峰：工作日上午和下午', () => {
  const at = (day: number, hour: number): number => zonedTime({ year: 2026, month: 10, day, hour, minute: 10 }, 'Asia/Shanghai')
  assert.equal(isDeepSeekPeak(at(23, 10)), true) // 周五 10:10
  assert.equal(isDeepSeekPeak(at(23, 13)), false) // 午休
  assert.equal(isDeepSeekPeak(at(24, 10)), false) // 周六
})

test('下一次每日时刻严格晚于当前', () => {
  const now = zonedTime({ year: 2026, month: 10, day: 23, hour: 9, minute: 0 }, 'Asia/Shanghai')
  const next = nextDailyAt(now, 'Asia/Shanghai', '08:30')
  assert.equal(next, zonedTime({ year: 2026, month: 10, day: 24, hour: 8, minute: 30 }, 'Asia/Shanghai'))
  assert.equal(nextDailyAt(now, 'Asia/Shanghai', '09:30'), now + 30 * 60_000)
})
