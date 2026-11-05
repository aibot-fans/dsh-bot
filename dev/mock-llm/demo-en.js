/** 演示剧本的英文内容（界面是英文时用；数字和中文版是同一套示例数据，人数换成 K），逻辑在 demo.js。 */

const WEEKS = Array.from({ length: 13 }, (_, index) => `W${27 + index}`)
const NEW_USERS = [32, 33, 35, 34, 36, 37, 38, 39, 38, 40, 39, 42, 43]
const ACTIVE = [612, 620, 631, 644, 650, 663, 675, 682, 696, 708, 721, 734, 745]
const ACTIVE_Q2 = [556, 560, 567, 571, 579, 582, 588, 593, 597, 601, 604, 609, 612]
const CHANNELS = [
  { name: 'Organic search', share: 31, cost: null },
  { name: 'Content ads', share: 24, cost: 21.4 },
  { name: 'App stores', share: 18, cost: 17.8 },
  { name: 'Social feed ads', share: 15, cost: 32.6 },
  { name: 'Referrals', share: 12, cost: 6.3 },
]
const COHORTS = [
  { month: 'Jul', users: 150, day: 52, week: 39, month30: 21 },
  { month: 'Aug', users: 163, day: 54, week: 41, month30: 23 },
  { month: 'Sep', users: 173, day: 55, week: 43, month30: null },
]
const FUNNEL = [
  ['Signed up', 100],
  ['Finished onboarding', 81],
  ['Created first project', 50],
  ['Invited a teammate in week 1', 23],
]
const ASSUMPTION = 'Q3 runs from July 1 to September 30, measured the same way as Q2'
const NOT_YET = 'September sign-ups are not 30 days old yet, so their month-1 retention is not in'

function table(head, rows) {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n')
}

const CORE_FILE = 'Q3 core metrics.md'
const CORE_MD = [
  '# Q3 core metrics',
  '',
  `Scope: ${ASSUMPTION}. User counts in K. Source: growth data table (sample data).`,
  '',
  table(
    ['Metric', 'Q3', 'Q2', 'Change'],
    [
      ['New users', '486K', '412K', '+18%'],
      ['Weekly active (end of quarter)', '745K', '612K', '+22%'],
      ['Paying users', '39K', '34K', '+15%'],
      ['Paid conversion', '5.2%', '5.6%', '-0.4 pts'],
      ['Revenue', '$6.12M', '$4.98M', '+23%'],
    ],
  ),
  '',
  '## By week',
  '',
  table(['Week', 'New (K)', 'Weekly active (K)'], WEEKS.map((week, index) => [week, NEW_USERS[index], ACTIVE[index]])),
  '',
  '## Channels',
  '',
  table(['Channel', 'Share of new users', 'Acquisition cost'], CHANNELS.map((item) => [item.name, `${item.share}%`, item.cost === null ? '—' : `$${item.cost}`])),
  '',
  'Social feed ads cost the most per new user, and the cost rose 19% from July to September.',
  '',
].join('\n')

const RETENTION_FILE = 'Retention analysis.md'
const RETENTION_MD = [
  '# Q3 new-user retention',
  '',
  'Grouped by sign-up month. Source: retention detail table (sample data).',
  '',
  table(
    ['Sign-up month', 'New (K)', 'Day 1', 'Week 1', 'Month 1'],
    [...COHORTS.map((item) => [item.month, item.users, `${item.day}%`, `${item.week}%`, item.month30 === null ? 'not 30 days yet' : `${item.month30}%`]), ['Q2', '412', '50%', '37%', '20%']],
  ),
  '',
  '## Where most users drop off',
  '',
  table(['Step', 'Remaining'], FUNNEL.map(([step, left]) => [step, `${left}%`])),
  '',
  'Most users leave after onboarding and before creating their first project: 81% down to 50%, so 38% drop off at this step.',
  '',
  '## Two fixes we can ship right away',
  '',
  '1. Offer 3 templates on the last onboarding step; picking one creates the first project.',
  '2. Send a reminder with template links to anyone who hasn’t created a project by day 2.',
  '',
].join('\n')

