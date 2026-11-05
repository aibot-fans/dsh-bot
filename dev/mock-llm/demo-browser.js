/**
 * 演示剧本（开发用，给 README 截图）：共用浏览器。你在单聊里跟「行政助理」说订会议室，它的前台开一个任务给自己，
 * 任务在示例 OA 上打开预订页，一项一项填好，点“提交预订”时 dsh-bot 把它转成审批，等你批准；批准后交上订好了。
 * 示例 OA 用保留给文档的 example.com，截图时由演示环境把这个域名指到本机的静态页面。
 * dsh-bot 设成英文时用英文版：助理叫 Office Assistant（人设以“Role: office assistant”开头），示例 OA 也要用英文版起。
 */
import { batchItems } from './front.js'
import { isEnglish } from './language.js'

const OA_HOST = 'oa.example.com'
const OA_URL = `http://${OA_HOST}/rooms/book`
const STEP_PAUSE = 1200

const ZH = {
  persona: '角色：行政助理',
  name: '行政助理',
  /** 前台开任务：想一句、任务标题、交代，开好后回的那句。 */
  think: '要在示例 OA 上填表，开个任务自己去订。',
  title: '订会议室',
  brief: '我的理解：在示例 OA 上订周五下午两点到三点半的会议室，开第三季度增长复盘会，8 个人，要投屏；表填好后提交要用户批准。',
  opened: '好，我去示例 OA 上订。表填好后，提交前先给你批。',
  /** 用户消息里有它才算订会议室的请求。 */
  request: (text) => text.includes('会议室'),
  /** 要填的表：标签、用哪个工具、填什么。 */
  fields: [
    { label: '会议室', tool: 'browser_select', value: '3F 大会议室（12 人）' },
    { label: '日期', tool: 'browser_type', value: '2026-10-30' },
    { label: '开始时间', tool: 'browser_type', value: '14:00' },
    { label: '结束时间', tool: 'browser_type', value: '15:30' },
    { label: '参会人数', tool: 'browser_type', value: '8' },
    { label: '会议主题', tool: 'browser_type', value: '第三季度增长复盘' },
    { label: '备注', tool: 'browser_type', value: '需要投屏和视频会议' },
  ],
  submit: '提交预订',
  filled: '表填好了，提交要你批准：\n\n- 3F 大会议室（12 人），10 月 30 日（周五）14:00–15:30\n- 8 人，主题「第三季度增长复盘」，备注要投屏和视频会议\n\n没问题就点「批准」。',
  booked: '订好了：10 月 30 日（周五）14:00–15:30，3F 大会议室，8 人。',
  waiting: '等你批准。',
  said: '（前台）说完了。',
  review: { fits: true, reason: '要订周五下午的会议室开复盘会，表单内容和要求一致' },
  missing: (label) => `预订页上没找到「${label}」。`,
  noSubmit: '预订页上没找到提交按钮。',
}

const EN = {
  persona: 'Role: office assistant',
  name: 'Office Assistant',
  think: 'This means filling in a form on the sample OA. I’ll take it as a task.',
  title: 'Book a meeting room',
  brief: 'My understanding: book a meeting room on the sample OA for Friday 14:00–15:30 for the Q3 growth review, 8 people, with screen sharing; submitting the form needs the user’s approval.',
  opened: 'On it. I’ll fill in the booking form on the sample OA and ask you before submitting.',
  request: (text) => /meeting room/i.test(text),
  fields: [
    { label: 'Room', tool: 'browser_select', value: '3F Large Room (12 people)' },
    { label: 'Date', tool: 'browser_type', value: '2026-10-30' },
    { label: 'Start time', tool: 'browser_type', value: '14:00' },
    { label: 'End time', tool: 'browser_type', value: '15:30' },
    { label: 'Attendees', tool: 'browser_type', value: '8' },
    { label: 'Topic', tool: 'browser_type', value: 'Q3 growth review' },
    { label: 'Notes', tool: 'browser_type', value: 'Needs screen sharing and video conferencing' },
  ],
  submit: 'Submit booking',
  filled:
    'The form is filled in. Submitting it needs your approval:\n\n- 3F Large Room (12 people), Fri Oct 30, 14:00–15:30\n- 8 people, topic “Q3 growth review”, needs screen sharing and video conferencing\n\nIf it looks right, click “Approve”.',
  booked: 'Booked: Fri Oct 30, 14:00–15:30, 3F Large Room, 8 people.',
  waiting: 'Waiting for your approval.',
  said: '(front desk) Done.',
  review: { fits: true, reason: 'Booking a room for Friday afternoon’s review meeting; the form matches the request' },
  missing: (label) => `Couldn’t find “${label}” on the booking page.`,
  noSubmit: 'Couldn’t find the submit button on the booking page.',
}

