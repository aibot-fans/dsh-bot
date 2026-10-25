/**
 * 演示剧本（开发用，给 README 截图）：你让主管做「第三季度增长复盘」，主管组一个临时小组：
 * 数据研究员整理核心数据、增长分析师做留存分析（两块同时做），设计师等它们交了再做一页看板；
 * 主管当组长逐个验收，合并成一份复盘交付。数字都是编的示例数据。
 * 任务会话每一步停一会儿（decision.pause），任务卡上看得到进度一格一格往前走。
 */

import { browserDemo } from './demo-browser.js'

const TOPIC = '增长复盘'
const STEP_PAUSE = 3000
const REVIEW_PAUSE = 1500

const WEEKS = Array.from({ length: 13 }, (_, index) => `W${27 + index}`)
const NEW_USERS = [3.2, 3.3, 3.5, 3.4, 3.6, 3.7, 3.8, 3.9, 3.8, 4.0, 3.9, 4.2, 4.3]
const ACTIVE = [61.2, 62.0, 63.1, 64.4, 65.0, 66.3, 67.5, 68.2, 69.6, 70.8, 72.1, 73.4, 74.5]
const ACTIVE_Q2 = [55.6, 56.0, 56.7, 57.1, 57.9, 58.2, 58.8, 59.3, 59.7, 60.1, 60.4, 60.9, 61.2]
const CHANNELS = [
  { name: '自然搜索', share: 31, cost: null },
  { name: '内容投放', share: 24, cost: 21.4 },
  { name: '应用商店', share: 18, cost: 17.8 },
  { name: '信息流', share: 15, cost: 32.6 },
  { name: '老带新', share: 12, cost: 6.3 },
]
const COHORTS = [
  { month: '7 月', users: 15.0, day: 52, week: 39, month30: 21 },
  { month: '8 月', users: 16.3, day: 54, week: 41, month30: 23 },
  { month: '9 月', users: 17.3, day: 55, week: 43, month30: null },
]
const FUNNEL = [
  ['注册', 100],
  ['完成引导', 81],
  ['第一次建项目', 50],
  ['第一周邀请同事', 23],
]
const ASSUMPTION = '第三季度按 7 月 1 日到 9 月 30 日算，和第二季度同口径'
const NOT_YET = '9 月注册的用户还没满 30 天，次月留存没算'

const PLAN = {
  goal: '第三季度增长复盘',
  group_name: TOPIC,
  level: 'L2',
  deliverables: ['shared/第三季度增长复盘.md', '看板「第三季度增长复盘」'],
  assumptions: [{ id: 'a1', text: ASSUMPTION, affects: ['s1', 's2'] }],
  reasons: ['核心数据和留存互不依赖，两个人同时做；看板要用两边的结论，最后做'],
  conventions: ['人数用“万”，保留一位小数', '周次写 W27 到 W39', '每个数字写明来源表'],
  subtasks: [
    {
      id: 's1',
      title: '核心数据',
      brief: '整理第三季度增长复盘要用的核心数据：新增、活跃、付费和收入，按周列出，和第二季度对比。',
      kind: '分析',
      deliverable: 'Q3 核心数据.md',
      acceptance: ['新增、活跃、付费、收入四项都有', '按周列出 W27 到 W39', '每项都和第二季度对比'],
      owner: '数据研究员',
    },
    {
      id: 's2',
      title: '留存分析',
      brief: '做第三季度增长复盘的新用户留存：按注册月份算次日、次周、次月留存，找出流失最多的一步，给两条马上能做的建议。',
      kind: '分析',
      deliverable: '留存分析.md',
      acceptance: ['次日、次周、次月留存和第二季度对比', '找出流失最多的一步', '给出两条马上能做的建议'],
      owner: '增长分析师',
    },
    {
      id: 's3',
      title: '复盘看板',
      brief: '把第三季度增长复盘的核心数据和留存结论做成一页看板，结论放在最上面，周五例会投屏用。',
      kind: '设计',
      deliverable: '看板「第三季度增长复盘」',
      acceptance: ['一页看完四个核心指标', '有周活趋势、渠道和留存', '结论放在最上面'],
      dependsOn: ['s1', 's2'],
      owner: '设计师',
    },
  ],
  integration: { owner: '主管', method: '按任务约定合并两份结果，看板引用合并后的数字' },
  review: { owner: '主管', sampling: '每个数字核对来源表' },
}

