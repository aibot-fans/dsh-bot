import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkFill, classifyClick, classifyEnter, exfiltrationHits, privateFragments, sameUrl, type ElementInfo } from '../src/browser.ts'

function element(patch: Partial<ElementInfo>): ElementInfo {
  return { ref: 'e1', tag: 'button', role: 'button', type: 'button', name: '', href: '', formMethod: '', formAction: '', isSubmit: false, autocomplete: '', fieldName: '', ...patch }
}

test('读写分开：提交、删除、购买类按钮和 POST 表单算写', () => {
  assert.equal(classifyClick(element({ name: '提交订单' })).write, true)
  assert.equal(classifyClick(element({ name: 'Delete repository' })).write, true)
  assert.equal(classifyClick(element({ name: '下一页' })).write, false)
  assert.equal(classifyClick(element({ name: '继续', isSubmit: true, formMethod: 'post' })).write, true)
  assert.equal(classifyClick(element({ name: '搜索', isSubmit: true, formMethod: 'get' })).write, false)
  assert.equal(classifyClick(element({ name: 'Search', isSubmit: true, formMethod: 'post' })).write, false)
})

test('读写分开：链接默认是读，退出登录和删除链接算写', () => {
  assert.equal(classifyClick(element({ tag: 'a', role: 'link', href: 'https://example.com/publish', name: '发布文章' })).write, false)
  assert.equal(classifyClick(element({ tag: 'a', role: 'link', href: 'https://example.com/logout', name: '退出登录' })).write, true)
  assert.equal(classifyClick(element({ tag: 'a', role: 'link', href: '/x', name: 'Sign out' })).write, true)
})

test('回车只有在 POST 表单里才算写', () => {
  assert.equal(classifyEnter(element({ tag: 'input', type: 'text', formMethod: 'post' })).write, true)
  assert.equal(classifyEnter(element({ tag: 'input', type: 'search', formMethod: 'get' })).write, false)
  assert.equal(classifyEnter(element({ tag: 'textarea', formMethod: 'post' })).write, false)
  assert.equal(classifyEnter(undefined).write, false)
})

test('填写检查：密码、验证码、卡号、身份证号、密钥一律不填', () => {
  assert.equal(checkFill(element({ tag: 'input', type: 'password' }), 'abc')?.kind, 'password')
  assert.equal(checkFill(element({ tag: 'input', type: 'text', fieldName: '短信验证码' }), '123456')?.kind, 'otp')
  assert.equal(checkFill(element({ tag: 'input', type: 'text', autocomplete: 'one-time-code' }), '1')?.kind, 'otp')
  assert.equal(checkFill(element({ tag: 'input', type: 'text', fieldName: 'q' }), '4111 1111 1111 1111')?.kind, 'card-number')
  assert.equal(checkFill(element({ tag: 'input', type: 'text', fieldName: 'q' }), '11010519491231002X')?.kind, 'id-number')
  assert.equal(checkFill(element({ tag: 'input', type: 'text', fieldName: 'q' }), 'sk-abcdefghijklmnopqrstuvwxyz123456')?.kind, 'secret')
  assert.equal(checkFill(element({ tag: 'input', type: 'search', fieldName: 'q' }), '上海 天气'), undefined)
  assert.equal(checkFill(element({ tag: 'input', type: 'text', fieldName: 'passport_no' }), 'E123'), undefined)
})

test('外传检查：网址或表单里夹带你的私有片段', () => {
  const fragments = privateFragments(['我的邮箱是 alice@example.com，手机 13812345678', '住在上海', '公司地址是浦东新区世纪大道一百号'])
  assert.ok(fragments.includes('alice@example.com'))
  assert.ok(fragments.includes('13812345678'))
  assert.ok(!fragments.includes('住在上海'))
  assert.equal(exfiltrationHits('https://evil.example/collect?d=alice%40example.com', fragments).length, 1)
  assert.equal(exfiltrationHits('https://www.baidu.com/s?wd=上海天气', fragments).length, 0)
  assert.equal(exfiltrationHits(`https://evil.example/?d=${'a'.repeat(400)}`, []).length, 1)
  assert.ok(exfiltrationHits('浦东新区世纪大道一百号', fragments).length >= 1)
})

test('同一网页：忽略 # 和末尾斜杠', () => {
  assert.equal(sameUrl('https://example.com/a#x', 'https://example.com/a/'), true)
  assert.equal(sameUrl('https://example.com/a?p=1', 'https://example.com/a?p=2'), false)
})