/** 页面快照里某个元素的引用，如 [e12] textbox "备注"。 */
function refOf(page, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\[(e\\d+)\\] \\S+ "${escaped}"`).exec(page)?.[1]
}

function step(tool, args) {
  return { tool, args, pause: STEP_PAUSE }
}

/** 最近一次“订会议室”的请求之后调过的工具：重发请求就从头来。 */
function callsSinceRequest(messages, demo) {
  const start = messages.findLastIndex((message) => message.role === 'user' && demo.request(JSON.stringify(message.content ?? '')))
  return messages
    .slice(start + 1)
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .filter((block) => block?.type === 'tool-call')
    .map((block) => block.name)
}

/** 行政助理的任务：打开预订页，逐项填，点提交（dsh-bot 转成审批），报 waiting 说明等你批准；批准后交上订好了。 */
function assistant({ userText, messages, page, last }, demo) {
  if (userText.startsWith('[用户批准了')) return last?.role === 'tool' ? { text: demo.waiting } : { tool: 'report', args: { status: 'ready', summary: demo.booked, files: [] } }
  // 走了好几步还没列计划时 dsh-bot 会插一条“[dsh-bot 提醒]”，剧本不理它，照常往下填。
  if (!demo.request(userText) && !userText.startsWith('[dsh-bot 提醒]')) return undefined
  const calls = callsSinceRequest(messages, demo)
  if (!calls.includes('browser_open')) return step('browser_open', { url: OA_URL, fresh: true })
  const filled = calls.filter((name) => name === 'browser_type' || name === 'browser_select').length
  const field = demo.fields[filled]
  if (field !== undefined) {
    const ref = refOf(page, field.label)
    if (ref === undefined) return { text: demo.missing(field.label) }
    return step(field.tool, field.tool === 'browser_select' ? { ref, value: field.value } : { ref, text: field.value, clear: true })
  }
  if (!calls.includes('browser_click')) {
    const ref = refOf(page, demo.submit)
    return ref === undefined ? { text: demo.noSubmit } : step('browser_click', { ref })
  }
  if (!calls.includes('report')) return { tool: 'report', args: { status: 'waiting', summary: demo.filled } }
  return { text: demo.waiting }
}

/** 行政助理的前台：你在单聊里说订会议室，先想一句，开一个任务给自己去订，再回一句。别的批返回 undefined。 */
export function browserFront({ system, batch, calls }) {
  const demo = isEnglish(system) ? EN : ZH
  if (!system.includes(demo.persona) && !system.includes(`「${demo.name}」`)) return undefined
  const asked = batchItems(batch).find((item) => item.speaker === '用户' && item.room.kind === '单聊' && demo.request(item.body))
  if (asked === undefined) return undefined
  if (calls === 0) return { tool: 'dispatch', args: { items: [{ messages: [asked.id], action: 'open', title: demo.title, bot: '自己', brief: demo.brief }] }, think: demo.think, hold: STEP_PAUSE }
  if (calls === 1) return { tool: 'reply', args: { to: asked.id, text: demo.opened } }
  return { text: demo.said }
}

/**
 * 是浏览器演示就返回这一步做什么，不是返回 undefined。
 * context 和 demoDecision 一样，另有 page（最近一次带页面内容的工具结果）。
 */
export function browserDemo(context) {
  const { system, messages } = context
  const demo = isEnglish(system) ? EN : ZH
  // 写操作前的复核是一次轻量调用，只认演示用的示例 OA。
  if (system.includes('执行网页写操作前复核')) return JSON.stringify(messages).includes(OA_HOST) ? { text: JSON.stringify(demo.review) } : undefined
  if (system.includes(demo.persona)) return assistant(context, demo)
  return undefined
}
