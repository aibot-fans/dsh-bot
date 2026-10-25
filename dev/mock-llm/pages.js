/**
 * 页面剧本（开发用）：
 * - 用户说“做个看板 / 报告 / 跟踪表 / 幻灯片 / 海报 / 原型 / 架构图”：save_page 新建，内容是下面的样例；
 * - 收到页面修改要求（[页面修改]）或要更新页面的例程：先 get_page 读，再按要求改一处，save_page 带上 id 存成新的一版；
 * - “建个设计师”：create_bot 用 designer 预设。
 * 只看这一轮（最后一条用户消息之后）调过的工具，前几轮的不算。
 */

const SAMPLES = {
  dashboard: {
    title: '策略回测看板',
    content: {
      subtitle: '双均线策略 2021-2026 回测，每天收盘后更新',
      blocks: [
        { type: 'metrics', items: [
          { label: '年化收益', value: '18.4', unit: '%', delta: '+2.1%', trend: [3, 4, 6, 5, 8, 9, 12, 11, 14, 16, 18] },
          { label: '最大回撤', value: '-12.7', unit: '%', delta: '-1.3%', good: 'up' },
          { label: '夏普比率', value: '1.42', delta: '+0.08' },
          { label: '胜率', value: '56.3', unit: '%', delta: '0%' },
        ] },
        { type: 'chart', chart: 'line', title: '净值曲线', width: 'two-thirds', labels: ['21Q1', '21Q2', '21Q3', '21Q4', '22Q1', '22Q2', '22Q3', '22Q4', '23Q1', '23Q2', '23Q3', '23Q4', '24Q1', '24Q2'], series: [
          { name: '策略', values: [1, 1.04, 1.1, 1.08, 1.15, 1.2, 1.18, 1.26, 1.32, 1.3, 1.41, 1.48, 1.52, 1.6] },
          { name: '沪深300', values: [1, 1.02, 0.98, 0.95, 0.97, 1.01, 0.96, 0.94, 1.0, 1.03, 0.99, 1.02, 1.05, 1.07] },
        ] },
        { type: 'chart', chart: 'pie', title: '持仓分布', width: 'third', labels: ['消费', '科技', '金融', '医药', '能源', '其他'], values: [32, 24, 18, 12, 8, 6], unit: '%' },
        { type: 'chart', chart: 'bar', title: '月度收益', width: 'half', labels: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月'], values: [2.1, -1.3, 3.4, 0.8, -0.6, 1.9, 2.6, -2.2], unit: '%' },
        { type: 'heatmap', title: '月度收益热力图', width: 'half', rows: ['2023', '2024', '2025'], columns: ['1月', '2月', '3月', '4月', '5月', '6月'], values: [[1.2, -0.8, 2.3, 0.4, -1.9, 0.6], [2.2, 1.1, -0.4, 3.1, 0.9, -0.2], [0.3, -2.4, 1.7, 2.2, -0.6, 1.4]], unit: '%' },
        { type: 'table', title: '最近交易', columns: [{ label: '日期', type: 'date' }, { label: '标的' }, { label: '方向', type: 'status' }, { label: '金额', type: 'money' }, { label: '收益率', type: 'percent' }, { label: '进度', type: 'progress' }], rows: [
          ['2026-10-21', '贵州茅台', '完成', 125000, 3.2, 100],
          ['2026-10-22', '宁德时代', '进行中', 88000, -1.4, 60],
          ['2026-10-23', '招商银行', '有风险', 43000, 0.6, 20],
        ] },
      ],
    },
  },
  report: {
    title: '第三季度复盘',
    content: {
      subtitle: '用户增长、留存和下一步',
      blocks: [
        { type: 'text', text: '## 结论\n本季度新增用户 **12.4 万**，比上季度增长 *18%*。留存基本持平，详见下面的数据。\n\n- 渠道 A 贡献最大\n- 渠道 B 成本上升' },
        { type: 'callout', tone: 'warn', text: '渠道 B 的获客成本连续两个月上升，需要调整投放。' },
        { type: 'chart', chart: 'area', title: '每周新增用户', labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10'], series: [{ name: '渠道 A', values: [3, 4, 4, 5, 6, 6, 7, 8, 8, 9] }, { name: '渠道 B', values: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5] }], stacked: true, unit: '千人' },
        { type: 'timeline', title: '里程碑', items: [{ date: '7月', title: '新版上线', status: 'done', note: '首页改版' }, { date: '8月', title: '会员体系', status: 'active' }, { date: '9月', title: '海外试点', status: 'risk', note: '合规审查延期' }, { date: '10月', title: '复盘', status: 'todo' }] },
        { type: 'list', style: 'check', items: [{ text: '整理渠道数据', done: true }, { text: '更新投放策略', done: false }] },
      ],
    },
  },
  tracker: {
    title: '发布跟踪表',
    content: {
      blocks: [
        { type: 'progress', width: 'third', title: '整体进度', items: [{ label: '后端', value: 80 }, { label: '前端', value: 55 }, { label: '测试', value: 12, max: 40 }] },
        { type: 'board', width: 'two-thirds', title: '任务', columns: [{ title: '待办', cards: [{ title: '支付回调', tag: '后端', owner: '小王' }] }, { title: '进行中', cards: [{ title: '订单页', note: '等设计稿', status: '有风险', owner: '小李' }, { title: '埋点', status: '进行中' }] }, { title: '完成', cards: [{ title: '登录', status: '完成' }] }] },
      ],
    },
  },
  diagram: {
    title: '系统架构',
    content: {
      blocks: [
        { type: 'diagram', direction: 'right', groups: [{ id: 'edge', label: '接入层' }, { id: 'core', label: '服务层' }, { id: 'data', label: '数据层' }], nodes: [
          { id: 'user', label: '用户', shape: 'person' }, { id: 'cdn', label: 'CDN', shape: 'cloud', group: 'edge' }, { id: 'gw', label: 'API 网关', group: 'edge' },
          { id: 'order', label: '订单服务', group: 'core' }, { id: 'pay', label: '支付服务', group: 'core' }, { id: 'mq', label: '消息队列', shape: 'round', group: 'core' },
          { id: 'db', label: 'MySQL 主库', shape: 'database', group: 'data' }, { id: 'cache', label: 'Redis', shape: 'database', group: 'data' },
        ], edges: ['user->cdn', 'cdn->gw', { from: 'gw', to: 'order', label: 'HTTP' }, { from: 'gw', to: 'pay' }, { from: 'order', to: 'mq', dashed: true }, { from: 'mq', to: 'pay', dashed: true }, 'order->db', 'order->cache', 'pay->db'] },
      ],
    },
  },
  slides: {
    title: 'Q4 产品规划',
    content: {
      slides: [
        { title: 'Q4 产品规划', subtitle: '三个重点和时间表' },
        { layout: 'content', title: '三个重点', blocks: [{ type: 'list', items: ['会员体系上线', '海外试点', '性能优化：首屏 < 1 秒'] }], notes: '先讲会员，再讲海外。' },
        { layout: 'two-column', title: '数据', blocks: [{ type: 'metrics', items: [{ label: '日活', value: '42 万', delta: '+8%' }] }], right: [{ type: 'chart', chart: 'bar', labels: ['7月', '8月', '9月'], values: [36, 39, 42], unit: '万' }] },
        { layout: 'end', title: '谢谢', subtitle: '欢迎提问' },
      ],
    },
  },
  poster: {
    title: '黑客松招募',
    content: {
      accent: 'purple',
      poster: { size: 'portrait', eyebrow: 'HACKATHON 2026', headline: '48 小时，做出你的第一个 AI 应用', subheadline: '11 月 15–16 日 · 线下 + 线上 · 奖金 10 万元', footer: '扫码报名 · 截止 11 月 10 日', background: 'gradient' },
      blocks: [{ type: 'metrics', items: [{ label: '参赛队伍', value: '120+' }, { label: '导师', value: '30' }, { label: '奖金', value: '10 万' }] }],
    },
  },
  prototype: {
    title: '记账 App 原型',
    content: {
      device: 'phone',
      screens: [
        { id: 'home', title: '首页', blocks: [{ type: 'appbar', title: '本月账单', actions: ['筛选'] }, { type: 'metrics', items: [{ label: '本月支出', value: '¥3,240', delta: '-12%', good: 'down' }] }, { type: 'rows', items: [{ title: '午餐', subtitle: '餐饮 · 今天', meta: '-¥32', goto: 'detail' }, { title: '地铁', subtitle: '交通 · 今天', meta: '-¥4' }] }, { type: 'button', label: '记一笔', goto: 'add' }] },
        { id: 'add', title: '记一笔', blocks: [{ type: 'appbar', title: '记一笔', back: 'home' }, { type: 'input', label: '金额', placeholder: '0.00' }, { type: 'button', label: '保存', goto: 'home' }] },
        { id: 'detail', title: '账单详情', blocks: [{ type: 'appbar', title: '午餐', back: 'home' }, { type: 'card', title: '¥32.00', text: '公司楼下的面馆', meta: '2026-10-24 12:10', tag: '餐饮' }] },
      ],
    },
  },
}

const TRIGGERS = [
  [/看板|仪表盘/, 'dashboard'],
  [/幻灯片|演示稿|PPT/i, 'slides'],
  [/海报/, 'poster'],
  [/原型/, 'prototype'],
  [/架构图|图示|流程图/, 'diagram'],
  [/跟踪表/, 'tracker'],
  [/报告/, 'report'],
]

function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content.filter((block) => block && block.type === 'text').map((block) => block.text).join('')
}

function parsed(message) {
  try {
    return JSON.parse(textOf(message.content))
  } catch {
    return { ok: false, message: textOf(message.content) }
  }
}

/** 这一轮调过的工具（按顺序）和最后一个工具结果。 */
function thisTurn(messages, isUser) {
  let start = -1
  messages.forEach((message, index) => {
    if (isUser(message)) start = index
  })
  const after = messages.slice(start + 1)
  const calls = after.filter((message) => message.role === 'assistant').flatMap((message) => (Array.isArray(message.content) ? message.content : [])).filter((block) => block && block.type === 'tool-call')
  const results = after.filter((message) => message.role === 'tool')
  return { calls: calls.map((call) => call.name), result: results.length === 0 ? undefined : parsed(results.at(-1)) }
}

/** 按要求改一处：要柱状图就把折线、面积图换成柱状图，其余在最前面加一条说明；幻灯片加一页，海报改副标题。 */
function revise(kind, content, request) {
  const line = request.split('\n').map((item) => item.trim()).find(Boolean) ?? '按要求修改'
  const note = `按要求修改：${line.slice(0, 40)}`
  if (/柱状图/.test(line) && Array.isArray(content.blocks)) {
    const blocks = content.blocks.map((block) => (block.type === 'chart' && (block.chart === 'line' || block.chart === 'area') ? { ...block, chart: 'bar' } : block))
    return { content: { ...content, blocks }, note: '折线图换成了柱状图' }
  }
  if (kind === 'slides' && Array.isArray(content.slides)) {
    const slides = [...content.slides.slice(0, -1), { layout: 'content', title: '补充', blocks: [{ type: 'list', items: [line.slice(0, 60)] }] }, ...content.slides.slice(-1)]
    return { content: { ...content, slides }, note: '加了一页补充' }
  }
  if (kind === 'poster' && content.poster !== undefined) return { content: { ...content, poster: { ...content.poster, subheadline: line.slice(0, 60) } }, note: '改了副标题' }
  if (kind === 'prototype' && Array.isArray(content.screens)) {
    const [first, ...rest] = content.screens
    return { content: { ...content, screens: [{ ...first, blocks: [...(first.blocks ?? []), { type: 'card', title: '修改说明', text: note }] }, ...rest] }, note }
  }
  return { content: { ...content, blocks: [{ type: 'callout', tone: 'info', text: note }, ...(content.blocks ?? [])] }, note }
}

/** 用户想做哪种页面；没提到就是 undefined。 */
export function wantedKind(text) {
  if (!/做|画|出一|生成|整理成/.test(text)) return undefined
  return TRIGGERS.find(([pattern]) => pattern.test(text))?.[1]
}

/** 新建一个样例页面的 save_page 参数。 */
export function newPage(kind) {
  const sample = SAMPLES[kind]
  return { tool: 'save_page', args: { title: sample.title, kind, note: '第一版', ...sample.content } }
}

/**
 * 对话（和例程）里的页面剧本；不是页面相关的返回 undefined，交给别的剧本。
 * isUser 判断一条消息是不是真正的用户消息（这一轮从它之后算起）。
 */
export function pageDecision({ messages, userText, tools, isUser }) {
  if (!tools.has('save_page')) return undefined
  const { calls, result } = thisTurn(messages, isUser)
  const pageId = /id：(page_[0-9a-z]+)/i.exec(userText)?.[1]
  if (pageId !== undefined && userText.includes('get_page')) {
    if (!calls.includes('get_page')) return { tool: 'get_page', args: { id: pageId } }
    if (calls.at(-1) === 'get_page') {
      if (result?.ok !== true) return { text: `读不到这个页面：${result?.message ?? ''}` }
      const request = userText.startsWith('[页面修改]') ? (userText.split('\n')[1] ?? '') : (userText.split('\n')[1] ?? '例行更新')
      const next = revise(result.kind, result.content ?? {}, request)
      return { tool: 'save_page', args: { id: pageId, note: next.note, ...next.content } }
    }
    if (calls.at(-1) === 'save_page') return { text: result?.ok === true ? `改好了，${result.message.split('，页面卡片')[0]}。` : `保存失败：${result?.message ?? ''}` }
    return undefined
  }
  if (calls.at(-1) === 'save_page') return { text: result?.ok === true ? `做好了：${result.message.split('，页面卡片')[0]}。点卡片打开，右边可以直接提修改。` : `保存失败：${result?.message ?? ''}` }
  if (calls.at(-1) === 'create_bot') return { text: result?.ok === true ? `${result.message}。以后要做页面可以交给它。` : `没建成：${result?.message ?? ''}` }
  if (/设计师/.test(userText) && /建|新建|招/.test(userText) && tools.has('create_bot') && !calls.includes('create_bot')) return { tool: 'create_bot', args: { preset: 'designer', reason: '用户要一个专门做页面的设计师' } }
  // “交给某某做看板”是委派，交给主管的委派剧本。
  if (/交给|委派/.test(userText)) return undefined
  // [任务交付] 这类系统通知里会提到页面，不是新的要求。
  if (userText.startsWith('[')) return undefined
  const kind = wantedKind(userText)
  if (kind !== undefined && !calls.includes('save_page')) return newPage(kind)
  return undefined
}
