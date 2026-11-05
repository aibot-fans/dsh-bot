/**
 * 演示剧本（开发用，给 README 截图）：你在主对话里跟 Super-agent 说要做「第三季度增长复盘」，
 * Super-agent 按主题建「增长复盘」群，写上管什么，增长分析师当组长，数据研究员和设计师一起做；
 * 组长在群里开子任务：数据研究员整理核心数据、自己做留存分析，这两块同时做，都交了再让设计师做一页看板；
 * 子任务的结果发在群里，组长逐个验收、合成一份回答交在群里，Super-agent 回主对话说结论。数字都是编的示例数据。
 * 每一步先想一句再停一会儿（hold），对话最底下的回答过程写着这一句，看得到几个 bot 同时在做。
 * 剧本的文字和数字在 demo-zh.js、demo-en.js：dsh-bot 设成英文时（系统提示里有英文说明）用英文版。
 */

import { browserDemo, browserFront } from './demo-browser.js'
import { DEMO_EN } from './demo-en.js'
import { DEMO_ZH } from './demo-zh.js'
import { batchItems } from './front.js'
import { isEnglish } from './language.js'

/** 每一步想完以后停多久（毫秒）：回答过程那一行一直写着想的这一句。 */
const HOLD = 7000
const SHORT_HOLD = 1500

function step(tool, args, think, hold = HOLD) {
  return { tool, args, ...(think === undefined ? {} : { think }), hold }
}

function demoFor(system) {
  return isEnglish(system) ? DEMO_EN : DEMO_ZH
}

/** 这条会话调过的某个工具的全部参数（按调用先后）。 */
function argsOf(messages, name) {
  return messages
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .filter((block) => block && block.type === 'tool-call' && block.name === name)
    .map((block) => {
      try {
        return typeof block.arguments === 'string' ? JSON.parse(block.arguments) : (block.arguments ?? {})
      } catch {
        return {}
      }
    })
}

/**
 * Super-agent 的前台：主对话里收到增长复盘，先想一句，再用 dispatch 新建「增长复盘」群交进去，回一句建了群、谁牵头；
 * 组长交了回答（叫醒里是 [任务交结果]），回主对话说结论。行政助理的前台走浏览器剧本（browserFront），
 * 别的批、别的 bot 的前台不归剧本管，返回 undefined。
 */
export function demoFront({ system, userText, batch, calls, result, tools }) {
  const browsing = browserFront({ system, batch, calls })
  if (browsing !== undefined) return browsing
  if (!tools.has('create_group')) return undefined
  const demo = demoFor(system)
  if (userText.startsWith('[任务交结果]')) {
    if (!demo.matches(userText)) return undefined
    if (calls > 0) return { text: demo.texts.said }
    const to = /to 写 (msg_[0-9a-z]+)/.exec(userText)?.[1]
    const room = /room 写 (room_[0-9a-z]+)/.exec(userText)?.[1]
    const task = /task 写 (task_[0-9a-z]+)/.exec(userText)?.[1]
    if (task === undefined || (to === undefined && room === undefined)) return undefined
    return step('reply', { ...(to === undefined ? { room } : { to }), task, text: demo.front.concluded }, demo.front.concluding, SHORT_HOLD)
  }
  const asked = batchItems(batch).find((item) => item.speaker === '用户' && item.room.kind === '单聊' && demo.matches(item.body))
  if (asked === undefined) return undefined
  if (calls === 0) return step('dispatch', { items: [{ messages: [asked.id], action: 'open', ...demo.front.dispatch }] }, demo.front.think, SHORT_HOLD)
  if (calls === 1) return { tool: 'reply', args: { to: asked.id, text: result.includes('开了任务') ? demo.front.opened : `（测试模型）${result.slice(0, 240)}` } }
  return { text: demo.texts.said }
}

/**
 * 组长（群里的根任务）：先开「核心数据」（数据研究员）和「留存分析」（自己）两个子任务，报 waiting；
 * 子任务就绪一个验收一个；前两块都通过了再开「复盘看板」（设计师），看板也通过了就合成回答报 ready。
 */
