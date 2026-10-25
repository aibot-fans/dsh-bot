import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SECRET_PLACEHOLDER, classifySensitiveFill, containsSecret, maskSecrets } from '../src/secrets.ts'

test('打码：常见密钥整段替换', () => {
  const result = maskSecrets('我的 key 是 sk-abcdefghijklmnop1234 记得用')
  assert.equal(result.text, `我的 key 是 ${SECRET_PLACEHOLDER} 记得用`)
  assert.deepEqual(result.kinds, ['api-key'])
})

test('打码：密码只打掉值，保留“密码：”字样', () => {
  const result = maskSecrets('邮箱 a@b.com 密码：hunter2go')
  assert.equal(result.text, `邮箱 a@b.com 密码：${SECRET_PLACEHOLDER}`)
  assert.ok(result.kinds.includes('password'))
})

test('打码：Bearer 令牌保留前缀', () => {
  const result = maskSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123')
  assert.match(result.text, /Bearer ‹已打码›/)
})

test('打码：JWT 和私钥', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
  assert.ok(containsSecret(`token ${jwt}`))
  const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----'
  assert.equal(maskSecrets(key).text, SECRET_PLACEHOLDER)
})

test('打码：普通文字不动', () => {
  const text = '帮我查一下 5 家竞品的定价，价格用人民币'
  assert.equal(maskSecrets(text).text, text)
  assert.equal(containsSecret(text), false)
})

test('填写检查：银行卡号（Luhn）和身份证号', () => {
  assert.equal(classifySensitiveFill('4111 1111 1111 1111'), 'card-number')
  assert.equal(classifySensitiveFill('4111 1111 1111 1112'), undefined)
  assert.equal(classifySensitiveFill('11010519491231002X'), 'id-number')
  assert.equal(classifySensitiveFill('110105194912310021'), undefined)
  assert.equal(classifySensitiveFill('北京市海淀区'), undefined)
})
