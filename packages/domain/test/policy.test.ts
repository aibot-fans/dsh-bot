import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SITE_RULES, checkUrl, isPrivateHost, siteModeFor } from '../src/policy.ts'

test('网络防护：本机、局域网和 file:// 默认拦下', () => {
  assert.equal(checkUrl('http://localhost:3080/api').ok, false)
  assert.equal(checkUrl('http://127.0.0.1:3080').ok, false)
  assert.equal(checkUrl('http://192.168.1.5').ok, false)
  assert.equal(checkUrl('http://[::1]:8080').ok, false)
  assert.equal(checkUrl('file:///etc/passwd').ok, false)
  assert.equal(checkUrl('https://user:pw@example.com').ok, false)
  assert.equal(checkUrl('example.com/pricing').ok, true)
  assert.equal(checkUrl('http://localhost:5173', ['localhost:5173']).ok, true)
  assert.equal(isPrivateHost('router.lan'), true)
  assert.equal(isPrivateHost('www.deepseek.com'), false)
})

test('站点规则：最具体的匹配优先，默认写操作需审批', () => {
  assert.equal(siteModeFor('www.alipay.com', DEFAULT_SITE_RULES).mode, 'blocked')
  assert.equal(siteModeFor('alipay.com', DEFAULT_SITE_RULES).mode, 'blocked')
  assert.equal(siteModeFor('example.com', DEFAULT_SITE_RULES).mode, 'approve-writes')
  const custom = [...DEFAULT_SITE_RULES, { pattern: 'mail.qq.com', mode: 'read-only' as const, note: '你改的' }, { pattern: '*.qq.com', mode: 'free' as const, note: '' }]
  assert.equal(siteModeFor('mail.qq.com', custom).mode, 'blocked')
  assert.equal(siteModeFor('news.qq.com', custom).mode, 'free')
})