function leader({ messages, userText, last, calls }, demo) {
  if (last?.role === 'tool' && calls.at(-1) === 'complete_task') return { text: demo.texts.ok }
  const opened = argsOf(messages, 'subtask').map((args) => args.title)
  const reviewed = new Set(argsOf(messages, 'review_subtask').map((args) => args.subtask))
  if (!userText.includes('[子任务')) {
    const [first, second] = demo.leader.subtasks
    if (opened.length === 0) return step('subtask', first, demo.leader.think)
    if (opened.length === 1) return step('subtask', second, undefined, SHORT_HOLD)
    return { tool: 'report', args: { status: 'waiting', summary: demo.leader.waiting } }
  }
  const ready = [...userText.matchAll(/\[子任务就绪\] 「([^」]*)」（(task_[0-9a-z]+)/g)].map((match) => ({ title: match[1], id: match[2] }))
  const pending = ready.find((item) => !reviewed.has(item.id))
  if (pending !== undefined) return step('review_subtask', { subtask: pending.id, pass: true, feedback: demo.texts.reviewed }, demo.leader.reviewing(pending.title), SHORT_HOLD)
  // 验收过的子任务按标题数：前两块都过了再开看板，看板也过了就交。
  const passed = argsOf(messages, 'review_subtask').length
  const dashboard = demo.leader.dashboard
  if (!opened.includes(dashboard.title)) {
    if (passed < demo.leader.subtasks.length) return { tool: 'report', args: { status: 'waiting', summary: demo.leader.waiting } }
    return step('subtask', dashboard, demo.leader.handoff)
  }
  if (calls.at(-1) === 'subtask') return { tool: 'report', args: { status: 'waiting', summary: demo.leader.waitingDashboard } }
  if (passed < demo.leader.subtasks.length + 1) return { tool: 'report', args: { status: 'waiting', summary: demo.leader.waitingDashboard } }
  return step('report', { status: 'ready', summary: demo.leader.answer, files: [] }, demo.leader.merging)
}

/** 系统提示里的任务文件夹（绝对路径）。 */
function folderOf(system) {
  return /文件写在你的任务文件夹 (.+?)\/ 里/.exec(system)?.[1] ?? ''
}

/**
 * 子任务（成员在群里干的那一块）：每一步先想一句再做。写文档的：记一条进展、写文件、再记一条进展、交回答；
 * 做页面的：记一条进展、save_page、交回答。交了以后这一轮就结束。
 */
function member({ system, brief, messages, last, calls, tools }, demo) {
  const work = demo.work.find((item) => brief.includes(item.brief))
  if (work === undefined) return undefined
  if (last?.role === 'tool' && calls.at(-1) === 'complete_task') return { text: demo.texts.submitted }
  const progress = argsOf(messages, 'report').filter((args) => args.status === 'progress').length
  const [firstStep, secondStep] = work.steps
  if (progress === 0) return step('report', { status: 'progress', summary: firstStep.done, checks: [1] }, firstStep.think)
  if (work.page !== undefined) {
    if (!calls.includes('save_page') && tools.has('save_page')) return step('save_page', work.page, secondStep.think)
    if (progress === 1) return step('report', { status: 'progress', summary: secondStep.done, checks: [2, 3] }, undefined, SHORT_HOLD)
    return step('report', { status: 'ready', summary: work.answer, files: [] }, work.finishing, SHORT_HOLD)
  }
  const folder = folderOf(system)
  if (!calls.includes('write') && tools.has('write') && folder !== '') return step('write', { file_path: `${folder}/${work.file}`, content: work.body }, secondStep.think)
  if (progress === 1) return step('report', { status: 'progress', summary: secondStep.done, checks: [2, 3] }, undefined, SHORT_HOLD)
  return step('report', { status: 'ready', summary: work.answer, files: [] }, work.finishing, SHORT_HOLD)
}

/**
 * 是演示就返回这一步做什么（think 是先想的那一句，hold 是想完停多久），不是返回 undefined。
 * context：system、messages、brief（任务的交代）、userText、calls（调过的工具名）、tools、last、result、page。
 * 前台（Super-agent）那段在 demoFront，浏览器那段在 demo-browser.js。
 */
export function demoDecision(context) {
  const { system, brief } = context
  const browsing = browserDemo(context)
  if (browsing !== undefined) return browsing
  if (!system.includes('你正在执行一个任务')) return undefined
  const demo = demoFor(system)
  if (!demo.matches(brief)) return undefined
  if (/这个任务在群「[^」]*」里，你是组长/.test(system)) return leader(context, demo)
  if (system.includes('的一个子任务，组长是')) return member(context, demo)
  return undefined
}