function table(head, rows) {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n')
}

const CORE_FILE = 'Q3 核心数据.md'
const CORE_MD = [
  '# 第三季度核心数据',
  '',
  `口径：${ASSUMPTION}。人数单位“万”，保留一位小数。来源：增长数据表（示例数据）。`,
  '',
  table(
    ['指标', '第三季度', '第二季度', '变化'],
    [
      ['新增用户', '48.6 万', '41.2 万', '+18%'],
      ['周活跃（季末）', '74.5 万', '61.2 万', '+22%'],
      ['付费用户', '3.9 万', '3.4 万', '+15%'],
      ['付费率', '5.2%', '5.6%', '-0.4 个点'],
      ['收入', '612 万元', '498 万元', '+23%'],
    ],
  ),
  '',
  '## 每周',
  '',
  table(['周', '新增（万）', '周活跃（万）'], WEEKS.map((week, index) => [week, NEW_USERS[index].toFixed(1), ACTIVE[index].toFixed(1)])),
  '',
  '## 渠道',
  '',
  table(['渠道', '新增占比', '获客成本'], CHANNELS.map((item) => [item.name, `${item.share}%`, item.cost === null ? '—' : `${item.cost} 元`])),
  '',
  '信息流的获客成本最高，9 月比 7 月涨了 19%。',
  '',
].join('\n')

const RETENTION_FILE = '留存分析.md'
const RETENTION_MD = [
  '# 第三季度新用户留存',
  '',
  '按注册月份分组。来源：留存明细表（示例数据）。',
  '',
  table(
    ['注册月份', '新增（万）', '次日', '次周', '次月'],
    [...COHORTS.map((item) => [item.month, item.users.toFixed(1), `${item.day}%`, `${item.week}%`, item.month30 === null ? '还没满 30 天' : `${item.month30}%`]), ['第二季度', '41.2', '50%', '37%', '20%']],
  ),
  '',
  '## 流失最多的一步',
  '',
  table(['步骤', '还剩'], FUNNEL.map(([step, left]) => [step, `${left}%`])),
  '',
  '完成引导以后、第一次建项目之前走掉的最多：81% 到 50%，这一步流失 38%。',
  '',
  '## 两条马上能做的建议',
  '',
  '1. 引导最后一步直接给 3 个模板，选一个就建好第一个项目。',
  '2. 注册第二天还没建项目的，发一条带模板链接的提醒。',
  '',
].join('\n')

const SUMMARY_LINES = [
  '- 新增用户 48.6 万，比第二季度多 18%；收入 612 万元，多 23%',
  '- 新用户次周留存 41%，比第二季度高 4 个点；流失最多的是“第一次建项目”，这一步走掉 38%',
  '- 信息流的获客成本最高（32.6 元），9 月比 7 月涨了 19%，建议先压信息流预算',
  '- 看板「第三季度增长复盘」做好了，点页面卡片打开',
]

const SUBTASKS = {
  核心数据: {
    start: '正在整理 7 月到 9 月的新增、活跃、付费和收入',
    file: CORE_FILE,
    body: CORE_MD,
    checked: '四项数据按周列好了，和第二季度对过',
    result: {
      summary: [
        '- 新增用户 48.6 万，比第二季度多 18%',
        '- 周活跃从 61.2 万涨到 74.5 万',
        '- 付费用户 3.9 万，付费率 5.2%（略降）；收入 612 万元，多 23%',
        '- 信息流的获客成本最高，32.6 元',
      ].join('\n'),
      assumptions: [ASSUMPTION],
      unverified: [],
    },
  },
  留存分析: {
    start: '正在按注册月份分组算留存',
    file: RETENTION_FILE,
    body: RETENTION_MD,
    checked: '三个月的留存算好了，流失最多的一步也找到了',
    result: {
      summary: ['- 次周留存 41%，比第二季度高 4 个点；次月 22%', '- 流失最多的是“第一次建项目”：完成引导后这一步走掉 38%', '- 两条建议：引导里直接给模板；第二天还没建项目的发提醒'].join('\n'),
      assumptions: [ASSUMPTION],
      unverified: [NOT_YET],
    },
  },
}

