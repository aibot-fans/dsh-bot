/**
 * 前台的剧本：消息成批送来（[新消息] 开头，按聊天室分组），每条按内容记去向，一步调一个工具：
 * - “交给主管/某某 …”或“委派”：open 开任务（交给谁写谁；成员只能开给自己；标题按关键词取）。
 * - “转达给任务 task_x：…”：forward 转过去，再 reply 一句“接着「…」做”。
 * - “停掉任务 task_x”：stop。
 * - “谢谢”：ignore。
 * - “@ 一下 某某”：mention_member 叫它，再记 answer。
 * - 被别的成员点名、话里有“应一声”：学真实模型的毛病先 @ 回去（dsh-bot 应该拦下），再直接 reply。
 * - “进度”：先 task_status，再把结果 reply 出去。
 * - “记住…”：先 remember，再 reply。
 * - “拉个群「…」”：create_group（只有 Super-agent 有），再 reply。
 * - “每天”：create_routine 建在这个聊天室，再 reply。
 * - “测试漏掉”：一直不记去向（追问一次，再没有就记成漏掉）；“测试追问”：第一次不记，被追问后再答。
 * - 其余：reply 直接答。
 * 这一批的工具都调完了，说一句收尾（前台的文字不发到聊天室）。
 */

import { wantedKind } from './pages.js'

const BATCH_HEAD = '[新消息]'
const NUDGE_HEAD = '[dsh-bot] 这几条还没有去向：'
const RETRY_HEAD = '[dsh-bot] 刚才模型服务出错'

/** 一批的正文：换段后第一批前面有一段“[新的一段]”说明，去掉；不是一批时返回 undefined。 */
export function batchBody(text) {
  const body = text.replace(/^\[新的一段\][^\n]*\n\n/, '')
  return body.startsWith(BATCH_HEAD) ? body : undefined
}

/** 一批里的新消息：id、谁说的、正文、在哪个聊天室。“最近”里的旧消息不算。 */
export function batchItems(raw) {
  const text = batchBody(raw)
  if (text === undefined) return []
  const items = []
  let room
  let fresh = false
  for (const line of text.split('\n')) {
    const header = /^== (单聊|群聊|任务群)「([^」]*)」（(room_[0-9a-z]+)/.exec(line)
    if (header !== null) {
      room = { kind: header[1], title: header[2], id: header[3] }
      fresh = false
      continue
    }
    if (line === '新消息：' || line === '最近：') {
      fresh = line === '新消息：'
      continue
    }
    if (!fresh || room === undefined || line === '') continue
    const item = /^- (msg_[0-9a-z]+) ([^：（]+)(（.*?）)?：(.*)$/.exec(line)
    if (item !== null) items.push({ id: item[1], speaker: item[2], body: item[4], room })
    else if (items.length > 0 && !line.startsWith('  ')) {
      const previous = items.pop()
      items.push({ ...previous, body: `${previous.body}\n${line}` })
    }
  }
  return items
}

/** 前台这批新消息说的话（模拟出错只看新消息，“最近”里旧的那句不算）；不是一批时返回 undefined。 */
export function frontOwnText(text) {
  if (batchBody(text) === undefined) return undefined
  return batchItems(text)
    .map((item) => item.body)
    .join('\n')
}

/** 追问里列的消息 id。 */
function nudgedIds(text) {
  return [...text.matchAll(/^- (msg_[0-9a-z]+)：/gm)].map((match) => match[1])
}

/** 批开头“在忙”里的任务标题。 */
function taskTitle(text, taskId) {
  return new RegExp(`- ${taskId}「([^」]*)」`).exec(text)?.[1] ?? taskId
}

function openTitle(body) {
  if (/组个团队|组队/.test(body)) return '团队测试'
  if (body.includes('浏览器')) return '浏览器测试'
  if (body.includes('沉淀')) return '沉淀测试'
  if (body.includes('后台命令')) return '后台命令测试'
  if (body.includes('拿主意')) return '选方案测试'
  if (body.includes('测试失败')) return '失败测试'
  if (body.includes('一直限流')) return '限流测试'
  if (body.includes('一直认证失败')) return '认证失败测试'
  if (wantedKind(body) !== undefined) return '做页面'
  if (body.includes('登录')) return '查需要登录的价格'
  if (body.includes('咨询')) return '先咨询再整理'
  return '整理测试说明'
}

function dispatch(id, fields) {
  return () => ({ tool: 'dispatch', args: { items: [{ messages: [id], ...fields }] } })
}

function reply(item, text, purpose = 'answer') {
  return () => ({ tool: 'reply', args: { to: item.id, purpose, text } })
}

