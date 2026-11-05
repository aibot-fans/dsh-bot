/** 演示剧本的中文内容（数字都是编的示例数据），逻辑在 demo.js。 */

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

const DASHBOARD = {
  title: '第三季度增长看板',
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

const CORE = {
  title: '核心数据',
  bot: '数据研究员',
  brief: '整理第三季度的核心数据：新增、活跃、付费和收入，按周列出 W27 到 W39，和第二季度对比，每个数字写明来源表。',
  acceptance: ['新增、活跃、付费、收入四项都有', '按周列出 W27 到 W39', '每项都和第二季度对比'],
}

const RETENTION = {
  title: '留存分析',
  bot: '自己',
  brief: '按注册月份算第三季度新用户的次日、次周、次月留存，找出流失最多的一步，给两条马上能做的建议。',
  acceptance: ['次日、次周、次月留存和第二季度对比', '找出流失最多的一步', '给出两条马上能做的建议'],
}

const BOARD = {
  title: '复盘看板',
  bot: '设计师',
  brief: '把群里交的核心数据和留存分析做成一页看板，结论放在最上面，周五例会投屏用。',
  acceptance: ['一页看完四个核心指标', '有周活趋势、渠道和留存', '结论放在最上面'],
}

const ANSWER = [
  '第三季度（7 月 1 日到 9 月 30 日）的增长复盘做好了，和第二季度同口径比：',
  '',
  '- 新增用户 48.6 万，比第二季度多 18%；周活跃从 61.2 万涨到 74.5 万；收入 612 万元，多 23%',
  '- 付费用户 3.9 万，多 15%，付费率从 5.6% 降到 5.2%',
  '- 新用户次周留存 41%，高 4 个点；流失最多的是“第一次建项目”，完成引导以后这一步走掉 38%',
  '- 信息流的获客成本最高，32.6 元，9 月比 7 月涨了 19%',
  '',
  '建议先做三件事：引导最后一步直接给 3 个模板；注册第二天还没建项目的发一条提醒；信息流预算先压 20%，看两周获客成本。',
  '',
  `看板在上面，周五可以直接投屏。${NOT_YET}。`,
].join('\n')

export const DEMO_ZH = {
  /** 你在主对话里说的话、任务的交代和叫醒 Super-agent 的消息里有它，才按演示剧本走。 */
  matches: (text) => text.includes('增长复盘'),
  /** Super-agent：没有对口的群，按主题建「增长复盘」群交进去，组长交了回答再回主对话说结论。 */
  front: {
    think: '增长数据的活，还没有对口的群：建「增长复盘」群，增长分析师牵头。',
    dispatch: {
      title: '第三季度增长复盘',
      group: '增长复盘',
      bot: '增长分析师',
      members: ['数据研究员', '设计师'],
      about: '增长数据的复盘：核心指标、新用户留存和获客渠道',
      brief: '我的理解：要一份第三季度（7 月 1 日到 9 月 30 日）的增长复盘，和第二季度比。核心数据和新用户留存都要有，最后做成一页看板，周五例会上投屏用。先说结论，每个数字写明来源。',
    },
    opened: '建了「增长复盘」群，增长分析师牵头，数据研究员和设计师一起做。做完我在这里告诉你。',
    concluding: '组长交了回答，挑几个关键数字回给用户。',
    concluded: [
      '第三季度增长复盘做好了：',
      '',
      '- 新增用户 48.6 万，比第二季度多 18%；收入 612 万元，多 23%',
      '- 新用户次周留存 41%，高 4 个点；流失最多的是“第一次建项目”，这一步走掉 38%',
      '- 信息流的获客成本涨到 32.6 元，建议先压这块预算',
      '',
      '看板和完整的分析都在「增长复盘」群里。',
    ].join('\n'),
  },
  /** 组长（增长分析师）：核心数据和留存同时做，两块都过了再让设计师做看板，最后合成回答。 */
  leader: {
    think: '核心数据和留存可以同时做，看板要用两边的结论，放最后。',
    subtasks: [CORE, RETENTION],
    dashboard: BOARD,
    waiting: '核心数据和留存分析开好了，等它们交上来',
    waitingDashboard: '看板交给设计师了，等它交上来',
    reviewing: (title) => `「${title}」交上来了，对一下数字和来源表。`,
    handoff: '两块都通过了，接着让设计师做看板。',
    merging: '三块都交了，合成一份回答。',
    answer: ANSWER,
  },
  /** 成员各做一块：每一步先想一句，做成了记一条进展，最后交一段回答（发在群里）。 */
  work: [
    {
      brief: CORE.brief,
      steps: [
        { think: '按周拉出 7 到 9 月的注册、活跃、付费和收入。', done: '拉好了 W27 到 W39 的新增、活跃、付费和收入' },
        { think: '四项都和第二季度对一遍，标上来源表。', done: '四项都和第二季度对过了' },
      ],
      file: CORE_FILE,
      body: CORE_MD,
      finishing: '整理好了，交给组长。',
      answer: [
        '第三季度核心数据整理好了（W27 到 W39，和第二季度同口径）：',
        '',
        '- 新增用户 48.6 万，比第二季度多 18%',
        '- 周活跃从 61.2 万涨到 74.5 万，多 22%',
        '- 付费用户 3.9 万，多 15%；付费率 5.2%，降了 0.4 个点',
        '- 收入 612 万元，多 23%',
        '- 信息流的获客成本最高，32.6 元，9 月比 7 月涨了 19%',
        '',
        `按周的明细和来源表在「${CORE_FILE}」。`,
      ].join('\n'),
    },
    {
      brief: RETENTION.brief,
      steps: [
        { think: '新用户按注册月份分三组，算次日、次周、次月留存。', done: '7 到 9 月三组新用户的留存算好了' },
        { think: '再看注册后的几步，找出走掉最多的一步。', done: '找到流失最多的一步：第一次建项目' },
      ],
      file: RETENTION_FILE,
      body: RETENTION_MD,
      finishing: '留存这块做完了。',
      answer: [
        '新用户留存算好了（按注册月份）：',
        '',
        '- 次周留存 41%，比第二季度高 4 个点；次月 22%',
        '- 流失最多的是“第一次建项目”：完成引导以后这一步走掉 38%',
        '- 两条马上能做的：引导最后一步直接给 3 个模板；注册第二天还没建项目的发一条提醒',
        '',
        `${NOT_YET}。`,
      ].join('\n'),
    },
    {
      brief: BOARD.brief,
      steps: [
        { think: '读群里交的两份结果，挑看板上要放的数字。', done: '定好了看板上的数字和版式' },
        { think: '结论放最上面，下面是指标卡、趋势、渠道和留存。', done: '看板做好了，结论放在最上面' },
      ],
      page: DASHBOARD,
      finishing: '看板做好了，交给组长。',
      answer: '「第三季度增长看板」做好了：最上面是结论，下面是四个核心指标、每周活跃趋势、新增来源和各渠道获客成本、留存表和下一步。按 16:9 排的，投屏和导出 PDF 都能直接用。',
    },
  ],
  texts: {
    said: '（前台）说完了。',
    ok: '好。',
    reviewed: '数字和来源表对上了',
    submitted: '交了。',
  },
}