const DASHBOARD = {
  title: '第三季度增长复盘',
  kind: 'dashboard',
  note: '第一版',
  subtitle: '7 月 1 日到 9 月 30 日 · 示例数据',
  blocks: [
    { type: 'callout', tone: 'info', title: '结论', text: '新增和收入都是新高；次周留存比上季度高 4 个点。最大的流失在“第一次建项目”，信息流的获客成本在涨。' },
    {
      type: 'metrics',
      items: [
        { label: '新增用户', value: '48.6', unit: '万', delta: '+18%', trend: NEW_USERS },
        { label: '周活跃', value: '74.5', unit: '万', delta: '+22%', trend: ACTIVE },
        { label: '付费用户', value: '3.9', unit: '万', delta: '+15%', note: '付费率 5.2%' },
        { label: '收入', value: '612', unit: '万元', delta: '+23%' },
      ],
    },
    { type: 'chart', chart: 'line', title: '每周活跃用户', width: 'two-thirds', labels: WEEKS, unit: '万', series: [{ name: '第三季度', values: ACTIVE }, { name: '第二季度', values: ACTIVE_Q2 }] },
    { type: 'chart', chart: 'pie', title: '新增用户来源', width: 'third', labels: CHANNELS.map((item) => item.name), values: CHANNELS.map((item) => item.share), unit: '%' },
    {
      type: 'chart',
      chart: 'bar',
      title: '各渠道获客成本',
      width: 'half',
      labels: CHANNELS.filter((item) => item.cost !== null).map((item) => item.name),
      values: CHANNELS.filter((item) => item.cost !== null).map((item) => item.cost),
      unit: '元',
    },
    {
      type: 'table',
      title: '新用户留存',
      width: 'half',
      columns: [{ label: '注册月份' }, { label: '新增（万）', type: 'number' }, { label: '次日', type: 'percent' }, { label: '次周', type: 'percent' }, { label: '次月', type: 'percent' }],
      rows: [...COHORTS.map((item) => [item.month, item.users, item.day, item.week, item.month30]), ['第二季度', 41.2, 50, 37, 20]],
      note: NOT_YET,
    },
    {
      type: 'list',
      style: 'check',
      items: [
        { text: '引导最后一步直接给 3 个模板，选一个就建好第一个项目', done: false },
        { text: '注册第二天还没建项目的，发一条带模板链接的提醒', done: false },
        { text: '信息流预算先压 20%，看两周获客成本', done: false },
      ],
    },
  ],
}

function step(tool, args, pause = STEP_PAUSE) {
  return { tool, args, pause }
}

/** 系统提示里的工作区根目录；任务说明里的任务文件夹（绝对路径）。 */
function workspaceRoot(system) {
  return /工作区根目录是 (.+?)。这条会话的文件夹是/.exec(system)?.[1] ?? ''
}