/** 一条消息要调哪几步；每步是 (上一步的结果) => 决定。 */
function stepsFor(item, context) {
  const { body, id, room, speaker } = item
  const { tools, self, member, batch, nudged } = context
  if (body.includes('测试漏掉')) return []
  if (body.includes('测试追问') && !nudged) return []
  const relay = /转达给任务 (task_[0-9a-z]+)/.exec(body)?.[1]
  if (relay !== undefined) return [dispatch(id, { action: 'forward', task: relay, note: '' }), reply(item, `接着「${taskTitle(batch, relay)}」做`, 'confirm')]
  const stop = /停掉任务 (task_[0-9a-z]+)/.exec(body)?.[1]
  if (stop !== undefined) return [dispatch(id, { action: 'stop', task: stop })]
  if (/^(谢谢|多谢|好的谢谢)/.test(body.trim())) return [dispatch(id, { action: 'ignore', reason: '道谢，不用处理' })]
  const asked = /@ ?一下\s*([^\s，。,、：:]+)/.exec(body)?.[1]
  if (asked !== undefined && tools.has('mention_member')) {
    return [() => ({ tool: 'mention_member', args: { room: room.id, members: [asked], message: `@${asked} 用户找你，在群里应一声：${body.slice(0, 60)}` } }), dispatch(id, { action: 'answer' })]
  }
  if (speaker !== '用户' && body.includes('应一声') && tools.has('mention_member')) {
    return [
      () => ({ tool: 'mention_member', args: { room: room.id, members: [speaker], message: '收到，我在' } }),
      (result) => ({ tool: 'reply', args: { to: id, purpose: 'answer', text: `收到，我在。（没有 @ 回去：${result.slice(0, 40)}）` } }),
    ]
  }
  if (speaker !== '用户') return [reply(item, `（测试模型）我是${self}，收到${speaker}的话：${body.slice(0, 80)}`)]
  if (/交给|委派/.test(body)) {
    const named = /交给([^\s，。,]+)/.exec(body)?.[1]
    const bot = member || named === undefined ? '自己' : named
    return [dispatch(id, { action: 'open', title: openTitle(body), bot, note: body.includes('急') ? '用户说了急' : '' })]
  }
  if (body.includes('进度') && tools.has('task_status')) return [() => ({ tool: 'task_status', args: {} }), (result) => ({ tool: 'reply', args: { to: id, purpose: 'answer', text: `进度：${result.slice(0, 300)}` } })]
  if (body.includes('记住') && tools.has('remember')) {
    const line = body.split('\n').find((part) => part.includes('记住')) ?? body
    return [
      () => ({ tool: 'remember', args: { scope: 'owner', type: 'preference', content: line.replace(/^.*记住/, '用户').slice(0, 60), owner_quote: line.slice(0, 30), room: room.id } }),
      (result) => ({ tool: 'reply', args: { to: id, purpose: 'answer', text: `好的。${result.slice(0, 120)}` } }),
    ]
  }
  if (body.includes('拉个群') && tools.has('create_group')) {
    const name = /拉个群「([^」]+)」/.exec(body)?.[1] ?? '监控播报'
    return [
      () => ({ tool: 'create_group', args: { name, members: context.roster.slice(0, 2), intro: '测试拉群' } }),
      (result) => ({ tool: 'reply', args: { to: id, purpose: 'answer', text: `好的。${result.slice(0, 120)}` } }),
    ]
  }
  if (body.includes('每天') && tools.has('create_routine')) {
    return [
      () => ({ tool: 'create_routine', args: { title: member ? '每日选题' : '早间资讯', prompt: member ? '列 3 个选题' : '整理昨晚到今早的资讯，挑 3 条', time: '08:00', room: room.kind === '单聊' ? '' : room.id } }),
      (result) => ({ tool: 'reply', args: { to: id, purpose: 'answer', text: `好的。${result.slice(0, 120)}` } }),
    ]
  }
  if (body.includes('测试追问')) return [reply(item, '（测试模型）被追问后补答了这一条。')]
  return [reply(item, `（测试模型）收到：${body.slice(0, 200)}\n\n这是**测试模型**的回复，支持 Markdown：\n\n- 第一条\n- 第二条`)]
}

/**
 * 前台的决定：从这一批（或追问、出错后接着处理）排出要调的工具，按这一轮已经调过几次取下一步。
 * context：system、userText、tools、calls（这一批之后调过的工具数）、result（上一步的结果）、batch（最近一批的全文）。
 */
export function frontDecision(context) {
  const { system, tools } = context
  const userText = batchBody(context.userText) ?? context.userText
  const self = /你在 dsh-bot 里的名字是「([^」]+)」/.exec(system)?.[1] ?? /你是「([^」]+)」的前台/.exec(system)?.[1] ?? '前台'
  const member = system.includes('只能开给自己')
  const nudged = userText.startsWith(NUDGE_HEAD)
  const retry = userText.startsWith(RETRY_HEAD)
  const batch = context.batch
  const all = batchItems(batch)
  const wanted = nudged ? new Set(nudgedIds(userText)) : undefined
  const items = wanted === undefined ? all : all.filter((item) => wanted.has(item.id))
  // 追问里有、但最近一批里找不到的（比如更早一批的），按追问里的 id 直接答。
  const missing = wanted === undefined ? [] : [...wanted].filter((id) => !items.some((item) => item.id === id)).map((id) => ({ id, speaker: '用户', body: '测试追问', room: { kind: '单聊', id: '' } }))
  const shared = { tools, self, member, batch, nudged, roster: context.roster }
  const steps = [...items, ...missing].flatMap((item) => stepsFor(item, shared))
  if (!nudged && !retry && !userText.startsWith(BATCH_HEAD)) return { text: '（前台）收到。' }
  const next = steps[context.calls]
  if (next === undefined) return { text: steps.length === 0 ? '（前台）这批先不处理。' : '（前台）这批处理完了。' }
  return next(context.result)
}
