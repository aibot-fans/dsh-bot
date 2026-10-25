import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assignBotIcons, guessBotIcon, isAvatarImage, pickBotIcon } from '../src/avatars.ts'
import { validatePatch } from '../src/bots.ts'
import { parsePlan } from '../src/plan.ts'
import { BOT_CALL_LIMIT, GROUP_NAME_MAX, botCallsSinceOwner, shortGroupName } from '../src/rooms.ts'

test('短群名：取第一个分句，去掉“帮我”这类开头，最多 8 个字', () => {
  assert.equal(shortGroupName('对比两家测试公司的定价'), '对比两家测试公司')
  assert.equal(shortGroupName('帮我写一篇博客，介绍新功能'), '写一篇博客')
  assert.equal(shortGroupName('请你整理上周数据。然后发我'), '整理上周数据')
  assert.equal([...shortGroupName('一二三四五六七八九十')].length, GROUP_NAME_MAX)
  assert.equal(shortGroupName('   '), '新群聊')
})

test('头像：小图标或上传的图片，其他的拒绝', () => {
  assert.ok(isAvatarImage('img:mvl80a2n-78f57831.png'))
  assert.ok(!isAvatarImage('img:../pod.db'))
  assert.ok(!isAvatarImage('img:a.svg'))
  assert.ok(validatePatch({ avatar: 'icon:writer' }).ok)
  assert.ok(validatePatch({ avatar: 'img:abc-123.webp' }).ok)
  assert.ok(validatePatch({ avatar: '' }).ok)
  assert.equal(validatePatch({ avatar: '写' }).ok, false)
  assert.equal(validatePatch({ avatar: 'icon:robot' }).ok, false)
  assert.equal(validatePatch({ avatar: 'img:abc.svg' }).ok, false)
})

test('内置图标：按名字、角色和能力标签配，一起配时尽量不重样；看不出定位的用万能助手', () => {
  const member = (id: string, name: string, title: string, capabilities: readonly string[]) => ({ id, role: 'member' as const, name, title, capabilities })
  assert.equal(guessBotIcon({ role: 'lead', name: '主管' }), 'lead')
  assert.equal(guessBotIcon({ role: 'member', name: '写手', title: '博客写手' }), 'writer')
  assert.equal(guessBotIcon({ role: 'member', name: '小明' }), 'member')
  assert.equal(guessBotIcon({ role: 'member', name: '翻译' }), 'translator')
  assert.equal(guessBotIcon({ role: 'member', name: '监控播报' }), 'broadcast')
  assert.equal(guessBotIcon({ role: 'member', name: '数据分析师' }), 'data')
  assert.equal(guessBotIcon({ role: 'member', name: '运维工程师' }), 'devops')
  assert.equal(guessBotIcon({ role: 'member', name: '小助手', card: { duties: '帮我排日程、记待办', strengths: '' } }), 'assistant')
  const icons = assignBotIcons(
    [
      member('a', '因子研究员', '量化研究员', ['量化研究', '文献与资料梳理']),
      member('b', '数据工程师', 'A股数据工程师', ['Python环境', '数据获取', '数据清洗']),
      member('c', '回测工程师', '回测与实现工程师', ['Python回测', '绩效分析', '可视化']),
      member('d', '策略评审', '策略与风控评审', ['过拟合检验', '回测审查']),
      member('e', '程序员', '程序员', ['写代码', 'Code Review', '测试', '重构']),
    ],
    new Set(['writer'] as const),
  )
  assert.deepEqual(Object.fromEntries(icons), { a: 'researcher', b: 'data', c: 'engineer', d: 'tester', e: 'coder' })
  assert.equal(pickBotIcon({ role: 'member', name: '文案' }, new Set(['writer'] as const)), 'member')
  assert.equal(pickBotIcon({ role: 'member', name: '文案' }, new Set(['writer', 'member'] as const)), 'writer')
})

test('团队计划带上主管起的群名', () => {
  assert.equal(parsePlan({ goal: '对比定价', group_name: '竞品定价', subtasks: [] }).name, '竞品定价')
  assert.equal(parsePlan({ goal: '对比定价', subtasks: [] }).name, '')
})

test('bot 之间的点名：只数你上一句话之后 bot 发的 calls，你自己的 @ 不算', () => {
  const said = (author: string, calls?: readonly string[]) => ({ author, data: calls === undefined ? {} : { calls } })
  assert.equal(botCallsSinceOwner([]), 0)
  assert.equal(botCallsSinceOwner([said('bot_a', ['bot_b']), said('owner', ['bot_a']), said('bot_a', ['bot_b', 'bot_c']), said('bot_b'), said('bot_c', ['bot_a'])]), 3)
  assert.equal(botCallsSinceOwner([said('bot_a', ['bot_b']), said('owner')]), 0)
  assert.equal(botCallsSinceOwner([said('owner'), said('pod', ['bot_a'])]), 0)
  assert.ok(BOT_CALL_LIMIT >= 4)
})
