import { OWNER, POD, recurring, t, type Bot, type OriginQuote, type PodSession, type ReplyTarget, type RoomMessage, type Task, type TriggerSpec } from 'pod-domain'
import { getMessage, transaction } from 'pod-store'
import { ownerSource, relaySource } from '../agents/messages.ts'
import type { JsonSchema, ToolDefinition } from '../dsh.ts'
import { isTicket } from '../engine/index.ts'
import type { PodRuntime } from '../pod.ts'
import { bool, failure, oneOf, podTool, str, success, text } from '../tools/define.ts'
import { TRIGGER_PROPS, readTriggerArgs, sourceFor } from '../tools/triggers.ts'

/** 一次 dispatch 最多管几条消息。 */
const DISPATCH_MAX = 20

const SELF_NAMES = new Set(['自己', '我', '主管', 'me', 'self', 'lead'])

const ACTIONS = ['open', 'forward', 'stop', 'ignore', 'answer'] as const
type Action = (typeof ACTIONS)[number]

interface Item {
  readonly messages: readonly string[]
  readonly action: Action
  readonly title: string
  readonly bot: string
  readonly note: string
  readonly task: string
  readonly reason: string
  readonly urgent: boolean
  /** open：带触发器开（到点或等别的任务就绪再开工；重复的就是例程）。 */
  readonly trigger: Readonly<Record<string, unknown>> | undefined
}

const ITEM_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    messages: { type: 'array', items: { type: 'string' }, description: '这一项管哪几条消息（消息 id）；说的是同一件事的放在一起' },
    action: oneOf('open 开任务 / forward 转给任务 / stop 停任务 / ignore 不用处理 / answer 直接答（用 reply 答）', [...ACTIONS]),
    title: str('open：任务标题，简短'),
    bot: str('open：交给谁（名字或 id；交给自己写“自己”）'),
    note: str('open、forward：一句备注（背景或用户的明确要求），只给干活的 bot 看'),
    task: str('forward、stop：任务 id'),
    reason: str('ignore：一句原因'),
    urgent: bool('open：用户说了急'),
    trigger: {
      type: 'object',
      properties: TRIGGER_PROPS,
      description: 'open：要等到点或等别的任务就绪再开工时写（“明天 9 点提醒我”“t41 做完再写稿”）；写重复的时间（每天、每周、每隔多久）就是例程，每次到点做一次',
    },
  },
  required: ['messages', 'action'],
}

function readItems(args: Readonly<Record<string, unknown>>): readonly Item[] | string {
  const raw = args.items
  if (!Array.isArray(raw) || raw.length === 0) return '至少给一项'
  const items: Item[] = []
  for (const value of raw) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return '每一项是一个对象'
    const entry = value as Readonly<Record<string, unknown>>
    const messages = Array.isArray(entry.messages) ? entry.messages.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim()) : []
    const action = text(entry, 'action')
    if (messages.length === 0) return '每一项都要写 messages（消息 id）'
    if (!(ACTIONS as readonly string[]).includes(action)) return 'action 只能是 open、forward、stop、ignore、answer'
    const item: Item = {
      messages,
      action: action as Action,
      title: text(entry, 'title'),
      bot: text(entry, 'bot'),
      note: text(entry, 'note'),
      task: text(entry, 'task'),
      reason: text(entry, 'reason'),
      urgent: entry.urgent === true,
      trigger: typeof entry.trigger === 'object' && entry.trigger !== null && !Array.isArray(entry.trigger) ? (entry.trigger as Readonly<Record<string, unknown>>) : undefined,
    }
    if (item.action === 'open' && item.title === '') return 'open 要写 title'
    if ((item.action === 'forward' || item.action === 'stop') && item.task === '') return `${item.action} 要写 task（任务 id）`
    if (item.action === 'ignore' && item.reason === '') return 'ignore 要写一句 reason'
    items.push(item)
  }
  if (items.reduce((sum, item) => sum + item.messages.length, 0) > DISPATCH_MAX) return `一次最多 ${DISPATCH_MAX} 条消息，分几次给`
  return items
}

