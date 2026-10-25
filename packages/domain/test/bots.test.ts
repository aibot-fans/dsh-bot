import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeConfigChange, validateDraft, validatePatch, type BotConfig } from '../src/bots.ts'

test('新建：必填项和默认值', () => {
  const missing = validateDraft({ name: '', persona: 'x' })
  assert.equal(missing.ok, false)
  const created = validateDraft({ name: ' 研究员 ', persona: '负责调研', capabilities: ['调研', '调研', ' 写作 '] })
  assert.ok(created.ok)
  if (!created.ok) return
  assert.equal(created.value.name, '研究员')
  assert.equal(created.value.title, '')
  assert.deepEqual(created.value.capabilities, ['调研', '写作'])
})

test('修改：只带给了的字段，模型可以清空成跟随', () => {
  const patch = validatePatch({ model: null, toolProfile: 'research' })
  assert.ok(patch.ok)
  if (!patch.ok) return
  assert.deepEqual(patch.value, { model: null, toolProfile: 'research' })
  assert.equal(validatePatch({ toolProfile: 'root' }).ok, false)
  assert.equal(validatePatch({ model: { provider: 'deepseek' } }).ok, false)
})

test('配置差异：列出改了哪些项', () => {
  const base: BotConfig = {
    name: 'A',
    title: '',
    persona: 'p',
    avatar: '',
    capabilities: [],
    card: { duties: '', strengths: '', notResponsible: '', askWho: '' },
    model: null,
    toolProfile: 'exec',
    temporary: false,
  }
  assert.deepEqual(describeConfigChange(base, { ...base, persona: 'q', toolProfile: 'talk' }), ['人设', '工具档案'])
  assert.deepEqual(describeConfigChange(base, base), [])
})
