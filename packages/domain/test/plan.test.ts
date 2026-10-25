import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Bot } from '../src/bots.ts'
import { affectedByAssumption, findCycle, intersectProfiles, parsePlan, readySubtasks, validatePlan } from '../src/plan.ts'
import { MIN_GOOD_SCORE, scoreAssignment } from '../src/scoring.ts'

const profiles: Readonly<Record<string, 'talk' | 'research' | 'exec'>> = { 研究员: 'research', 工程师: 'exec', 主持: 'talk' }
const context = { profileOf: (owner: string) => profiles[owner] }

const basePlan = {
  goal: '弄清 5 家竞品怎么收费',
  level: 'L2',
  assumptions: [{ id: 'a1', text: '只看中国区', affects: ['s1', 's2'] }],
  conventions: ['价格统一用人民币'],
  subtasks: [
    { id: 's1', title: 'A 公司', deliverable: 'A.md', acceptance: ['月付', '年付'], owner: '研究员' },
    { id: 's2', title: 'B 公司', deliverable: 'B.md', acceptance: ['月付'], owner: 'd1' },
    { id: 's3', title: '汇总', deliverable: 'shared/对比.md', acceptance: ['表格'], dependsOn: ['s1', 's2'], owner: '研究员' },
  ],
  drafts: [{ draftId: 'd1', name: '分析师', persona: '负责分析', toolProfile: 'research' }],
}

test('计划：合法的计划没有问题', () => {
  assert.deepEqual(validatePlan(parsePlan(basePlan), context), [])
})

test('计划：缺交付物、负责人不存在、依赖不存在都会报出来', () => {
  const plan = parsePlan({
    ...basePlan,
    subtasks: [
      { id: 's1', title: 'A', deliverable: '', acceptance: ['x'], owner: '路人' },
      { id: 's2', title: 'B', deliverable: 'b', acceptance: [], dependsOn: ['s9'], owner: '研究员' },
    ],
  })
  const problems = validatePlan(plan, context)
  assert.ok(problems.some((line) => line.includes('缺少交付物')))
  assert.ok(problems.some((line) => line.includes('「路人」不存在')))
  assert.ok(problems.some((line) => line.includes('「s9」不存在')))
  assert.ok(problems.some((line) => line.includes('至少要有一条验收项')))
})

test('计划：工具档案不够、依赖有环', () => {
  const plan = parsePlan({
    ...basePlan,
    subtasks: [
      { id: 's1', title: 'A', deliverable: 'a', acceptance: ['x'], owner: '主持', needs: { shell: true }, dependsOn: ['s2'] },
      { id: 's2', title: 'B', deliverable: 'b', acceptance: ['x'], owner: '工程师', dependsOn: ['s1'] },
    ],
  })
  const problems = validatePlan(plan, context)
  assert.ok(problems.some((line) => line.includes('工具档案不够')))
  assert.ok(problems.some((line) => line.includes('有环')))
  assert.notEqual(findCycle(plan.subtasks), undefined)
})

test('调度：依赖都完成了才能开工', () => {
  const plan = parsePlan(basePlan)
  assert.deepEqual(readySubtasks(plan.subtasks, new Set(), new Set()), ['s1', 's2'])
  assert.deepEqual(readySubtasks(plan.subtasks, new Set(['s1']), new Set(['s1', 's2'])), [])
  assert.deepEqual(readySubtasks(plan.subtasks, new Set(['s1', 's2']), new Set(['s1', 's2'])), ['s3'])
})

test('前提被纠正：重做挂在它上面的子任务和下游', () => {
  assert.deepEqual(affectedByAssumption(parsePlan(basePlan), 'a1'), ['s1', 's2', 's3'])
})

test('权限取交集：派活不能放大权限', () => {
  assert.equal(intersectProfiles('exec', 'research'), 'research')
  assert.equal(intersectProfiles('talk', 'exec'), 'talk')
})

test('分配打分：能力对得上的分高，档案不够的不合格', () => {
  const bot = (name: string, capabilities: string[], toolProfile: 'talk' | 'research' | 'exec'): Bot => ({
    id: `bot_${name}`, name, role: 'member', title: name, persona: '', personaSource: 'user', avatar: '', capabilities,
    card: { duties: '', strengths: '', notResponsible: '', askWho: '' }, model: null, toolProfile, temporary: false, createdAt: 0, updatedAt: 0, archivedAt: null,
  })
  const input = { kind: '调研', title: '查 A 公司定价', brief: '调研官网价格', needs: { browser: true, shell: false } }
  const good = scoreAssignment(bot('研究员', ['调研', '信息检索'], 'research'), input, { load: 0, continuity: false })
  const weak = scoreAssignment(bot('写手', ['写作'], 'research'), input, { load: 3, continuity: false })
  const blocked = scoreAssignment(bot('主持', ['调研'], 'talk'), input, { load: 0, continuity: false })
  assert.ok(good.score >= MIN_GOOD_SCORE)
  assert.ok(weak.score < good.score)
  assert.equal(blocked.eligible, false)
  assert.equal(blocked.score, 0)
})
