/**
 * 开发用的脚本化模型：provider 是 pod-mock，模型是 scripted。
 * 它不调用任何外部服务，只按会话的系统提示和最后一条消息决定回复或调用哪个 Pod 工具，
 * 用来在没有模型账号的隔离环境里跑通主管委派、任务会话、等你处理和交付。
 */

import { demoDecision } from './demo.js'
import { newPage, pageDecision, wantedKind } from './pages.js'
import { progressDecision, routineDecision, turnCalls } from './progress.js'
import { batchBody, frontDecision, frontOwnText } from './front.js'

export const name = 'pod-dev-mock-llm'

export const inject = ['llm']

const PROVIDER = 'pod-mock'
const MODEL = 'scripted'

function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content.filter((block) => block && block.type === 'text').map((block) => block.text).join('')
}

function toolCalls(messages) {
  return messages
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .filter((block) => block && block.type === 'tool-call')
    .map((block) => (block.name === 'report' ? { ...block, name: legacyReportName(block) } : block))
}

/**
 * 任务会话的 update_task、complete_task、ask_owner 换成了一个 report：剧本照旧按旧名字写，
 * 这里把 report 的调用认回旧名字，把剧本给出的旧调用翻成 report。
 */
function legacyReportName(block) {
  let status = ''
  try {
    status = JSON.parse(typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments ?? {})).status ?? ''
  } catch {
    status = ''
  }
  return status === 'progress' ? 'update_task' : status === 'blocked' ? 'ask_owner' : 'complete_task'
}

const LEGACY_TASK_TOOLS = ['update_task', 'complete_task', 'ask_owner']

function asReport(decision) {
  const args = decision.args ?? {}
  if (decision.tool === 'update_task') return { ...decision, tool: 'report', args: { status: 'progress', summary: args.note || '更新进度', checks: args.check ?? [] } }
  if (decision.tool === 'ask_owner') {
    return { ...decision, tool: 'report', args: { status: 'blocked', summary: args.question, report: args.detail || args.question, question: args.question, question_kind: args.kind } }
  }
  const summary = String(args.summary ?? '')
  const files = args.files ?? []
  const unverified = args.unverified ?? []
  // 交的就是一条完整回答：没核实的写在回答末尾，文件只在要的东西本身是文件时附上。
  const answer = [summary, unverified.length === 0 ? '' : `没核实：${unverified.join('；')}`].filter(Boolean).join('\n\n')
  return { ...decision, tool: 'report', args: { status: 'ready', summary: answer, files } }
}

/** 真正有意义的用户消息：你说的话、bot 之间的转达、Pod 的提醒；跳过时间注入这类上下文。 */
const MEANINGFUL = new Set(['user', 'agent-message', 'pod'])

function lastOf(messages, role) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== role) continue
    if (role === 'user' && !MEANINGFUL.has(message.source?.kind)) continue
    return message
  }
  return undefined
}

/** 工具结果是 { ok, message, ... } 的 JSON：取出 message。 */
function toolMessage(message) {
  const raw = textOf(message.content)
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed.message === 'string' ? parsed.message : raw
  } catch {
    return raw
  }
}

/** 工具结果解析成对象（{ ok, message, ... }）；不是 JSON 时只有 message。 */
function parsedResult(message) {
  try {
    return JSON.parse(textOf(message.content))
  } catch {
    return { message: textOf(message.content) }
  }
}

/** 最后一个工具结果的文字。 */
function lastToolText(messages) {
  const tool = messages.filter((message) => message.role === 'tool').at(-1)
  return tool === undefined ? '' : toolMessage(tool)
}

/** 最近一次带页面内容的工具结果（browser_open、browser_snapshot 等）。 */
function lastPage(messages) {
  const tool = messages.filter((message) => message.role === 'tool' && toolMessage(message).includes('[页面内容')).at(-1)
  return tool === undefined ? '' : toolMessage(tool)
}