/** 前台的工具：给消息记去向（分派）、对用户说话（回复）、给任务补一句话、让任务不再接某个话题。 */
export function frontTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const current = (): PodSession => pod.registry.get(session.id) ?? session
  const me = (): Bot | undefined => pod.bots.get(session.botId)
  const speaker = (author: string): string => (author === OWNER ? t('用户') : author === POD ? 'dsh-bot' : (pod.bots.get(author)?.name ?? 'bot'))

  /** 交给这个前台、还没判断的消息；不是的说清为什么。 */
  const assigned = (id: string, action: Action): RoomMessage | string => {
    const message = getMessage(pod.db, id)
    if (message === undefined || message.deletedAt !== null) return `${id}：找不到这条消息`
    if (pod.engine.topics.awaiting(id, session.botId)) return message
    const held = pod.engine.topics.routes(id).find((route) => route.route === 'direct' && route.taskId !== null)
    if (held !== undefined) return action === 'stop' ? message : `${id}：已经直通任务 ${held.taskId}，任务在管；只有用户要求停下时才能 stop`
    const decided = pod.engine.topics.routes(id).some((route) => route.botId === session.botId && route.route !== 'front')
    return decided ? `${id}：已经记过去向了` : `${id}：这条不是交给你的消息`
  }

  /** 交给前台时附的说明（上传的文件、页面修改要求、交还的原因），开任务时一起交给干活的 bot。 */
  const pushedNote = (id: string): string =>
    [...pod.engine.topics.routes(id)].reverse().find((route) => route.route === 'front' && route.botId === session.botId)?.note ?? ''

  const target = (name: string): Bot | string => {
    const self = me()
    if (self === undefined) return '找不到你自己'
    if (name === '' || SELF_NAMES.has(name.toLowerCase()) || name === self.name) return self
    const bot = pod.bots.resolve(name)
    if (bot === undefined || bot.archivedAt !== null) return `找不到 bot「${name}」，先用 find_bots 查，或用 create_bot 新建`
    if (self.role !== 'lead' && bot.id !== self.id) return `你只能开给自己；要${bot.name}干活，请用户找 Super-agent 或者点它的名`
    return bot
  }

  const open = async (item: Item, messages: readonly RoomMessage[]): Promise<string> => {
    const bot = target(item.bot)
    if (typeof bot === 'string') return bot
    const spec: TriggerSpec | string | undefined = item.trigger === undefined ? undefined : readTriggerArgs(pod, item.trigger)
    if (typeof spec === 'string') return `trigger 写得不对：${spec}`
    const first = messages[0]
    const room = first === undefined ? undefined : pod.rooms.get(first.roomId)
    if (first === undefined || room === undefined) return '找不到消息所在的聊天室'
    const quotes: OriginQuote[] = messages.map((message) => ({ messageId: message.id, author: speaker(message.author), text: message.body }))
    const brief = [item.note, ...messages.map((message) => pushedNote(message.id))].filter((line) => line !== '').join('\n')
    const replyTo: ReplyTarget[] = [...new Set(messages.map((message) => message.roomId))].map((roomId) => ({ roomId, messageId: messages.filter((message) => message.roomId === roomId).at(-1)?.id ?? null }))
    const pageId = messages.map((message) => message.data.pageId).find((value): value is string => typeof value === 'string')
    const created = await pod.tasks.delegate({
      requester: current(),
      roomId: room.id,
      bot,
      title: item.title,
      brief,
      deliverable: '',
      acceptance: [],
      assumptions: [],
      urgent: item.urgent,
      reason: t('前台分派'),
      quotes,
      replyTo,
      // 例程（重复的触发器）的任务卡不内联：每次的结果回在卡下面。
      card: { ...(room.kind === 'direct' && (spec === undefined || !recurring(spec)) ? { inline: true } : {}), ...(spec !== undefined && recurring(spec) ? { standing: true } : {}), ...(pageId === undefined ? {} : { pageId }) },
      start: spec === undefined,
    })
    if (!created.ok) return created.error.message
    let when = ''
    if (spec !== undefined) {
      const set = pod.triggers.set(created.value, { spec, note: item.note, createdBy: session.botId, state: { source: sourceFor(spec, 'open'), ...(recurring(spec) ? { offPeak: true } : {}) } })
      if (typeof set === 'string') {
        pod.engine.tickets.end(created.value.id, 'stopped', session.botId)
        return `trigger 没挂上：${set}`
      }
      when = `，${pod.triggers.describe(set)}开工`
    }
    transaction(pod.db, () => {
      for (const message of messages) pod.engine.topics.decide(message.id, session.botId, 'opened', created.value.id, item.note)
    })
    return `开了任务 ${created.value.id}「${created.value.title}」，交给${bot.name}${when}`
  }

  const forward = (item: Item, messages: readonly RoomMessage[], task: Task): string => {
    if (task.endedAt !== null && task.endReason === 'stopped') return `任务「${task.title}」已经停掉了；要接着做，请用户点继续`
    const errors: string[] = []
    for (const message of messages) {
      if (isTicket(task)) {
        const sent = pod.intake.forward(task, message, session.botId, item.note)
        if (!sent.ok) errors.push(`${message.id}：${sent.error.message}`)
        continue
      }
      const sent = pod.tasks.sendToTask(task, `[用户原话，经${me()?.name ?? '前台'}转来] ${message.body}${item.note === '' ? '' : `\n说明：${item.note}`}`, ownerSource(), message.body)
      if (!sent.ok) errors.push(`${message.id}：${sent.error.message}`)
      else pod.engine.topics.decide(message.id, session.botId, 'relayed', task.id, item.note)
    }
    return errors.length > 0 ? errors.join('；') : `转给了「${task.title}」`
  }

  const apply = async (item: Item): Promise<{ readonly ok: boolean; readonly line: string }> => {
    const found = item.messages.map((id) => assigned(id, item.action))
    const problems = found.filter((value): value is string => typeof value === 'string')
    if (problems.length > 0) return { ok: false, line: problems.join('；') }
    const messages = found.filter((value): value is RoomMessage => typeof value !== 'string')
    const ids = messages.map((message) => message.id).join('、')
    switch (item.action) {
      case 'open': {
        const line = await open(item, messages)
        return { ok: line.startsWith('开了任务'), line: `${ids}：${line}` }
      }
      case 'forward': {
        const task = pod.tasks.get(item.task)
        if (task === undefined || task.parentId !== null) return { ok: false, line: `${ids}：找不到任务 ${item.task}` }
        const line = forward(item, messages, task)
        return { ok: line.startsWith('转给了'), line: `${ids}：${line}` }
      }
      case 'stop': {
        const stopped = pod.tasks.control(item.task, 'stop', session.botId)
        if (!stopped.ok) return { ok: false, line: `${ids}：${stopped.error.message}` }
        transaction(pod.db, () => {
          for (const message of messages) if (pod.engine.topics.awaiting(message.id, session.botId)) pod.engine.topics.decide(message.id, session.botId, 'stopped', stopped.value.id)
        })
        return { ok: true, line: `${ids}：停了「${stopped.value.title}」` }
      }
      case 'ignore':
      case 'answer':
        transaction(pod.db, () => {
          for (const message of messages) pod.engine.topics.decide(message.id, session.botId, item.action === 'ignore' ? 'ignored' : 'answered', null, item.reason)
        })
        return { ok: true, line: `${ids}：${item.action === 'ignore' ? '不用处理' : '直接答（记得用 reply 答）'}` }
    }
  }

  const dispatch = podTool({
    name: 'dispatch',
    description: [
      '给新消息记去向，一次 1 到 20 条，几条说的是同一件事放在同一项里。每条新消息都要有去向：',
      'open 开任务交给对口的 bot（要查要跑的、要写成长东西的），用户原话会原样放进任务；forward 转给明确指向的开着的任务（同时让它跟进那条消息所在的话题）；',
      'stop 用户要求时停任务；ignore 不用处理（写原因）；answer 直接答，然后用 reply 答（reply 回的那条会自动记成直接答，不用再记）。',
    ].join(''),
    properties: { items: { type: 'array', items: ITEM_SCHEMA, description: '每项一个去向' } },
    required: ['items'],
    parse: readItems,
    run: async (items) => {
      const results: { readonly ok: boolean; readonly line: string }[] = []
      for (const item of items) results.push(await apply(item))
      const failed = results.filter((result) => !result.ok)
      const lines = results.map((result) => `${result.ok ? '' : '没记上：'}${result.line}`).join('\n')
      return failed.length === 0 ? success(lines) : failure(lines)
    },
  })

  const reply = podTool({
    name: 'reply',
    description:
      '对用户说话：发一条消息到聊天室。写明回的是哪条消息（to）和用途：confirm 确认（开了、转了任务时只补任务卡上没有的，没有就不发）、answer 答复（第一句就是答案）。用户问任务的细节时只讲问的那部分，task 写那个任务，消息下面会附上报告。你在别处写的文字用户看不到，只有 reply 会发出去。',
    properties: {
      to: str('回哪条消息（消息 id）'),
      room: str('不回具体某条时，发到哪个聊天室（room id）'),
      purpose: oneOf('confirm 确认 / answer 答复', ['confirm', 'answer']),
      text: str('要说的话'),
      task: str('附上哪个任务的报告（任务 id，可选）'),
    },
    required: ['purpose', 'text'],
    parse: (args) => {
      const body = text(args, 'text')
      if (body === '') return '要写说什么'
      const to = text(args, 'to')
      const room = text(args, 'room')
      if (to === '' && room === '') return '要写回哪条消息（to）或者发到哪个聊天室（room）'
      return { to, room, purpose: text(args, 'purpose') === 'confirm' ? ('confirm' as const) : ('answer' as const), body, task: text(args, 'task') }
    },
    run: ({ to, room, purpose, body, task }) => {
      const replied = to === '' ? undefined : getMessage(pod.db, to)
      if (to !== '' && (replied === undefined || replied.deletedAt !== null)) return failure(`找不到消息 ${to}`)
      const target = pod.rooms.get(replied?.roomId ?? room)
      if (target === undefined || target.archivedAt !== null) return failure('找不到这个聊天室')
      const member = target.kind === 'direct' ? target.botId === session.botId : pod.rooms.members(target.id).some((item) => item.botId === session.botId)
      if (!member) return failure('你不在这个聊天室里')
      const about = task === '' ? undefined : pod.tasks.get(task)
      if (task !== '' && about === undefined) return failure(`找不到任务 ${task}`)
      const pageId = typeof replied?.data.pageId === 'string' ? replied.data.pageId : undefined
      // 走回复队列：按顺序发、留回执；群里挂在回的那条下面，单聊里回的正是最新那句就不挂引用。
      const messageId = pod.replies.send({
        roomId: target.id,
        author: session.botId,
        purpose,
        body,
        sessionId: session.id,
        replyTo: replied?.id ?? null,
        data: { ...(pageId === undefined ? {} : { pageId }), ...(about === undefined ? {} : { reportTaskId: about.rootId }) },
      })
      if (replied !== undefined && purpose === 'answer' && pod.engine.topics.awaiting(replied.id, session.botId)) pod.engine.topics.decide(replied.id, session.botId, 'answered')
      return success(`已发到「${target.title}」`, { messageId })
    },
  })

  const note = podTool({
    name: 'note_task',
    description: '给任务补一句话（背景、用户的意思），送进任务会话，只给干活的 bot 看。用户在聊天室说的话要转给任务，用 dispatch 的 forward。',
    properties: { task_id: str('任务 id'), text: str('补充的话，一两句') },
    required: ['task_id', 'text'],
    parse: (args) => (text(args, 'task_id') === '' || text(args, 'text') === '' ? '要写任务 id 和补充的话' : { taskId: text(args, 'task_id'), body: text(args, 'text') }),
    run: ({ taskId, body }) => {
      const task = pod.tasks.get(taskId)
      if (task === undefined) return failure('找不到这个任务')
      const name = me()?.name ?? '前台'
      const sent = pod.tasks.sendToTask(task, `[${name}补充] ${body}`, relaySource(session.id), { id: null, author: name, replyTo: null, text: body })
      return sent.ok ? success(`已补给「${task.title}」`) : failure(sent.error.message)
    },
  })

  const unfollow = podTool({
    name: 'unfollow_task',
    description: '让一个任务不再接某个话题的消息：话题用里面任意一条消息的 id 指。',
    properties: { task_id: str('任务 id'), message: str('话题里的一条消息 id') },
    required: ['task_id', 'message'],
    parse: (args) => (text(args, 'task_id') === '' || text(args, 'message') === '' ? '要写任务 id 和消息 id' : { taskId: text(args, 'task_id'), messageId: text(args, 'message') }),
    run: ({ taskId, messageId }) => {
      const task = pod.tasks.get(taskId)
      const topic = pod.engine.topics.topicOf(messageId)
      if (task === undefined) return failure('找不到这个任务')
      if (topic === undefined || !pod.engine.topics.unfollow(task.id, topic.id)) return failure('这个任务没有跟进这条消息所在的话题')
      return success(`「${task.title}」不再接这个话题的消息`)
    },
  })

  return [dispatch, reply, note, unfollow]
}
