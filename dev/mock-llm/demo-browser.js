/**
 * 演示剧本（开发用，给 README 截图）：共用浏览器。你跟「行政助理」说订会议室，它在示例 OA 上打开预订页，
 * 一项一项填好，点“提交预订”时 Pod 把它转成审批，等你批准；批准后报告订好了。
 * 示例 OA 用保留给文档的 example.com，截图时由演示环境把这个域名指到本机的静态页面。
 */
const OA_HOST = 'oa.example.com'
const OA_URL = `http://${OA_HOST}/rooms/book`
const STEP_PAUSE = 1200

/** 要填的表：标签、用哪个工具、填什么。 */
const FIELDS = [
  { label: '会议室', tool: 'browser_select', value: '3F 大会议室（12 人）' },
  { label: '日期', tool: 'browser_type', value: '2026-10-30' },
  { label: '开始时间', tool: 'browser_type', value: '14:00' },
  { label: '结束时间', tool: 'browser_type', value: '15:30' },
  { label: '参会人数', tool: 'browser_type', value: '8' },
  { label: '会议主题', tool: 'browser_type', value: '第三季度增长复盘' },
  { label: '备注', tool: 'browser_type', value: '需要投屏和视频会议' },
]

const FILLED = '表填好了，提交要你批准：\n\n- 3F 大会议室（12 人），10 月 30 日（周五）14:00–15:30\n- 8 人，主题「第三季度增长复盘」，备注要投屏和视频会议\n\n没问题就点「批准」。'
const BOOKED = '订好了：10 月 30 日（周五）14:00–15:30，3F 大会议室，8 人。'
const REVIEW = { fits: true, reason: '要订周五下午的会议室开复盘会，表单内容和要求一致' }

/** 页面快照里某个元素的引用，如 [e12] textbox "备注"。 */
function refOf(page, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\[(e\\d+)\\] \\S+ "${escaped}"`).exec(page)?.[1]
}

function step(tool, args) {
  return { tool, args, pause: STEP_PAUSE }
}

/** 最近一次“订会议室”的请求之后调过的工具：重发请求就从头来。 */
function callsSinceRequest(messages) {
  const start = messages.findLastIndex((message) => message.role === 'user' && JSON.stringify(message.content ?? '').includes('会议室'))
  return messages
    .slice(start + 1)
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .filter((block) => block?.type === 'tool-call')
    .map((block) => block.name)
}

/** 行政助理的单聊：打开预订页，逐项填，点提交（Pod 转成审批），说明等你批准。 */
function assistant({ userText, messages, page }) {
  if (userText.startsWith('[用户批准了')) return { text: BOOKED }
  if (!userText.includes('会议室')) return undefined
  const calls = callsSinceRequest(messages)
  if (!calls.includes('browser_open')) return step('browser_open', { url: OA_URL, fresh: true })
  const filled = calls.filter((name) => name === 'browser_type' || name === 'browser_select').length
  const field = FIELDS[filled]
  if (field !== undefined) {
    const ref = refOf(page, field.label)
    if (ref === undefined) return { text: `预订页上没找到「${field.label}」。` }
    return step(field.tool, field.tool === 'browser_select' ? { ref, value: field.value } : { ref, text: field.value, clear: true })
  }
  if (!calls.includes('browser_click')) {
    const ref = refOf(page, '提交预订')
    return ref === undefined ? { text: '预订页上没找到提交按钮。' } : step('browser_click', { ref })
  }
  return { text: FILLED }
}

/**
 * 是浏览器演示就返回这一步做什么，不是返回 undefined。
 * context 和 demoDecision 一样，另有 page（最近一次带页面内容的工具结果）。
 */
export function browserDemo(context) {
  const { system, messages } = context
  // 写操作前的复核是一次轻量调用，只认演示用的示例 OA。
  if (system.includes('执行网页写操作前复核')) return JSON.stringify(messages).includes(OA_HOST) ? { text: JSON.stringify(REVIEW) } : undefined
  if (system.includes('角色：行政助理')) return assistant(context)
  return undefined
}
