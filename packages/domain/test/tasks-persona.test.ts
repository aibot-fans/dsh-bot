import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Bot } from '../src/bots.ts'
import { botFolder, folderName, rootTaskFolder } from '../src/paths.ts'
import { composePersona } from '../src/persona.ts'
import { acceptanceProgress, checkAcceptance, isTerminal, newAcceptance, stagesFor } from '../src/tasks.ts'

const bot = (overrides: Partial<Bot> = {}): Bot => ({
  id: 'bot_abcdef123456',
  name: '研究员',
  role: 'member',
  title: '研究员',
  persona: '负责调研。',
  personaSource: 'user',
  avatar: '',
  capabilities: ['调研'],
  card: { duties: '查资料', strengths: '', notResponsible: '写代码', askWho: '' },
  model: null,
  toolProfile: 'research',
  temporary: false,
  createdAt: 0,
  updatedAt: 0,
  archivedAt: null,
  ...overrides,
})

test('验收项：勾选只改没勾过的，越界的忽略', () => {
  const items = newAcceptance(['A', 'B', 'C'])
  const once = checkAcceptance(items, [0, 5], 10)
  assert.deepEqual(acceptanceProgress(once), { done: 1, total: 3 })
  const twice = checkAcceptance(once, [0, 1], 20)
  assert.equal(twice[0]?.at, 10)
  assert.equal(twice[1]?.at, 20)
})

test('阶段：单个 bot 三段，团队五段', () => {
  assert.deepEqual(stagesFor('L1'), ['understand', 'execute', 'deliver'])
  assert.equal(stagesFor('L2').length, 5)
  assert.equal(isTerminal('stopped'), false)
  assert.equal(isTerminal('cancelled'), true)
})

test('目录名：去掉不安全字符，加 id 后缀', () => {
  assert.equal(folderName('竞品/定价:对比', 'task_1234abcd'), '竞品-定价-对比-abcd')
  assert.equal(folderName('', 'task_1234abcd'), 'abcd')
  assert.equal(botFolder({ id: 'bot_xyz9', name: '写手' }), 'bots/写手-xyz9')
  assert.equal(rootTaskFolder({ id: 'task_0001', title: '周报' }, { id: 'team_77aa', name: '资讯组' }), 'teams/资讯组-77aa/tasks/周报-0001')
})

test('人设：主管带组织方法和名册，任务会话带任务守则', () => {
  const lead = bot({ id: 'bot_lead', name: '主管', role: 'lead', title: '主管' })
  const member = bot()
  const leadPrompt = composePersona({ bot: lead, kind: 'chat', roster: [lead, member], workspaceRoot: '/w', folder: 'bots/主管', timezone: 'Asia/Shanghai', autonomy: 'hands-off' })
  assert.match(leadPrompt, /你是主管/)
  assert.match(leadPrompt, /研究员（研究员）|- 研究员/)
  const taskPrompt = composePersona({ bot: member, kind: 'task', roster: [lead, member], workspaceRoot: '/w', folder: 'tasks/x', timezone: 'Asia/Shanghai', autonomy: 'careful' })
  assert.match(taskPrompt, /complete_task/)
  assert.match(taskPrompt, /tasks\/x\//)
  assert.match(taskPrompt, /谨慎/)
  assert.doesNotMatch(taskPrompt, /你是主管，下面是你分派工作的方法/)
})

test('人设：群聊里的成员知道自己在群里、群里有谁，用 mention_member 点名；单聊不变', () => {
  const lead = bot({ id: 'bot_lead', name: '主管', role: 'lead', title: '主管' })
  const coder = bot({ id: 'bot_coder00000', name: '程序员', card: { duties: '写代码', strengths: '', notResponsible: '', askWho: '' } })
  const member = bot()
  const base = { roster: [lead, member, coder], workspaceRoot: '/w', folder: 'rooms/x', timezone: 'Asia/Shanghai', autonomy: 'hands-off' as const }
  const inGroup = composePersona({ ...base, bot: member, kind: 'chat', group: { title: '量化小组', members: [lead, member, coder] } })
  assert.match(inGroup, /群聊「量化小组」/)
  assert.match(inGroup, /程序员（写代码）/)
  assert.match(inGroup, /mention_member/)
  assert.doesNotMatch(inGroup, /你正在和用户单聊/)
  const leadInGroup = composePersona({ ...base, bot: lead, kind: 'chat', group: { title: '量化小组', members: [lead, member, coder] } })
  assert.match(leadInGroup, /你是主管，下面是你分派工作的方法/)
  assert.match(leadInGroup, /群里没 @ 谁的话由你来接/)
  const direct = composePersona({ ...base, bot: member, kind: 'chat' })
  assert.match(direct, /你正在和用户单聊/)
  assert.doesNotMatch(direct, /mention_member/)
})