function relative(root, path) {
  return root !== '' && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

/** 任务会话：先写一句进度，再写文件（或做页面），勾上验收项，最后提交。 */
function executor({ system, brief, calls, tools, last }) {
  const title = /任务：(\S+)/.exec(brief)?.[1] ?? ''
  const folder = /任务文件夹：(.+?)\/（/.exec(brief)?.[1] ?? ''
  const root = workspaceRoot(system)
  if (last?.role === 'tool' && calls.at(-1) === 'complete_task') return { text: '已经提交了。' }
  const updates = calls.filter((name) => name === 'update_task').length

  if (title === '复盘看板') {
    if (updates === 0) return step('update_task', { note: '正在读两份上游结果，挑看板上要放的数字' })
    if (!calls.includes('save_page') && tools.has('save_page')) return step('save_page', DASHBOARD)
    if (updates === 1) return step('update_task', { check: [1, 2, 3], note: '看板做好了，结论放在最上面' })
    return step('complete_task', {
      summary: '- 做好了一页看板「第三季度增长复盘」：结论、四个核心指标、周活趋势、渠道占比和获客成本、留存表、下一步\n- 投屏和导出 PDF 都按 16:9 排过',
      files: [],
      assumptions: ['数字都取自核心数据和留存分析两份结果'],
      unverified: [],
      skipped: [],
    })
  }

  const plan = SUBTASKS[title]
  if (plan === undefined) return undefined
  const path = `${folder}/${plan.file}`
  if (updates === 0) return step('update_task', { check: [1], note: plan.start })
  if (!calls.includes('write') && tools.has('write') && folder !== '') return step('write', { file_path: path, content: plan.body })
  if (updates === 1) return step('update_task', { check: [2, 3], note: plan.checked })
  return step('complete_task', { ...plan.result, files: [relative(root, path)], skipped: [] })
}

/** 组长：逐个验收，全部通过后合并成一份复盘放进 shared/，再交付。 */
function coordinator({ system, userText, messages, calls, tools, last }) {
  if (last?.role === 'tool' && (calls.at(-1) === 'review_task' || calls.at(-1) === 'deliver_task')) return { text: '好。' }
  if (userText.includes('[子任务提交]')) {
    const key = /（(s\d+)，负责人/.exec(userText)?.[1] ?? 's1'
    return step('review_task', { subtask: key, pass: true, feedback: '数字和来源表对上了' }, REVIEW_PAUSE)
  }
  if (!userText.includes('[全部子任务已通过]')) return undefined
  const root = workspaceRoot(system)
  const files = [...new Set([...JSON.stringify(messages).matchAll(/文件：([^\\"]+?\.md)/g)].map((match) => match[1]))]
  const merged = `${root}/shared/第三季度增长复盘.md`
  if (!calls.includes('write') && tools.has('write') && root !== '') {
    const body = ['# 第三季度增长复盘', '', '示例数据。', '', '## 要点', '', ...SUMMARY_LINES.slice(0, 3), '', '---', '', CORE_MD.replace(/^# .*\n/, '## 核心数据\n'), RETENTION_MD.replace(/^# .*\n/, '## 新用户留存\n')].join('\n')
    return step('write', { file_path: merged, content: body }, REVIEW_PAUSE)
  }
  return step(
    'deliver_task',
    {
      summary: SUMMARY_LINES.join('\n'),
      files: [relative(root, merged), ...files.filter((file) => !file.startsWith('shared/'))],
      assumptions: [ASSUMPTION],
      unverified: [NOT_YET],
      skipped: [],
    },
    REVIEW_PAUSE,
  )
}

/** 主管：收到“增长复盘”就组队；组好以后用一句话说明分工。 */
function lead({ userText, calls, tools, last, result }) {
  if (!userText.includes(TOPIC)) return undefined
  if (last?.role === 'tool' && calls.at(-1) === 'create_task') {
    if (result?.ok === false) return { text: `没组成：${result.message ?? ''}` }
    return { text: '分成三块，组了个临时小组：数据研究员整理核心数据，增长分析师做留存分析，这两块同时做；设计师等它们交了再做看板。我当组长，逐个验收后合并交付，进度在「增长复盘」群里看。' }
  }
  if (tools.has('create_task') && !calls.includes('create_task')) return step('create_task', PLAN, 800)
  return undefined
}

/**
 * 是演示就返回这一步做什么（可能带 pause：先停多少毫秒），不是返回 undefined。
 * context：system、messages、brief（任务说明）、userText、calls、tools、last、result（最后一个工具结果）、
 * page（最近一次带页面内容的工具结果）。浏览器那段剧本在 demo-browser.js。
 */
export function demoDecision(context) {
  const { system, messages, brief } = context
  const browsing = browserDemo(context)
  if (browsing !== undefined) return browsing
  if (system.includes('你正在执行一个任务')) return brief.includes(TOPIC) ? executor(context) : undefined
  if (system.includes('你是这个根任务的组长')) return JSON.stringify(messages).includes(TOPIC) ? coordinator(context) : undefined
  if (system.includes('你是主管')) return lead(context)
  return undefined
}