/** 浏览器任务的剧本：打开、填表（密码会被拦）、点提交（要审批）、请求接管、提取正文。 */
function browserTask(brief, userText, messages, calls) {
  const url = /(https?:\/\/[^\s，。"]+)/.exec(brief)?.[1] ?? 'https://example.com/'
  const done = (summary) => ({ tool: 'complete_task', args: { summary, files: [], assumptions: ['测试环境'], unverified: [], skipped: [] } })
  if (userText.includes('[用户批准了')) return done('- 提交成功（用户批准后由 dsh-bot 执行）')
  if (userText.includes('[用户没有批准') || userText.includes('[审批作废')) return done('- 用户没有批准提交，没有提交')
  if (userText.includes('[用户交还了') || userText.includes('[用户对「接管浏览器')) {
    if (!calls.slice(-3).includes('browser_snapshot')) return { tool: 'browser_snapshot', args: {} }
    return done('- 用户接管登录后继续完成了')
  }
  if (userText.includes('[用户允许了') && !lastToolText(messages).startsWith('已输入')) return { tool: 'browser_type', args: { ref: /\[(e\d+)\] textbox "备注"/.exec(lastPage(messages))?.[1] ?? 'e1', text: '联系 alice@example.com' } }
  if (!calls.includes('browser_open')) return { tool: 'browser_open', args: { url, fresh: true } }
  const last = lastToolText(messages)
  if (brief.includes('浏览器登录')) {
    if (!calls.includes('request_takeover')) return { tool: 'request_takeover', args: { reason: '这个页面要登录' } }
    return { text: '已经请用户接管登录，等用户交还。' }
  }
  if (brief.includes('提取')) {
    if (!calls.includes('browser_extract')) return { tool: 'browser_extract', args: {} }
    if (!calls.includes('browser_screenshot')) return { tool: 'browser_screenshot', args: {} }
    return done(`- 提取了正文\n- ${last.slice(0, 60)}`)
  }
  if (brief.includes('填表')) {
    const page = lastPage(messages)
    const note = /\[(e\d+)\] textbox "备注"/.exec(page)?.[1]
    const password = /\[(e\d+)\] textbox "密码"/.exec(page)?.[1]
    const submit = /\[(e\d+)\] button "提交订单"/.exec(page)?.[1]
    const typed = calls.filter((name) => name === 'browser_type').length
    if (last.includes('已拦下交给用户判断')) return { text: '等用户判断。' }
    if (typed === 0 && note !== undefined) return { tool: 'browser_type', args: { ref: note, text: brief.includes('外传') ? '联系 alice@example.com' : '测试备注' } }
    if (typed === 1 && password !== undefined) return { tool: 'browser_type', args: { ref: password, text: 'hunter2' } }
    if (!calls.includes('browser_click') && submit !== undefined) return { tool: 'browser_click', args: { ref: submit } }
    if (last.includes('已提交给用户审批')) return { text: '等用户批准提交。' }
  }
  return done('- 浏览器任务完成')
}

/** 看门狗的剧本：同样的参数连着调 3 次 bash（代码看门狗报警），再一步步等看门狗的判断；收到提醒就换做法交结果。 */
function watchdogTask(userText, calls) {
  if (userText.includes('[看门狗提醒]')) return { tool: 'complete_task', args: { summary: '- 按看门狗的提醒换了做法，做完了', files: [], assumptions: [], unverified: [], skipped: [] } }
  const count = calls.filter((name) => name === 'bash').length
  if (count < 3) return { tool: 'bash', args: { description: '查一下', command: 'echo 看门狗测试' } }
  if (count < 10) return { tool: 'bash', args: { description: '等一会儿', command: `sleep 2; echo 第 ${count} 次` } }
  return { tool: 'complete_task', args: { summary: '- 等了一会儿没收到看门狗的提醒，先交结果', files: [], assumptions: [], unverified: [], skipped: [] } }
}

/**
 * 看门狗的判断和诊断：任务来由里有“看门狗受阻”判受阻，有“测试看门狗”给提醒，其余继续；诊断说两句。都引用最后一个事件 id。
 */
function watchdogDecision(system, messages) {
  const facts = textOf(messages.find((message) => message.role === 'user')?.content)
  const ids = [...facts.matchAll(/^- #(\d+) /gm)].map((match) => Number(match[1]))
  const cited = ids.at(-1)
  const cite = cited === undefined ? '' : `（#${cited}）`
  if (system.includes('用户或前台在问')) {
    const calling = /正在调用「([^」]+)」/.exec(facts)?.[1]
    return { text: `（测试模型）${calling === undefined ? '现在没有在跑的调用' : `正在调用「${calling}」`}${cite}，没看到卡死的迹象。再等一会儿，半小时还没汇报就点重试。` }
  }
  const verdict = facts.includes('看门狗受阻') ? 'blocked' : facts.includes('测试看门狗') ? 'remind' : 'continue'
  const reason = verdict === 'blocked' ? `测试：要登录才能接着做${cite}` : verdict === 'remind' ? `测试：一直在重复同一个命令${cite}` : `测试：命令在跑${cite}`
  return { text: JSON.stringify({ verdict, reason, hint: verdict === 'remind' ? '别再重复同一个命令了，换个做法，先把已有的结果交上来。' : '', events: cited === undefined ? [] : [cited] }) }
}

/** 后台命令的剧本：放一个要跑一会儿的命令到后台就结束这一轮；跑完被 dsh 叫醒后读输出、提交。 */
function backgroundTask(messages, calls) {
  const since = messages.findLastIndex((message) => message.role === 'assistant')
  const notice = messages.slice(since + 1).find((message) => message.role === 'user' && message.source?.kind === 'tool-jobs')
  if (notice !== undefined) return { tool: 'job_output', args: { job_id: /background job (\S+)/.exec(textOf(notice.content))?.[1] ?? '' } }
  if (calls.at(-1) === 'job_output') {
    return { tool: 'complete_task', args: { summary: `- 后台命令跑完了：${lastToolText(messages).slice(0, 60)}`, files: [], assumptions: ['测试环境'], unverified: [], skipped: [] } }
  }
  if (!calls.includes('bash')) return { tool: 'bash', args: { description: '跑一个要一会儿的命令', command: 'sleep 8; echo 后台命令跑完了', run_in_background: true } }
  return { text: '命令放到后台了，跑完再接着做。' }
}

/**
 * 用电脑的剧本：start（第一次要你批准，批准后再 start）→ 在后台打开备忘录 → 看它的窗口，然后停下来让你在电脑面板上看画面、接管；
 * 你交还以后再看一眼窗口、stop、交结果。
 */
function computerTask(userText, messages, calls, tools) {
  const app = '备忘录'
  const call = (action, args, thinking) => ({ tool: 'computer_use', args: { action, args, thinking } })
  const actions = toolCalls(messages)
    .filter((block) => block.name === 'computer_use')
    .map((block) => {
      try {
        return JSON.parse(typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments ?? {})).action
      } catch {
        return ''
      }
    })
  const result = lastToolText(messages)
  if (messages.at(-1)?.role === 'tool' && calls.at(-1) === 'computer_use') {
    const action = actions.at(-1)
    if (action === 'start') {
      if (result.includes('开始了')) return call('open_app', { app }, `在后台打开${app}`)
      if (result.includes('批准')) return tools.has('report') ? { tool: 'report', args: { status: 'waiting', summary: '等用户批准用电脑' } } : { text: '等你批准用电脑。' }
      return { text: `用不了电脑：${result.slice(0, 120)}` }
    }
    if (action === 'open_app') return call('get_app_state', { app }, `看${app}的窗口`)
    if (action === 'get_app_state') {
      if (actions.filter((item) => item === 'get_app_state').length >= 2) return call('stop', {}, '用完了，把电脑交还')
      const note = `看到${app}的窗口了。先停在这里：你可以在电脑面板上看画面、接管，交还后我再接着做。`
      return tools.has('report') ? { tool: 'report', args: { status: 'waiting', summary: note } } : { text: note }
    }
    if (action === 'stop') return { tool: 'complete_task', args: { summary: `- 用电脑看了${app}的窗口`, files: [], assumptions: ['测试环境'], unverified: [], skipped: [] } }
    return { text: result.slice(0, 120) }
  }
  if (userText.includes('[用户交还了电脑]')) return call('get_app_state', { app }, '交还后重新看一眼窗口')
  return call('start', { apps: [app], reason: '测试用电脑：看一眼备忘录的窗口' }, '开始用电脑')
}

/** 只看用户自己说的部分：去掉换段时的交接笔记前言和附在后面的相关记忆。 */
/** 换段时消息前面有一段说明，真正的话在最后一个“[谁的新消息]”后面。 */
function withoutPreface(text) {
  const marker = [...text.matchAll(/\[[^\]\n]*的新消息\]\n/g)].at(-1)
  return marker === undefined ? text : text.slice((marker.index ?? 0) + marker[0].length)
}

/**
 * 组长（根任务的会话）的剧本：任务说明里有“组个团队”时开两个子任务（「A 公司」交给名册里第一个 bot，「B 公司」交给自己），
 * 报 waiting；子任务就绪时逐个验收（「B 公司」第一次打回，返工后通过）；受阻的答复，失败的停掉；都结束了交结果。
 */
function leaderDecision({ brief, userText, messages, tools, last, system }) {
  if (!tools.has('subtask') || !/组个团队|组队/.test(brief)) return undefined
  const all = toolCalls(messages)
  const names = all.map((call) => call.name)
  const start = messages.findLastIndex((message) => message.role === 'user' && MEANINGFUL.has(message.source?.kind))
  const turn = toolCalls(messages.slice(start + 1))
  if (!userText.includes('[子任务')) {
    if (userText.includes('[直通消息') || userText.includes('[接着说')) return undefined
    const opened = names.filter((name) => name === 'subtask').length
    if (opened === 0) return { tool: 'subtask', args: { title: 'A 公司', bot: firstRosterName(system) ?? '自己', brief: '查 A 公司的公开定价，写进 A.md', acceptance: ['列出版本', '写清价格'] } }
    if (opened === 1 && turn.length > 0) return { tool: 'subtask', args: { title: 'B 公司', bot: '自己', brief: '查 B 公司的公开定价，写进 B.md', acceptance: ['列出版本', '写清价格', '写主要限制'] } }
    if (turn.length > 0) return { tool: 'report', args: { status: 'waiting', summary: '子任务开好了，等它们交上来' } }
    return undefined
  }
  const ready = [...userText.matchAll(/\[子任务就绪\] 「([^」]*)」（(task_[0-9a-z]+)/g)].map((match) => ({ title: match[1], id: match[2] }))
  for (const item of ready) {
    if (turn.some((call) => call.name === 'review_subtask' && call.arguments.includes(item.id))) continue
    const rejected = all.some((call) => call.name === 'review_subtask' && call.arguments.includes(item.id) && call.arguments.includes('false'))
    if (item.title === 'B 公司' && !rejected) return { tool: 'review_subtask', args: { subtask: item.id, pass: false, feedback: '缺“主要限制”一列，补上' } }
    return { tool: 'review_subtask', args: { subtask: item.id, pass: true } }
  }
  const blocked = /\[子任务受阻\] 「[^」]*」（(task_[0-9a-z]+)/.exec(userText)?.[1]
  if (blocked !== undefined && !turn.some((call) => call.name === 'tell_subtask')) return { tool: 'tell_subtask', args: { subtask: blocked, text: '按中国区公开报价做' } }
  const failed = /\[子任务没做成\] 「[^」]*」（(task_[0-9a-z]+)/.exec(userText)?.[1]
  if (failed !== undefined && !turn.some((call) => call.name === 'stop_subtask')) return { tool: 'stop_subtask', args: { subtask: failed } }
  if (last?.role === 'tool' && lastToolText(messages).includes('子任务都结束了')) {
    return { tool: 'complete_task', args: { summary: '- 两家的定价都查完了，汇总在 shared/对比.md', files: ['shared/对比.md'], assumptions: ['只看了测试数据'], unverified: [], skipped: [] } }
  }
  return { tool: 'report', args: { status: 'waiting', summary: '还有子任务在做，等它们交上来' } }
}

/** 群聊里转来的一句话：谁说的、有没有 @ 你、正文和现在的成员。 */
function groupMessage(text) {
  const head = /^\[([^\]\n]+?)在群聊「[^」\n]*」里(@了你|说)\]\n/.exec(text)
  if (head === null) return undefined
  const rest = text.slice(head[0].length)
  const ends = ['\n\n[最近的群聊', '\n\n[群成员]', '\n\n[进度快照]', '\n\n[相关记忆'].map((mark) => rest.indexOf(mark)).filter((index) => index >= 0)
  const body = ends.length === 0 ? rest : rest.slice(0, Math.min(...ends))
  const members = (/\n\[群成员\] ([^\n]+)/.exec(rest)?.[1] ?? '').split('、').filter(Boolean)
  return { speaker: head[1], mentioned: head[2] === '@了你', body, members }
}

function ownText(text) {
  const body = withoutPreface(text)
  const group = groupMessage(body)
  if (group !== undefined) return group.body
  const hint = body.indexOf('\n\n[相关记忆')
  return hint === -1 ? body : body.slice(0, hint)
}

/**
 * 群聊：用户让你“@ 一下某某”就用 mention_member；“接力”用来测 bot 之间点名的上限；
 * “介绍”只在文字里写 @名字（不该通知任何人）；被别的成员 @ 了就在群里直接回答。
 */
function groupDecision(system, messages, last, calls) {
  if (last?.role === 'tool' && calls.at(-1) === 'mention_member') {
    // 点名成功时这一轮已经结束，走到这里的都是没点成的。
    const result = lastToolText(messages)
    return { text: result.startsWith('已经') ? '好，已经在群里叫了。' : `（测试模型）直接回复：收到，我在。（没有 @ 回去：${result.slice(0, 40)}）` }
  }
  if (last?.role === 'tool' && calls.at(-1) === 'ask_bot') return { text: `ask_bot 的结果：${lastToolText(messages)}` }
  const frame = groupMessage(withoutPreface(textOf(lastOf(messages, 'user')?.content)))
  if (frame === undefined) return undefined
  const self = /你在 dsh-bot 里的名字是「([^」]+)」/.exec(system)?.[1] ?? ''
  const asked = /@ ?一下\s*([^\s，。,、：:]+)/.exec(frame.body)?.[1]
  // 故意在 message 里也写上 @名字，看 Pod 会不会去掉重复的 @。
  if (asked !== undefined && frame.speaker === '用户') return { tool: 'mention_member', args: { members: [asked], message: `@${asked} 用户找你，在群里应一声：${frame.body.slice(0, 60)}` } }
  // 学真实模型的毛病：被 @ 了又 @ 回去应声。Pod 应该拦下，让它直接回复。
  if (frame.speaker !== '用户' && frame.body.includes('应一声')) return { tool: 'mention_member', args: { members: [frame.speaker], message: '收到，我在' } }
  const secret = /私下问\s*([^\s，。,、：:]+)/.exec(frame.body)?.[1]
  if (secret !== undefined) return { tool: 'ask_bot', args: { bot: secret, question: '私下问一句：这段代码有问题吗？' } }
  if (frame.body.includes('接力')) {
    const next = frame.members.find((name) => name !== self && name !== frame.speaker) ?? frame.members.find((name) => name !== self)
    if (next !== undefined) return { tool: 'mention_member', args: { members: [next], message: '接力：轮到你了' } }
  }
  if (frame.body.includes('介绍')) {
    const others = frame.members.filter((name) => name !== self)
    return { text: `群里的分工：\n\n${others.map((name) => `- @${name} → 找它做它擅长的事`).join('\n')}\n- 不 @ 谁 → 我来回答` }
  }
  if (frame.speaker !== '用户') return { text: `（测试模型）我是${self}，收到${frame.speaker}在群里的话：${frame.body.slice(0, 80)}` }
  return undefined
}

/** 系统提示可能在 options.system，也可能是消息列表里的 system 消息。 */
function systemOf(options, messages) {
  const inline = typeof options.system === 'string' ? options.system : ''
  return [inline, ...messages.filter((message) => message.role === 'system').map((message) => textOf(message.content))].join('\n')
}

/** 名册里第一个 bot 的名字：系统提示里“Pod 里的其他 bot”下面紧跟的“- 名字（角色）”那几行。 */
function firstRosterName(system) {
  const lines = system.split('\n')
  const start = lines.findIndex((line) => line.startsWith('dsh-bot 里的其他 bot'))
  if (start < 0) return undefined
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('- ')) break
    const name = line.slice(2).split(/[（；(]/)[0].trim()
    if (name !== '') return name
  }
  return undefined
}

