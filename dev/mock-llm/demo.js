/**
 * 演示剧本（开发用，给 README 截图）：你让主管做「第三季度增长复盘」，主管组一个临时小组：
 * 数据研究员整理核心数据、增长分析师做留存分析（两块同时做），设计师等它们交了再做一页看板；
 * 主管当组长逐个验收，合并成一份复盘交付。数字都是编的示例数据。
 * 任务会话每一步停一会儿（decision.pause），任务卡上看得到进度一格一格往前走。
 * 剧本的文字和数字在 demo-zh.js、demo-en.js：dsh-bot 设成英文时（系统提示里有英文说明）用英文版。
 */

import { browserDemo } from './demo-browser.js'
import { DEMO_EN } from './demo-en.js'
import { DEMO_ZH } from './demo-zh.js'
import { isEnglish } from './language.js'

const STEP_PAUSE = 3000
const REVIEW_PAUSE = 1500

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
function executor({ system, brief, calls, tools, last }, demo) {
  // 英文的任务标题带空格，取到行尾。
  const title = /任务：(.+)/.exec(brief)?.[1]?.trim() ?? ''
  const folder = /任务文件夹：(.+?)\/（/.exec(brief)?.[1] ?? ''
  const root = workspaceRoot(system)
  if (last?.role === 'tool' && calls.at(-1) === 'complete_task') return { text: demo.texts.submitted }
  const updates = calls.filter((name) => name === 'update_task').length

  if (title === demo.dashboard.title) {
    if (updates === 0) return step('update_task', { note: demo.dashboard.start })
    if (!calls.includes('save_page') && tools.has('save_page')) return step('save_page', demo.dashboard.page)
    if (updates === 1) return step('update_task', { check: [1, 2, 3], note: demo.dashboard.done })
    return step('complete_task', { ...demo.dashboard.result, files: [], skipped: [] })
  }

  const plan = demo.subtasks[title]
  if (plan === undefined) return undefined
  const path = `${folder}/${plan.file}`
  if (updates === 0) return step('update_task', { check: [1], note: plan.start })
  if (!calls.includes('write') && tools.has('write') && folder !== '') return step('write', { file_path: path, content: plan.body })
  if (updates === 1) return step('update_task', { check: [2, 3], note: plan.checked })
  return step('complete_task', { ...plan.result, files: [relative(root, path)], skipped: [] })
}

/** 组长：逐个验收，全部通过后合并成一份复盘放进 shared/，再交付。 */
function coordinator({ system, userText, messages, calls, tools, last }, demo) {
  if (last?.role === 'tool' && (calls.at(-1) === 'review_task' || calls.at(-1) === 'deliver_task')) return { text: demo.texts.ok }
  if (userText.includes('[子任务提交]')) {
    const key = /（(s\d+)，负责人/.exec(userText)?.[1] ?? 's1'
    return step('review_task', { subtask: key, pass: true, feedback: demo.texts.reviewed }, REVIEW_PAUSE)
  }
  if (!userText.includes('[全部子任务已通过]')) return undefined
  const root = workspaceRoot(system)
  const files = [...new Set([...JSON.stringify(messages).matchAll(/文件：([^\\"]+?\.md)/g)].map((match) => match[1]))]
  const merged = `${root}/${demo.merged.file}`
  if (!calls.includes('write') && tools.has('write') && root !== '') return step('write', { file_path: merged, content: demo.merged.body }, REVIEW_PAUSE)
  return step(
    'deliver_task',
    {
      summary: demo.summary,
      files: [relative(root, merged), ...files.filter((file) => !file.startsWith('shared/'))],
      assumptions: [demo.assumption],
      unverified: [demo.notYet],
      skipped: [],
    },
    REVIEW_PAUSE,
  )
}

/** 主管：收到“增长复盘”就组队；组好以后用一句话说明分工。 */
function lead({ userText, calls, tools, last, result }, demo) {
  if (!demo.matches(userText)) return undefined
  if (last?.role === 'tool' && calls.at(-1) === 'create_task') {
    if (result?.ok === false) return { text: demo.texts.failed(result.message ?? '') }
    return { text: demo.texts.kickoff }
  }
  if (tools.has('create_task') && !calls.includes('create_task')) return step('create_task', demo.plan, 800)
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
  const demo = isEnglish(system) ? DEMO_EN : DEMO_ZH
  if (system.includes('你正在执行一个任务')) return demo.matches(brief) ? executor(context, demo) : undefined
  if (system.includes('你是这个根任务的组长')) return demo.matches(JSON.stringify(messages)) ? coordinator(context, demo) : undefined
  if (system.includes('你是主管')) return lead(context, demo)
  return undefined
}