const DASHBOARD = {
  title: 'Q3 growth dashboard',
  kind: 'dashboard',
  // 留空时 dsh-bot 记成第一版，页面卡片上不显示。
  note: '',
  subtitle: 'July 1 to September 30 · sample data',
  blocks: [
    {
      type: 'callout',
      tone: 'info',
      title: 'Takeaways',
      text: 'New users and revenue both hit record highs, and week-1 retention is 4 points above last quarter. The biggest drop-off is at “Created first project”, and social feed ads are getting more expensive.',
    },
    {
      type: 'metrics',
      items: [
        { label: 'New users', value: '486', unit: 'K', delta: '+18%', trend: NEW_USERS },
        { label: 'Weekly active', value: '745', unit: 'K', delta: '+22%', trend: ACTIVE },
        { label: 'Paying users', value: '39', unit: 'K', delta: '+15%', note: 'Paid conversion 5.2%' },
        { label: 'Revenue', value: '$6.12', unit: 'M', delta: '+23%' },
      ],
    },
    { type: 'chart', chart: 'line', title: 'Weekly active users', width: 'two-thirds', labels: WEEKS, unit: 'K', series: [{ name: 'Q3', values: ACTIVE }, { name: 'Q2', values: ACTIVE_Q2 }] },
    { type: 'chart', chart: 'pie', title: 'Where new users come from', width: 'third', labels: CHANNELS.map((item) => item.name), values: CHANNELS.map((item) => item.share), unit: '%' },
    {
      type: 'chart',
      chart: 'bar',
      title: 'Acquisition cost by channel',
      width: 'half',
      labels: CHANNELS.filter((item) => item.cost !== null).map((item) => item.name),
      values: CHANNELS.filter((item) => item.cost !== null).map((item) => item.cost),
      unit: '$',
    },
    {
      type: 'table',
      title: 'New-user retention',
      width: 'half',
      columns: [{ label: 'Sign-up month' }, { label: 'New (K)', type: 'number' }, { label: 'Day 1', type: 'percent' }, { label: 'Week 1', type: 'percent' }, { label: 'Month 1', type: 'percent' }],
      rows: [...COHORTS.map((item) => [item.month, item.users, item.day, item.week, item.month30]), ['Q2', 412, 50, 37, 20]],
      note: NOT_YET,
    },
    {
      type: 'list',
      style: 'check',
      items: [
        { text: 'Offer 3 templates on the last onboarding step; picking one creates the first project', done: false },
        { text: 'Remind anyone with no project by day 2, with template links', done: false },
        { text: 'Cut the social feed ad budget by 20% and watch acquisition cost for two weeks', done: false },
      ],
    },
  ],
}

const CORE = {
  title: 'Core metrics',
  bot: 'Data Researcher',
  brief: 'Compile Q3’s core metrics: new, active and paying users plus revenue, week by week from W27 to W39, compared with Q2, naming the source table for every number.',
  acceptance: ['New, active and paying users plus revenue are all there', 'Listed week by week from W27 to W39', 'Each one compared with Q2'],
}

const RETENTION = {
  title: 'Retention analysis',
  bot: 'self',
  brief: 'Compute day-1, week-1 and month-1 retention for Q3’s new users by sign-up month, find the step where most users drop off, and suggest two fixes we can ship right away.',
  acceptance: ['Day-1, week-1 and month-1 retention compared with Q2', 'Finds the step with the biggest drop-off', 'Suggests two fixes we can ship right away'],
}

const BOARD = {
  title: 'Review dashboard',
  bot: 'Designer',
  brief: 'Turn the core metrics and retention results posted in the group into a one-page dashboard with the takeaways on top, for screen sharing at Friday’s meeting.',
  acceptance: ['All four core metrics fit on one page', 'Shows the weekly active trend, channels and retention', 'Takeaways on top'],
}

const ANSWER = [
  'The Q3 growth review (July 1 to September 30) is done, measured the same way as Q2:',
  '',
  '- 486K new users, up 18% from Q2; weekly active users grew from 612K to 745K; revenue $6.12M, up 23%',
  '- 39K paying users, up 15%, though paid conversion slipped from 5.6% to 5.2%',
  '- Week-1 retention for new users is 41%, up 4 points; the biggest drop-off is “Created first project”, where 38% leave after onboarding',
  '- Social feed ads are the most expensive channel at $32.6 per user, up 19% from July to September',
  '',
  'Three things to do first: offer 3 templates on the last onboarding step; remind anyone with no project by day 2; cut the social feed ad budget by 20% and watch acquisition cost for two weeks.',
  '',
  `The dashboard is above and ready to share on screen on Friday. ${NOT_YET}.`,
].join('\n')

