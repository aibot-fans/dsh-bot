/**
 * 开发用的脚本化模型：provider 是 pod-mock，模型是 scripted。
 * 它不调用任何外部服务，只按会话的系统提示和最后一条消息决定回复或调用哪个 Pod 工具，
 * 用来在没有模型账号的隔离环境里跑通主管委派、任务会话、等你处理和交付。
 */

import { demoDecision } from './demo.js'
import { newPage, pageDecision, wantedKind } from './pages.js'
import { progressDecision, routineDecision, turnCalls } from './progress.js'

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

/** 只看用户自己说的部分：去掉换段时的交接笔记前言和附在后面的相关记忆。 */
/** 换段时消息前面有一段说明，真正的话在最后一个“[谁的新消息]”后面。 */
function withoutPreface(text) {
  const marker = [...text.matchAll(/\[[^\]\n]*的新消息\]\n/g)].at(-1)
  return marker === undefined ? text : text.slice((marker.index ?? 0) + marker[0].length)
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
  const brief = textOf(messages.find((message) => message.role === 'user' && MEANINGFUL.has(message.source?.kind))?.content)
  if (process.env.POD_MOCK_DEBUG === '1') console.error('[mock]', JSON.stringify(userText.slice(0, 40)), [...tools].join(','))

  if (system.includes('你是群聊里的分派器')) return { text: JSON.stringify({ to: routeTarget(textOf(messages.find((message) => message.role === 'user')?.content)) }) }

  const lastTool = messages.filter((message) => message.role === 'tool').at(-1)
  const demo = demoDecision({ system, messages, brief, userText, calls, tools, last, result: lastTool === undefined ? undefined : parsedResult(lastTool), page: lastPage(messages) })
  if (demo !== undefined) return demo

  const turn = turnCalls(messages, (message) => message.role === 'user' && MEANINGFUL.has(message.source?.kind))
  const scripted = progressDecision({ userText, turn, tools }) ?? routineDecision({ userText, turn, tools, result: lastToolText(messages) })
  if (scripted !== undefined) return scripted

  if (system.includes('你正在执行一个任务')) {
    if (last?.role === 'tool' && calls.at(-1) === 'complete_task') return { text: '已经提交了。' }
    if (last?.role === 'tool' && calls.at(-1) === 'ask_owner') return { text: '已经请用户处理，等用户答复后接着做。' }
    if (brief.includes('浏览器') && tools.has('browser_open')) return browserTask(brief, userText, messages, calls)
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
    if (userText.includes('[组长打回]')) {
      return { tool: 'complete_task', args: { summary: '- 按组长意见补上了主要限制', files: ['B.md'], assumptions: [], unverified: [], skipped: [] } }
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
    if ((userText.includes('委派') || userText.includes('交给')) && tools.has('delegate')) {
      const named = /交给([^\s，。,]+)/.exec(userText)?.[1]
      const bot = named ?? firstRosterName(system) ?? '主管'
      const login = userText.includes('登录')
      if (userText.includes('浏览器') || userText.includes('沉淀') || wantedKind(userText) !== undefined) {
        const title = userText.includes('浏览器') ? '浏览器测试' : userText.includes('沉淀') ? '沉淀测试' : '做页面'
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
  const own = ownText(textOf(lastOf(messages, 'user')?.content))
  if (own.includes('模拟模型出错')) return providerError('Incorrect API key provided: sk-test-********abcd', 'AUTH', 401)
  if (own.includes('模拟限流')) return providerError('Rate limit reached for requests', 'RATE_LIMIT', 429)
  return undefined
}

async function* stream(options) {
  const failure = simulatedFailure(options)
  if (failure !== undefined) {
    await sleep(800, options.signal)
    throw failure
  }
  const decision = decide(options)
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
    yield { type: 'usage', usage: { inputTokens: Math.ceil(input / 4), outputTokens: Math.ceil(args.length / 4), cacheReadTokens: 0 } }
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
  const huge = JSON.stringify(options.messages ?? []).includes('超长')
  yield { type: 'usage', usage: { inputTokens: huge ? 300000 : Math.ceil(input / 4), outputTokens: Math.ceil(text.length / 2), cacheReadTokens: 0 } }
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
