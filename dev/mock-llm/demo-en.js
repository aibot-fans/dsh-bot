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

const PLAN = {
  goal: 'Q3 growth review',
  group_name: 'Q3 growth review',
  level: 'L2',
  deliverables: ['shared/Q3 growth review.md', 'Dashboard “Q3 growth review”'],
  assumptions: [{ id: 'a1', text: ASSUMPTION, affects: ['s1', 's2'] }],
  reasons: ['Core metrics and retention don’t depend on each other, so two people work in parallel; the dashboard needs both, so it comes last'],
  conventions: ['User counts in K', 'Weeks written W27 to W39', 'Every number names its source table'],
  subtasks: [
    {
      id: 's1',
      title: 'Core metrics',
      brief: 'Compile the core metrics for the Q3 growth review: new users, active users, paying users and revenue, week by week, compared with Q2.',
      kind: 'Analysis',
      deliverable: 'Q3 core metrics.md',
      acceptance: ['New, active and paying users plus revenue are all there', 'Listed week by week from W27 to W39', 'Each one compared with Q2'],
      owner: 'Data Researcher',
    },
    {
      id: 's2',
      title: 'Retention analysis',
      brief: 'Analyze new-user retention for the Q3 growth review: day-1, week-1 and month-1 retention by sign-up month. Find the step where most users drop off and suggest two fixes we can ship right away.',
      kind: 'Analysis',
      deliverable: 'Retention analysis.md',
      acceptance: ['Day-1, week-1 and month-1 retention compared with Q2', 'Finds the step with the biggest drop-off', 'Suggests two fixes we can ship right away'],
      owner: 'Growth Analyst',
    },
    {
      id: 's3',
      title: 'Review dashboard',
      brief: 'Turn the core metrics and retention findings of the Q3 growth review into a one-page dashboard with the takeaways on top, for screen sharing at Friday’s meeting.',
      kind: 'Design',
      deliverable: 'Dashboard “Q3 growth review”',
      acceptance: ['All four core metrics on one page', 'Shows the weekly active trend, channels and retention', 'Takeaways on top'],
      dependsOn: ['s1', 's2'],
      owner: 'Designer',
    },
  ],
  integration: { owner: 'Lead', method: 'Merge both results by the task conventions; the dashboard uses the merged numbers' },
  review: { owner: 'Lead', sampling: 'Check every number against its source table' },
}

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

const SUMMARY_LINES = [
  '- New users: 486K, up 18% from Q2; revenue: $6.12M, up 23%',
  '- Week-1 retention for new users is 41%, 4 points above Q2; the biggest drop-off is “Created first project”, where 38% leave',
  '- Social feed ads cost the most per new user ($32.6), up 19% from July to September; trim that budget first',
  '- The dashboard “Q3 growth review” is ready; open it from the page card',
]

const SUBTASKS = {
  'Core metrics': {
    start: 'Compiling new, active and paying users and revenue for July to September',
    file: CORE_FILE,
    body: CORE_MD,
    checked: 'All four metrics listed week by week and checked against Q2',
    result: {
      summary: [
        '- New users: 486K, up 18% from Q2',
        '- Weekly active users grew from 612K to 745K',
        '- Paying users: 39K, paid conversion 5.2% (slightly down); revenue $6.12M, up 23%',
        '- Social feed ads cost the most per new user: $32.6',
      ].join('\n'),
      assumptions: [ASSUMPTION],
      unverified: [],
    },
  },
  'Retention analysis': {
    start: 'Grouping new users by sign-up month to compute retention',
    file: RETENTION_FILE,
    body: RETENTION_MD,
    checked: 'Retention computed for all three months; found the biggest drop-off',
    result: {
      summary: [
        '- Week-1 retention 41%, 4 points above Q2; month-1 retention 22%',
        '- The biggest drop-off is “Created first project”: 38% leave at this step after onboarding',
        '- Two fixes: offer templates during onboarding; remind people with no project by day 2',
      ].join('\n'),
      assumptions: [ASSUMPTION],
      unverified: [NOT_YET],
    },
  },
}

const DASHBOARD = {
  title: 'Q3 growth review',
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

const SUMMARY_DASHBOARD = [
  '- Made a one-page dashboard “Q3 growth review”: takeaways, four core metrics, weekly active trend, channel mix and acquisition cost, retention table and next steps',
  '- Laid out at 16:9 for screen sharing and PDF export',
].join('\n')

export const DEMO_EN = {
  /** 用户消息、任务说明和组长的消息里有它，才按演示剧本走。 */
  matches: (text) => /growth review/i.test(text),
  plan: PLAN,
  subtasks: SUBTASKS,
  dashboard: {
    title: 'Review dashboard',
    start: 'Reading both upstream results and picking the numbers for the dashboard',
    page: DASHBOARD,
    done: 'Dashboard done, with the takeaways on top',
    result: { summary: SUMMARY_DASHBOARD, assumptions: ['All numbers come from the core metrics and retention results'], unverified: [] },
  },
  merged: {
    file: 'shared/Q3 growth review.md',
    body: ['# Q3 growth review', '', 'Sample data.', '', '## Key points', '', ...SUMMARY_LINES.slice(0, 3), '', '---', '', CORE_MD.replace(/^# .*\n/, '## Core metrics\n'), RETENTION_MD.replace(/^# .*\n/, '## New-user retention\n')].join('\n'),
  },
  summary: SUMMARY_LINES.join('\n'),
  assumption: ASSUMPTION,
  notYet: NOT_YET,
  texts: {
    submitted: 'Submitted.',
    ok: 'OK.',
    reviewed: 'Numbers match the source tables',
    failed: (message) => `Couldn’t set up the team: ${message}`,
    kickoff:
      'Split into three parts with an ad-hoc squad: Data Researcher compiles the core metrics while Growth Analyst digs into retention, in parallel; Designer builds the dashboard once both are in. I’m the team lead: I’ll review each part, then merge and deliver. Follow along in the “Q3 growth review” group.',
  },
}