function rosterNames(system) {
  const lines = system.split('\n')
  const start = lines.findIndex((line) => line.startsWith('dsh-bot 里的其他 bot'))
  if (start < 0) return []
  const names = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('- ')) break
    names.push(line.slice(2).split(/[（；(]/)[0].trim())
  }
  return names
}

/**
 * 群聊分派：按“用户的新消息”和每个成员那一行（职责、能力）里相同的两字词打分，挑分最高的成员；
 * 要新建 bot、拉人，或者谁都对不上时交给最后一行的主管。只是测试用的粗略打分。
 */
function routeTarget(prompt) {
  const lines = prompt.split('\n')
  const start = lines.findIndex((line) => line.endsWith('的成员：'))
  const people = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('- ')) break
    const [name, ...rest] = line.slice(2).split('：')
    people.push({ name: name.trim(), about: rest.join('：') })
  }
  const lead = people.at(-1)?.name ?? '主管'
  const message = lines[lines.indexOf('用户的新消息：') + 1] ?? ''
  if (/新建|拉进|拉个群|组队/.test(message)) return lead
  const grams = (text) => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, index) => text.slice(index, index + 2)).filter((gram) => !/[\s，。、：；（）]/.test(gram)))
  const wanted = grams(message)
  const scored = people.slice(0, -1).map((person) => ({ name: person.name, score: [...grams(person.about)].filter((gram) => wanted.has(gram)).length }))
  const best = scored.sort((left, right) => right.score - left.score)[0]
  return best !== undefined && best.score > 0 ? best.name : lead
}