export const DEMO_EN = {
  /** 你在主对话里说的话、任务的交代和叫醒 Super-agent 的消息里有它，才按演示剧本走。 */
  matches: (text) => /growth review/i.test(text),
  /** Super-agent：没有对口的群，按主题建「Growth reviews」群交进去，组长交了回答再回主对话说结论。 */
  front: {
    think: 'Growth data work, and no group covers it yet: new “Growth reviews” group.',
    dispatch: {
      title: 'Q3 growth review',
      group: 'Growth reviews',
      bot: 'Growth Analyst',
      members: ['Data Researcher', 'Designer'],
      about: 'Growth data reviews: core metrics, new-user retention and acquisition channels',
      brief: 'My understanding: a Q3 growth review (July 1 to September 30) compared with Q2. It needs the core metrics and new-user retention, then a one-page dashboard to share on screen at Friday’s meeting. Lead with the takeaways and name the source of every number.',
    },
    opened: 'I created the “Growth reviews” group. Growth Analyst leads it, with Data Researcher and Designer helping. I’ll tell you here when it’s done.',
    concluding: 'The lead has delivered. Pick the key numbers for the user.',
    concluded: [
      'The Q3 growth review is done:',
      '',
      '- 486K new users, up 18% from Q2; revenue $6.12M, up 23%',
      '- Week-1 retention for new users is 41%, up 4 points; the biggest drop-off is “Created first project”, where 38% leave',
      '- Social feed ads now cost $32.6 per new user, so trim that budget first',
      '',
      'The dashboard and the full analysis are in the “Growth reviews” group.',
    ].join('\n'),
  },
  /** 组长（Growth Analyst）：核心数据和留存同时做，两块都过了再让 Designer 做看板，最后合成回答。 */
  leader: {
    think: 'Core metrics and retention can run in parallel; the dashboard comes last.',
    subtasks: [CORE, RETENTION],
    dashboard: BOARD,
    waiting: 'Core metrics and retention analysis are assigned; waiting for both',
    waitingDashboard: 'Dashboard assigned to Designer; waiting for it',
    reviewing: (title) => `“${title}” is in. Checking it against the sources.`,
    handoff: 'Both parts passed. Designer can build the dashboard now.',
    merging: 'All three parts are in. Putting the answer together.',
    answer: ANSWER,
  },
  /** 成员各做一块：每一步先想一句，做成了记一条进展，最后交一段回答（发在群里）。 */
  work: [
    {
      brief: CORE.brief,
      steps: [
        { think: 'Pulling weekly sign-ups, actives, payers and revenue for Q3.', done: 'Pulled new, active and paying users plus revenue for W27 to W39' },
        { think: 'Comparing all four with Q2 and naming the sources.', done: 'All four compared with Q2' },
      ],
      file: CORE_FILE,
      body: CORE_MD,
      finishing: 'Done. Handing it to the lead.',
      answer: [
        'Q3 core metrics are ready (W27 to W39, measured the same way as Q2):',
        '',
        '- 486K new users, up 18% from Q2',
        '- Weekly active users grew from 612K to 745K, up 22%',
        '- 39K paying users, up 15%; paid conversion 5.2%, down 0.4 points',
        '- Revenue $6.12M, up 23%',
        '- Social feed ads are the most expensive channel at $32.6, up 19% from July to September',
        '',
        `Week-by-week numbers and source tables are in “${CORE_FILE}”.`,
      ].join('\n'),
    },
    {
      brief: RETENTION.brief,
      steps: [
        { think: 'Splitting Q3 sign-ups by month to get retention.', done: 'Retention computed for the July to September cohorts' },
        { think: 'Finding the step after sign-up where most people leave.', done: 'Found the biggest drop-off: creating the first project' },
      ],
      file: RETENTION_FILE,
      body: RETENTION_MD,
      finishing: 'Retention is done.',
      answer: [
        'New-user retention is ready (by sign-up month):',
        '',
        '- Week-1 retention 41%, 4 points above Q2; month-1 retention 22%',
        '- The biggest drop-off is “Created first project”: 38% leave at this step after onboarding',
        '- Two fixes we can ship right away: offer 3 templates on the last onboarding step; remind anyone with no project by day 2',
        '',
        `${NOT_YET}.`,
      ].join('\n'),
    },
    {
      brief: BOARD.brief,
      steps: [
        { think: 'Reading both results in the group and picking the numbers.', done: 'Picked the numbers and layout for the dashboard' },
        { think: 'Takeaways on top, then metric cards, trends, channels and retention.', done: 'Dashboard done, with the takeaways on top' },
      ],
      page: DASHBOARD,
      finishing: 'Dashboard done. Handing it to the lead.',
      answer: 'The “Q3 growth dashboard” is ready: takeaways on top, then the four core metrics, the weekly active trend, where new users come from and acquisition cost by channel, the retention table and next steps. It’s laid out at 16:9, so it works for screen sharing and PDF export.',
    },
  ],
  texts: {
    said: '(front desk) Done.',
    ok: 'OK.',
    reviewed: 'Numbers match the source tables',
    submitted: 'Submitted.',
  },
}