/** 决定这一步做什么：说一段话，或者调用一个工具。 */
function decide(options) {
  const messages = Array.isArray(options.messages) ? options.messages : []
  const system = systemOf(options, messages)
  const last = messages.filter((message) => message.role !== 'system' && !(message.role === 'user' && !MEANINGFUL.has(message.source?.kind))).at(-1)
  const userText = ownText(textOf(lastOf(messages, 'user')?.content))
  const calls = toolCalls(messages).map((call) => call.name)
  const tools = new Set((options.tools ?? []).map((tool) => tool.name))
  if (tools.has('report')) for (const name of LEGACY_TASK_TOOLS) tools.add(name)
  // 开工说明里讲怎么汇报的几段（提到“报告”）不算任务内容，免得剧本按关键词误判成做报告页。
  const brief = textOf(messages.find((message) => message.role === 'user' && MEANINGFUL.has(message.source?.kind))?.content)
    .split('\n\n')
    .filter((part) => !part.includes('report'))
    .join('\n\n')
  if (process.env.POD_MOCK_DEBUG === '1') console.error('[mock]', JSON.stringify(userText.slice(0, 40)), [...tools].join(','))

  if (system.includes('你是群聊里的分派器')) return { text: JSON.stringify({ to: routeTarget(textOf(messages.find((message) => message.role === 'user')?.content)) }) }
  if (system.includes('你是 dsh-bot 的看门狗')) return watchdogDecision(system, messages)

  // 前台：消息成批送来，逐条记去向。出错后接着处理时，从最近一批开始数调过的工具。
  if (tools.has('dispatch')) {
    const isUser = (message) => message.role === 'user' && MEANINGFUL.has(message.source?.kind)
    const batchAt = messages.findLastIndex((message) => isUser(message) && batchBody(textOf(message.content)) !== undefined)
    const retry = userText.startsWith('[dsh-bot] 刚才模型服务出错')
    const from = retry ? batchAt : messages.findLastIndex(isUser)
    const made = messages
      .slice(from + 1)
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .filter((block) => block && block.type === 'tool-call').length
    return frontDecision({ system, userText, tools, calls: made, result: lastToolText(messages), batch: batchAt < 0 ? '' : textOf(messages[batchAt].content), roster: rosterNames(system) })
  }

  const lastTool = messages.filter((message) => message.role === 'tool').at(-1)
  const demo = demoDecision({ system, messages, brief, userText, calls, tools, last, result: lastTool === undefined ? undefined : parsedResult(lastTool), page: lastPage(messages) })
  if (demo !== undefined) return demo

  const turn = turnCalls(messages, (message) => message.role === 'user' && MEANINGFUL.has(message.source?.kind))
  const scripted = progressDecision({ userText, turn, tools }) ?? routineDecision({ userText, turn, tools, result: lastToolText(messages) })
  if (scripted !== undefined) return scripted

  if (system.includes('你正在执行一个任务')) {
    if (last?.role === 'tool' && calls.at(-1) === 'complete_task') return { text: '已经提交了。' }
    if (last?.role === 'tool' && calls.at(-1) === 'ask_owner') return { text: '已经请用户处理，等用户答复后接着做。' }
    const leading = leaderDecision({ brief, userText, messages, tools, last, system })
    if (leading !== undefined) return leading
    // 送进来的消息：写着“（测试交还）”的交还；别处话题直通的先确认，任务对话里接着说的不用确认，直接照做。
    const routedIds = [...userText.matchAll(/\[直通消息 (msg_[0-9a-f]+)\]/g)].map((match) => match[1])
    const talkIds = [...userText.matchAll(/\[接着说 (msg_[0-9a-f]+)\]/g)].map((match) => match[1])
    const fresh = last?.role !== 'tool'
    if (routedIds.length + talkIds.length > 0 && fresh && userText.includes('（测试交还）') && tools.has('handback')) {
      return { tool: 'handback', args: { message_id: routedIds[0] ?? talkIds[0], reason: '这件事不归这个任务', unfollow: false } }
    }
    if (routedIds.length > 0 && tools.has('ack') && fresh) return { tool: 'ack', args: { message_ids: routedIds } }
    if (last?.role === 'tool' && calls.at(-1) === 'handback') return { tool: 'report', args: { status: 'waiting', summary: '交还了一条不归这个任务的消息' } }
    // 能照着做了：直通的确认过了，或者是任务对话里接着说的。
    const said = (last?.role === 'tool' && calls.at(-1) === 'ack') || (talkIds.length > 0 && fresh)
    const saidIds = routedIds.length > 0 ? routedIds : talkIds
    // 暂停着时用户说话：只回话，记下交代，报 waiting，不接着做。
    if (userText.includes('这个任务暂停着') && said && tools.has('reply')) {
      return { tool: 'reply', args: { to: saidIds[0] ?? '', text: '（测试模型）任务暂停着，先记下你的话；你说接着做我再动手。' } }
    }
    if (userText.includes('这个任务暂停着') && last?.role === 'tool' && calls.at(-1) === 'reply' && tools.has('report')) return { tool: 'report', args: { status: 'waiting', summary: '暂停着，只回了话' } }
    // 直通消息写着“再问一遍”：把拿主意的问题原样再报一次（dsh-bot 不该再出一张卡片）；“换个问题”：换一个问题问（旧卡片收起）。
    if (said && /再问一遍|换个问题/.test(userText) && tools.has('report')) {
      const changed = userText.includes('换个问题')
      return {
        tool: 'report',
        args: {
          status: 'blocked',
          summary: changed ? '方案定了，还差一个：周报发给谁' : '有两种做法，要你选一个',
          report: '## 要你做什么\n选一个',
          question: changed ? '周报发给团队还是只发给你？' : '用方案 A（快）还是方案 B（全）？',
          question_kind: 'ambiguity',
          options: changed ? ['发给团队', '只发给我'] : ['方案 A', '方案 B'],
          option_notes: changed ? ['全组都能看到', '先给你看过再说'] : ['半小时内出结果，只看主要来源', '要两三个小时，能找到的来源都看一遍'],
          recommended: true,
        },
      }
    }
    if (said) {
      // 送进来的话里问问题（写着“测试答复”）：用 reply 答在那条下面，再报 waiting。
      if (userText.includes('测试答复') && tools.has('reply')) return { tool: 'reply', args: { to: saidIds[0], text: '（测试模型）做到第 2 步了，再过几分钟交结果。' } }
      return { tool: 'complete_task', args: { summary: '- 按直通进来的消息改好了', files: ['shared/测试结果.md'], assumptions: [], unverified: [], skipped: [] } }
    }
    if (last?.role === 'tool' && calls.at(-1) === 'reply' && tools.has('report')) return { tool: 'report', args: { status: 'waiting', summary: '答复了用户的问题，接着等' } }
    if (last?.role === 'tool' && calls.at(-1) === 'report') return { text: '已经汇报了。' }
    // 写着“定时叫醒”的：先给自己挂 1 分钟后的叫醒，报 waiting；到点醒来（开始新的一次执行）照常交结果。
    if (brief.includes('定时叫醒') && tools.has('wake_me') && !userText.includes('开始新的一次执行')) {
      if (!calls.includes('wake_me')) return { tool: 'wake_me', args: { in_minutes: 1, note: '看看服务起来没有' } }
      return { tool: 'report', args: { status: 'waiting', summary: '挂了 1 分钟后的叫醒，到点再看服务起来没有' } }
    }
    // 例程里写着“没新东西”“没有变化”的：到点醒来报 dismissed，不发消息。
    if (/没新东西|没有变化/.test(brief) && userText.includes('开始新的一次执行') && last?.role !== 'tool' && tools.has('report')) {
      return { tool: 'report', args: { status: 'dismissed', summary: '这次没有新东西' } }
    }
    if (brief.includes('看门狗') && !userText.includes('开始新的一次执行') && tools.has('bash')) return watchdogTask(userText, calls)
    if (brief.includes('用电脑') && tools.has('computer_use')) return computerTask(userText, messages, calls, tools)
    if (brief.includes('浏览器') && tools.has('browser_open')) return browserTask(brief, userText, messages, calls)
    if (brief.includes('后台命令') && tools.has('bash')) return backgroundTask(messages, calls)
    const pageKind = tools.has('save_page') ? wantedKind(brief) : undefined
    if (pageKind !== undefined && !calls.includes('save_page')) return newPage(pageKind)
    if (pageKind !== undefined && calls.at(-1) === 'save_page' && tools.has('complete_task')) {
      return { tool: 'complete_task', args: { summary: `- 做好了页面：${lastToolText(messages).split('，页面卡片')[0]}`, files: [], assumptions: ['用的是示例数据'], unverified: [], skipped: [] } }
    }
    if (brief.includes('沉淀') && tools.has('save_skill') && !calls.includes('save_skill')) {
      const script = brief.includes('脚本')
      return {
        tool: 'save_skill',
        args: { name: script ? 'test-script-skill' : 'test-skill', title: script ? '测试脚本技能' : '测试技能', when: '测试的时候', steps: script ? ['运行脚本：\n```bash\necho hi\n```'] : ['第一步', '第二步'], pitfalls: ['小心'] },
      }
    }
    if (brief.includes('咨询') && !calls.includes('ask_bot') && tools.has('ask_bot')) {
      return { tool: 'ask_bot', args: { bot: firstRosterName(system) ?? '主管', question: '这个任务你有什么建议？' } }
    }
    if (brief.includes('需要登录') && !calls.includes('ask_owner') && tools.has('ask_owner')) {
      return { tool: 'ask_owner', args: { kind: 'login', question: '需要登录 example.com 才能看到价格', detail: '登录页在 https://example.com/login', bypassed: false } }
    }
    if (brief.includes('拿主意') && !/开始新的一次执行|\[用户对|\[用户原话\]/.test(userText) && !calls.includes('report') && tools.has('report')) {
      return {
        tool: 'report',
        args: {
          status: 'blocked',
          summary: '有两种做法，要你选一个',
          report: '## 结论\n有两种做法，结果方向不同\n\n## 要你做什么\n选方案 A 或方案 B',
          question: '用方案 A（快）还是方案 B（全）？',
          question_kind: 'ambiguity',
          options: ['方案 A', '方案 B'],
          option_notes: ['半小时内出结果，只看主要来源', '要两三个小时，能找到的来源都看一遍'],
          recommended: true,
        },
      }
    }
    if (brief.includes('要批准') && !/开始新的一次执行|\[用户对|\[用户原话\]/.test(userText) && !calls.includes('report') && tools.has('report')) {
      return {
        tool: 'report',
        args: {
          status: 'blocked',
          summary: '在 web-01 上新建这个文件：每天切一次，压缩旧的，留 30 天；改完先用 logrotate -d 检查一遍。\n\n```\n/var/log/nginx/*.log {\n  daily\n  rotate 30\n  compress\n}\n```',
          report: '## 结论\n要改服务器上的配置，等用户批准',
          question: '写入 /etc/logrotate.d/nginx',
          question_kind: 'write',
        },
      }
    }
    if (brief.includes('测试失败') && !userText.includes('开始新的一次执行') && !calls.includes('report') && tools.has('report')) {
      return { tool: 'report', args: { status: 'failed', summary: '没做成：测试网站一直打不开。换个来源就点重试，不要了点停止。', report: '## 结论\n没做成，测试网站一直打不开\n\n## 怎么验证的\n试了 3 次都超时\n\n## 要你做什么\n换个来源就点重试，不要了点停止' } }
    }
    if (userText.includes('[组长打回]') || userText.includes('组长验收没通过')) {
      return { tool: 'complete_task', args: { summary: '- 按组长意见补上了主要限制', files: ['B.md'], assumptions: [], unverified: [], skipped: [] } }
    }
    if (userText.includes('开始新的一次执行') && last?.role !== 'tool') {
      const why = /开工原因：([^。\n]*)/.exec(userText)?.[1] ?? '接着做'
      return { tool: 'complete_task', args: { summary: `- 按这次的开工原因（${why}）接着做完了`, files: ['shared/测试结果.md'], assumptions: [], unverified: [], skipped: [] } }
    }
    if (userText.includes('[用户对') || userText.includes('[dsh-bot 提醒]')) {
      return { tool: 'complete_task', args: { summary: '- 测试任务完成\n- 用户的答复已经采纳', files: ['shared/测试结果.md'], assumptions: ['只做了测试范围内的事'], unverified: [], skipped: [] } }
    }
    if (!calls.includes('update_task') && tools.has('update_task')) return { tool: 'update_task', args: { check: [1], note: '正在处理测试任务' } }
    if (!calls.includes('complete_task') && tools.has('complete_task')) {
      return {
        tool: 'complete_task',
        args: { summary: '- 写好了一段测试说明\n- 已保存到文件', files: ['shared/测试结果.md'], assumptions: ['测试环境里没有真实数据'], unverified: ['价格没有核实'], skipped: [] },
      }
    }
    return { text: '这个任务已经处理完了。' }
  }

  if (userText.includes('你的调整')) {
    const start = system.indexOf('根据最近的反馈做的调整')
    return { text: start < 0 ? '系统提示里没有调整段落。' : system.slice(start, start + 120) }
  }

  if (userText.includes('你记得什么')) {
    const start = system.indexOf('以下是你知道的资料')
    return { text: start < 0 ? '系统提示里没有记忆块。' : system.slice(start, start + 200) }
  }

  if (system.includes('你负责任务复盘')) {
    const owner = /负责人 ([^，,\s]+)/.exec(userText)?.[1] ?? '写手'
    return { text: JSON.stringify({ lessons: [{ bot: owner, text: '先确认数据来源再动笔' }], skill: { name: 'test-retro-skill', title: '测试复盘技能', when: '做测试任务时', steps: ['读说明', '写结果'], pitfalls: ['别漏验收项'], template: '- 结论' } }) }
  }
  if (system.includes('你负责根据用户和组长的反馈')) return { text: '{"lines": ["回答尽量用表格，不写长段落"]}' }
  if (system.includes('你负责在 bot 执行网页写操作前复核')) return { text: '{"fits": true, "reason": "任务说明里要求提交表单"}' }

  if (system.includes('你负责从对话里提取值得长期记住的信息')) {
    const prompt = textOf(messages.find((message) => message.role === 'user')?.content)
    const items = prompt
      .split('\n')
      .filter((line) => line.startsWith('用户：') && /喜欢|习惯|以后/.test(line))
      .map((line) => ({ scope: 'owner', type: 'preference', from: 'owner', content: `用户说：${line.slice(3, 60)}`, quote: line.slice(3, 23), action: 'add' }))
    return { text: JSON.stringify(items) }
  }
  if (system.includes('你负责写交接笔记')) {
    return { text: JSON.stringify({ requirements: ['用户要求回答简洁'], decisions: [], todos: ['下周一前整理周报'], facts: [], references: [], topic: ['测试换段'], stance: [], open: [] }) }
  }

  if (system.includes('另一个 bot 通过 ask_bot 向你咨询')) {
    if (userText.includes('[内部评审]')) return { text: userText.includes('前面的发言') ? 'PASS' : '1. 风险在数据来源\n2. 建议先做小范围试点' }
    return { text: '我的建议：先查官网定价页，再看第三方比价。' }
  }

  if (system.includes('你是这个根任务的组长')) {
    const event = userText
    if (last?.role === 'tool') return { text: '好。' }
    if (event.includes('[子任务提交]')) {
      const key = /（(s\d+)，负责人/.exec(event)?.[1] ?? 's1'
      const rejectedBefore = toolCalls(messages).some((call) => call.name === 'review_task' && call.arguments.includes(`"${key}"`) && call.arguments.includes('false'))
      if (key === 's2' && !rejectedBefore) return { tool: 'review_task', args: { subtask: key, pass: false, feedback: '缺“主要限制”一列，补上' } }
      return { tool: 'review_task', args: { subtask: key, pass: true } }
    }
    if (event.includes('[用户要改需求')) {
      return { tool: 'revise_plan', args: { reason: '你纠正了前提：海外版也要', assumption_changes: [{ id: 'a1', text: '中国区和海外版都要看' }] } }
    }
    if (event.includes('[全部子任务已通过]')) {
      return { tool: 'deliver_task', args: { summary: '- 三个子任务都完成了\n- 汇总表在 shared/对比.md', files: ['shared/对比.md'], assumptions: ['只看了测试数据'], unverified: [], skipped: [] } }
    }
    return { text: '收到。' }
  }

  const page = pageDecision({ messages, userText, tools, isUser: (message) => message.role === 'user' && MEANINGFUL.has(message.source?.kind) })
  if (page !== undefined) return page

  // aibot 的 X 工具：说“查一下 X 额度”时调 twitter_get_quota，再按结果回一句，用来确认 X 工具装进了会话。
  if (tools.has('twitter_get_quota') && /X 额度|推特额度/.test(userText)) {
    if (last?.role === 'tool' && calls.at(-1) === 'twitter_get_quota') {
      const result = lastToolText(messages)
      const remaining = result.match(/"remaining":\s*(\d+)/)?.[1]
      return { text: remaining === undefined ? `没查到额度：${result.slice(0, 80)}` : `查到了：X 数据今天还剩 ${remaining} 次。` }
    }
    if (last?.role !== 'tool') return { tool: 'twitter_get_quota', args: {} }
  }

  // dsh 的插件管理：说“列出插件”时调 plugin_manager 列组合包，再把名字说一遍；“卸掉插件 X”时卸掉 X。用来确认执行档的会话装上了它。
  // 新的一段对话会把之前的消息一起带进来，所以先认“卸掉”，再认“列出”。
  const removeTarget = /卸掉插件 ([\w@./-]+)/.exec(userText)?.[1]
  if (removeTarget !== undefined || userText.includes('列出插件')) {
    if (!tools.has('plugin_manager')) return { text: '这个会话没有 plugin_manager。' }
    if (last?.role === 'tool' && calls.at(-1) === 'plugin_manager') {
      const result = lastToolText(messages)
      if (removeTarget !== undefined) return { text: `卸载结果：${result.slice(0, 160)}` }
      const names = [...new Set([...result.matchAll(/"name":\s*"([^"]+)"/g)].map((match) => match[1]))]
      return { text: names.length === 0 ? `没列出来：${result.slice(0, 120)}` : `插件管理能用，装着：${names.join('、')}` }
    }
    if (last?.role !== 'tool') return { tool: 'plugin_manager', args: removeTarget === undefined ? { action: 'list_bundles' } : { action: 'remove_bundle', target: removeTarget } }
  }

  if (tools.has('mention_member')) {
    const decision = groupDecision(system, messages, last, calls)
    if (decision !== undefined) return decision
  }

  // 成员给自己建例程：说“每天”时建在自己名下，建好以后把工具的答复说一遍。
  if (!system.includes('你是主管') && tools.has('create_routine')) {
    if (last?.role === 'tool' && calls.at(-1) === 'create_routine') return { text: `好的。${lastToolText(messages)}` }
    if (userText.includes('每天') && !calls.includes('create_routine')) return { tool: 'create_routine', args: { title: '每日选题', prompt: '列 3 个选题', time: '08:00' } }
  }

  if (system.includes('你是主管')) {
    if (last?.role === 'tool') {
      let message = ''
      try {
        message = JSON.parse(textOf(last.content)).message ?? ''
      } catch {
        message = textOf(last.content).slice(0, 200)
      }
      return { text: `好的。${message}` }
    }
    if (userText.includes('拉个群') && tools.has('create_group')) {
      const name = /拉个群「([^」]+)」/.exec(userText)?.[1] ?? '监控播报'
      return { tool: 'create_group', args: { name, members: rosterNames(system).slice(0, 2), intro: '测试拉群' } }
    }
    // “转达给任务 task_xxx：……”：把这句原话转给那个任务。
    const relayTarget = /转达给任务 (task_[0-9a-f]+)/.exec(userText)?.[1]
    if (relayTarget !== undefined && tools.has('relay_to_task')) {
      if (last?.role === 'tool' && calls.at(-1) === 'relay_to_task') return { text: '已经转达给任务了。' }
      return { tool: 'relay_to_task', args: { task_id: relayTarget, owner_quote: userText, message: '' } }
    }
    if ((userText.includes('委派') || userText.includes('交给')) && tools.has('delegate')) {
      const named = /交给([^\s，。,]+)/.exec(userText)?.[1]
      const bot = named ?? firstRosterName(system) ?? '主管'
      const login = userText.includes('登录')
      if (userText.includes('浏览器') || userText.includes('沉淀') || userText.includes('后台命令') || userText.includes('一直限流') || userText.includes('一直认证失败') || wantedKind(userText) !== undefined) {
        const title = userText.includes('浏览器') ? '浏览器测试' : userText.includes('沉淀') ? '沉淀测试' : userText.includes('后台命令') ? '后台命令测试' : userText.includes('一直限流') ? '限流测试' : userText.includes('一直认证失败') ? '认证失败测试' : '做页面'
        return {
          tool: 'delegate',
          args: { bot, title, brief: userText, deliverable: title === '做页面' ? '页面' : 'shared/测试.md', acceptance: ['按说明做'], assumptions: ['测试环境'], reason: '测试', wait: false },
        }
      }
      return {
        tool: 'delegate',
        args: {
          bot,
          title: login ? '查需要登录的价格' : userText.includes('咨询') ? '先咨询再整理' : '整理测试说明',
          brief: login ? '去 example.com 查价格，需要登录。' : userText.includes('咨询') ? '先咨询一下同事的建议，再写测试说明。' : '写一段测试说明并保存。',
          deliverable: 'shared/测试结果.md',
          acceptance: ['写一段测试说明', '保存到文件'],
          assumptions: ['测试环境里没有真实数据'],
          reason: '测试委派流程',
          wait: !login,
        },
      }
    }
    if (userText.includes('组队') && tools.has('create_task')) {
      const first = firstRosterName(system) ?? '主管'
      return {
        tool: 'create_task',
        args: {
          goal: '对比两家测试公司的定价',
          level: 'L2',
          deliverables: ['shared/对比.md'],
          assumptions: [{ id: 'a1', text: '只看中国区公开报价', affects: ['s1', 's2'] }],
          reasons: ['两家可以并行查，最后汇总'],
          conventions: ['表格列为：版本 / 月付 / 年付 / 主要限制 / 出处'],
          subtasks: [
            { id: 's1', title: 'A 公司', brief: `查 A 公司定价${userText.includes('慢慢') ? '，慢慢来' : ''}`, kind: '调研', deliverable: 'A.md', acceptance: ['列出版本', '写清价格'], owner: first },
            { id: 's2', title: 'B 公司', brief: `查 B 公司定价${userText.includes('慢慢') ? '，慢慢来' : ''}`, kind: '调研', deliverable: 'B.md', acceptance: ['列出版本', '写清价格'], owner: 'd1' },
            { id: 's3', title: '汇总', brief: '把两家合成一张表', kind: '分析', deliverable: 'shared/对比.md', acceptance: ['合成表格'], dependsOn: ['s1', 's2'], owner: first },
          ],
          integration: { owner: first, method: '按约定的列合并' },
          review: { owner: '主管', sampling: '抽查 20% 的出处' },
          drafts: [{ draftId: 'd1', name: '分析师', title: '分析师', persona: '角色：分析师\n目标：查价格并整理', capabilities: ['调研', '分析'], toolProfile: 'research' }],
        },
      }
    }
    if (userText.includes('记住') && tools.has('remember') && !calls.includes('remember')) {
      const line = userText.split('\n').find((item) => item.includes('记住')) ?? userText
      return { tool: 'remember', args: { scope: 'owner', type: 'preference', content: line.replace(/^.*记住/, '用户').slice(0, 60), owner_quote: line.slice(0, 30) } }
    }
    if (userText.includes('查记忆') && tools.has('recall')) return { tool: 'recall', args: { query: '表格' } }

    if (userText.includes('改需求') && tools.has('propose_change')) {
      const taskId = /（(task_[0-9a-f]+)）/.exec(userText)?.[1]
      if (taskId !== undefined) return { tool: 'propose_change', args: { task_id: taskId, owner_quote: userText.split('\n')[1] ?? userText, message: '用户纠正了前提' } }
    }
    if (userText.includes('评审') && tools.has('internal_review')) {
      const names = rosterNames(system).filter((name) => name !== '主管').slice(0, 2)
      return { tool: 'internal_review', args: { topic: '要不要上线新功能', question: '有什么风险？', bots: names, format: 'round' } }
    }
    if (userText.includes('进度') && tools.has('task_status')) return { tool: 'task_status', args: {} }
    if (userText.includes('每天') && tools.has('create_routine') && !calls.includes('create_routine')) {
      return { tool: 'create_routine', args: { title: '早间资讯', prompt: '整理昨晚到今早的资讯，挑 3 条', time: '08:00' } }
    }
    if (userText.includes('盯着') && tools.has('watch_page') && !calls.includes('watch_page')) {
      return { tool: 'watch_page', args: { title: '示例页', url: 'https://example.com/', what: '正文变化', interval_minutes: 5 } }
    }
    if (userText.startsWith('[每日简报]')) return { text: '今天的简报：\n\n- 测试数据里的任务都在推进\n- 没有等你处理的事' }
    return { text: `收到：${userText.slice(0, 200)}\n\n这是**测试模型**的回复，支持 Markdown：\n\n- 第一条\n- 第二条` }
  }

  // 例程指令里写“没有变化”：照提示词只回 NO_CHANGE，dsh-bot 不发出去。
  if (userText.startsWith('[例程「') && userText.includes('没有变化')) return { text: 'NO_CHANGE' }
  if (userText.startsWith('[例程「')) return { text: `例程结果（测试模型）：${userText.split('\n')[1] ?? ''}` }
  if (userText.startsWith('[盯网页「')) return { text: '页面有变化（测试模型）：正文改了一处。' }
  return { text: `（测试模型）收到：${userText.slice(0, 200)}` }
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/** 群聊分派和交接笔记照真模型的样子慢一点（毫秒，默认不慢）：开发时看得到“正在找合适的成员来接”“正在整理之前的对话”。 */
const LITE_DELAY_MS = Number(process.env.POD_MOCK_LITE_DELAY ?? 0)

/** 模拟模型服务出错：dsh 认 Error 自己带的 failure 和 code（和 LlmError 一样）。 */
function providerError(message, code, status) {
  return Object.assign(new Error(message), { code, failure: { message, code, status } })
}

/** 你的话里写“模拟模型出错”时报认证失败（不重试），写“模拟限流”时报限流（重试两次以后还是失败）。 */
function simulatedFailure(options) {
  const messages = Array.isArray(options.messages) ? options.messages : []
  const raw = textOf(lastOf(messages, 'user')?.content)
  const own = frontOwnText(raw) ?? ownText(raw)
  if (own.includes('模拟模型出错')) return providerError('Incorrect API key provided: sk-test-********abcd', 'AUTH', 401)
  if (own.includes('模拟限流')) return providerError('Rate limit reached for requests', 'RATE_LIMIT', 429)
  // 任务说明里写“一直限流”“一直认证失败”：这个任务的每一轮都报这个错，看得到 dsh-bot 隔一会儿重试或者直接暂停。
  const brief = textOf(messages.find((message) => message.role === 'user' && MEANINGFUL.has(message.source?.kind))?.content)
  const task = systemOf(options, messages).includes('你正在执行一个任务')
  if (task && brief.includes('一直限流')) return providerError('Rate limit reached for requests', 'RATE_LIMIT', 429)
  if (task && brief.includes('一直认证失败')) return providerError('Incorrect API key provided: sk-test-********abcd', 'AUTH', 401)
  return undefined
}

/**
 * 照 dsh 的口径报用量：前面已经发过的算命中缓存（cacheReadTokens），只有最后一条算没命中（inputTokens），两样加起来是全部输入。
 * 对话里有“超长”的，全部输入按 30 万算（看换段用）。
 */
function usageOf(options, input, outputTokens) {
  const messages = Array.isArray(options.messages) ? options.messages : []
  const total = JSON.stringify(messages).includes('超长') ? 300000 : Math.ceil(input / 4)
  const fresh = Math.min(total, Math.ceil(JSON.stringify(messages.slice(-1)).length / 4))
  return { inputTokens: fresh, outputTokens, cacheReadTokens: total - fresh }
}

async function* stream(options) {
  const failure = simulatedFailure(options)
  if (failure !== undefined) {
    await sleep(800, options.signal)
    throw failure
  }
  const raw = decide(options)
  const offered = new Set((options.tools ?? []).map((tool) => tool.name))
  const decision = LEGACY_TASK_TOOLS.includes(raw.tool) && offered.has('report') && !offered.has(raw.tool) ? asReport(raw) : raw
  const system = systemOf(options, Array.isArray(options.messages) ? options.messages : [])
  if (LITE_DELAY_MS > 0 && (system.includes('你是群聊里的分派器') || system.includes('你负责写交接笔记'))) await sleep(LITE_DELAY_MS, options.signal)
  if (system.includes('你正在执行一个任务') && JSON.stringify(options.messages ?? []).includes('慢慢')) await sleep(5000, options.signal)
  // 演示剧本每一步先停一会儿，任务卡上看得到进度往前走。
  if (decision.pause > 0) await sleep(decision.pause, options.signal)
  const input = JSON.stringify(options.messages ?? []).length + (options.system?.length ?? 0)
  // 剧本里写了 think 的先想一会儿：思考流一小段一小段地吐，进度块上看得到“正在想”的最后一句。
  let index = 0
  if (typeof decision.think === 'string' && decision.think !== '') {
    yield { type: 'block-start', index, blockType: 'reasoning' }
    for (let start = 0; start < decision.think.length; start += 4) {
      if (options.signal?.aborted) break
      yield { type: 'reasoning-delta', index, text: decision.think.slice(start, start + 4) }
      await sleep(150, options.signal)
    }
    yield { type: 'block-end', index, block: { type: 'reasoning', text: decision.think } }
    index += 1
  }
  if (decision.tool !== undefined) {
    const id = `call_${Math.random().toString(16).slice(2, 10)}`
    const args = JSON.stringify(decision.args)
    yield { type: 'block-start', index, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index, id, name: decision.tool, argumentsDelta: args }
    yield { type: 'block-end', index, block: { type: 'tool-call', id, name: decision.tool, arguments: args } }
    yield { type: 'usage', usage: usageOf(options, input, Math.ceil(args.length / 4)) }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
    return
  }
  const text = decision.text
  yield { type: 'block-start', index, blockType: 'text' }
  for (let start = 0; start < text.length; start += 6) {
    if (options.signal?.aborted) break
    yield { type: 'text-delta', index, text: text.slice(start, start + 6) }
    await sleep(25, options.signal)
  }
  yield { type: 'block-end', index, block: { type: 'text', text } }
  yield { type: 'usage', usage: usageOf(options, input, Math.ceil(text.length / 2)) }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

const adapter = {
  providerInfo: (provider) => ({ id: provider, name: 'dsh-bot 测试模型' }),
  providerRetryPolicy: () => undefined,
  imageRequestPricing: () => undefined,
  imageRequestTarget: (_provider, _model, image) => ({ width: image.width, height: image.height, maxBytes: image.bytes }),
  listModels: async (provider) => [{ provider, id: MODEL, name: '脚本化测试模型', inputModalities: ['text'] }],
  resolveModel: async (provider, model) => ({ provider, id: model, name: model, context: { contextWindow: 128000 }, inputModalities: ['text'] }),
  async prepareCall(provider, model, signal) {
    // 限流照真服务的样子重试两次（间隔很短），看得到“正在等模型服务恢复”。
    const retryPolicy = { mode: 'normal', maxRetries: 2, retryableCodes: ['RATE_LIMIT'], initialDelayMs: 1500, maxDelayMs: 3000, jitterRatio: 0 }
    return { model: await this.resolveModel(provider, model, signal), stream: (options) => stream(options), retryPolicy }
  },
  stream: (options) => stream(options),
}

export function apply(ctx) {
  ctx.effect(() => ctx.llm.registerAdapter([PROVIDER], adapter), 'pod-dev-mock-llm: adapter')
}
