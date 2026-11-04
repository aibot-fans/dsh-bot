import { OWNER, POD, recurring, t, type Bot, type OriginQuote, type PodSession, type ReplyTarget, type Room, type RoomMessage, type Task, type TriggerSpec } from 'pod-domain'
import { getMessage, taskConversationOf, transaction } from 'pod-store'
import { ownerSource, relaySource } from '../agents/messages.ts'
import type { JsonSchema, ToolDefinition } from '../dsh.ts'
import { isTicket } from '../engine/index.ts'
import type { PodRuntime } from '../pod.ts'
import type { TaskConversation } from '../tasks/service.ts'
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
  /** open 的交代、forward 的完整后续：干活的 bot 在任务对话里看到的那条。 */
  readonly brief: string
  /** open：一起做的其他成员（写了就开成任务群）。 */
  readonly members: readonly string[]
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
    brief: str(
      'open：交代全文，就是干活的 bot 在任务对话里看到的第一条（用户也看得到）。它看不到这边的对话，要单独能看懂：先引用户原话，再写要做成什么、它不知道的背景和用户定过的要求、要弄清的几点、给谁看、要多细；不写怎么做，不写 id、文件夹、验收项。forward：一条完整的后续：用户又说了什么（引原话）、要改什么、哪些不动',
    ),
    members: { type: 'array', items: { type: 'string' }, description: 'open：要几个 bot 一起做时，写负责的 bot 以外的成员（名字或 id），开成任务群；一个 bot 能做完的不写' },
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
      brief: text(entry, 'brief'),
      members: Array.isArray(entry.members) ? entry.members.filter((name): name is string => typeof name === 'string' && name.trim() !== '').map((name) => name.trim()) : [],
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
    if (self.role !== 'lead' && bot.id !== self.id) return `你只能开给自己；要${bot.name}干活，请用户找${pod.bots.lead().name}或者点它的名`
    return bot
  }

  /** 任务群里负责的 bot 以外的成员；找不到的、成员前台想拉别人的说清为什么。 */
  const groupMembers = (names: readonly string[], owner: Bot): readonly Bot[] | string => {
    const found: Bot[] = []
    for (const name of names) {
      const self = me()
      const bot = self !== undefined && (SELF_NAMES.has(name.toLowerCase()) || name === self.name) ? self : pod.bots.resolve(name)
      if (bot === undefined || bot.archivedAt !== null) return `找不到 bot「${name}」，先用 find_bots 查，或用 create_bot 新建`
      if (self?.role !== 'lead' && bot.id !== self?.id) return `你只能开给自己；要${bot.name}一起做，请用户找${pod.bots.lead().name}`
      if (bot.id !== owner.id && !found.some((member) => member.id === bot.id)) found.push(bot)
    }
    return found
  }

  const open = async (item: Item, messages: readonly RoomMessage[]): Promise<string> => {
    const bot = target(item.bot)
    if (typeof bot === 'string') return bot
    const members = groupMembers(item.members, bot)
    if (typeof members === 'string') return members
    const spec: TriggerSpec | string | undefined = item.trigger === undefined ? undefined : readTriggerArgs(pod, item.trigger)
    if (typeof spec === 'string') return `trigger 写得不对：${spec}`
    // 任务对话：几个 bot 一起的开任务群，交给别的 bot 的和它另开一段单聊；自己干的、例程就在这里干，结果回在这里。
    const standing = spec !== undefined && recurring(spec)
    const conversation: TaskConversation | undefined = standing ? undefined : members.length > 0 ? { kind: 'group', members } : bot.id === session.botId ? undefined : { kind: 'chat' }
    const first = messages[0]
    const room = first === undefined ? undefined : pod.rooms.get(first.roomId)
    if (first === undefined || room === undefined) return '找不到消息所在的聊天室'
    const quotes: OriginQuote[] = messages.map((message) => ({ messageId: message.id, author: speaker(message.author), text: message.body }))
    // 交代照 Super-agent 写的；交给前台时附的说明（上传的文件、页面修改要求、交还的原因）它没写进去的补在后面。
    const written = item.brief !== '' ? item.brief : item.note
    const pushed = messages.map((message) => pushedNote(message.id)).filter((line) => line !== '' && !written.includes(line))
    const brief = [written, ...pushed].filter((line) => line !== '').join('\n\n')
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
      card: { ...(room.kind === 'direct' && !standing ? { inline: true } : {}), ...(standing ? { standing: true } : {}), ...(pageId === undefined ? {} : { pageId }) },
      start: spec === undefined,
      ...(conversation === undefined ? {} : { conversation }),
    })
    if (!created.ok) return created.error.message
    let starts = ''
    if (spec !== undefined) {
      const set = pod.triggers.set(created.value, { spec, note: item.note, createdBy: session.botId, state: { source: sourceFor(spec, 'open'), ...(recurring(spec) ? { offPeak: true } : {}) } })
      if (typeof set === 'string') {
        pod.engine.tickets.end(created.value.id, 'stopped', session.botId)
        return `trigger 没挂上：${set}`
      }
      starts = pod.triggers.describe(set)
    }
    transaction(pod.db, () => {
      for (const message of messages) pod.engine.topics.decide(message.id, session.botId, 'opened', created.value.id, item.note)
    })
    // 开了任务先回用户一句，任务卡挂在这句下面；这一轮结束还没回，dsh-bot 以你的名义补上这句。
    const asked = messages.filter((message) => message.roomId === room.id).at(-1) ?? first
    const fallback = starts !== '' ? t('好，{when}开工，结果发在这里。', { when: starts }) : bot.id === session.botId ? t('我来做，做好了直接发你。') : t('交给{name}了，结果出来我直接发你。', { name: bot.name })
    pod.front.opened(session.botId, { roomId: room.id, messageId: asked.id, sessionId: session.id, body: fallback, taskId: created.value.id })
    const where = conversation === undefined ? '' : conversation.kind === 'group' ? `，开了任务群（${[bot, ...members].map((member) => member.name).join('、')}）` : '，和它另开了一段单聊'
    const when = starts === '' ? '' : `，${starts}开工`
    return `开了任务 ${created.value.id}「${created.value.title}」，交给${bot.name}${where}${when}\n现在用 reply（confirm，to 写 ${asked.id}）回用户一句：交给谁了、取了哪种理解，任务卡挂在这句下面`
  }

  /**
   * 转给有自己对话的任务：它在等用户拿主意，用户的话就是答复，记到那个问题上（和在任务里点按钮一样）；
   * 不然把你写的完整后续发进它的对话（群里 @ 负责的 bot），送给干活的 bot，它在那里回。
   */
  const forwardInto = (item: Item, messages: readonly RoomMessage[], task: Task, conversation: Room): string => {
    const question = pod.waits.latestQuestionFor(task.rootId)
    if (question !== undefined) {
      const answered = pod.waits.answer({ waitId: question.id, answer: messages.map((message) => message.body).join('\n') })
      if (!answered.ok) return answered.error.message
      transaction(pod.db, () => {
        for (const message of messages) pod.engine.topics.decide(message.id, session.botId, 'relayed', task.id)
        const last = messages.at(-1)
        const fresh = pod.tasks.get(task.id)
        if (last !== undefined && fresh !== undefined) pod.engine.tickets.addReplyTarget(fresh, { roomId: last.roomId, messageId: last.id })
      })
      return `转给了「${task.title}」：算作对「${question.title}」的答复`
    }
    const name = me()?.name ?? '前台'
    const owner = task.ownerBotId === null ? undefined : pod.bots.get(task.ownerBotId)
    const text = item.brief !== '' ? item.brief : [...messages.map((message) => `用户又说：「${message.body}」`), ...(item.note === '' ? [] : [item.note])].join('\n')
    const body = conversation.kind !== 'direct' && owner !== undefined && owner.id !== session.botId ? `@${owner.name} ${text}` : text
    const posted = pod.rooms.post(conversation.id, { author: session.botId, kind: 'text', body, data: { purpose: 'followup', taskId: task.id } })
    if (posted === undefined) return '后续没发进任务对话'
    const sent = pod.intake.followUp(task, posted, name, messages, session.botId)
    return sent.ok ? `转给了「${task.title}」：后续发在它的对话里，它在那里回` : sent.error.message
  }

  const forward = (item: Item, messages: readonly RoomMessage[], task: Task): string => {
    if (task.endedAt !== null && task.endReason === 'stopped') return `任务「${task.title}」已经停掉了；要接着做，请用户点继续`
    const errors: string[] = []
    const name = me()?.name ?? '前台'
    const conversation = isTicket(task) ? taskConversationOf(pod.db, task.id) : undefined
    if (conversation !== undefined) return forwardInto(item, messages, task, conversation)
    if (isTicket(task)) {
      // 写了完整后续的，后续挂在第一条上送一次（以前台的名义），其余几条照原话送。
      const [head, ...rest] = messages
      const plan = item.brief !== '' && head !== undefined ? [{ message: head, followUp: { author: name, text: item.brief } }, ...rest.map((message) => ({ message, followUp: undefined }))] : messages.map((message) => ({ message, followUp: undefined }))
      for (const step of plan) {
        const sent = pod.intake.forward(task, step.message, session.botId, step.followUp === undefined && item.brief === '' ? item.note : '', step.followUp)
        if (!sent.ok) errors.push(`${step.message.id}：${sent.error.message}`)
      }
      return errors.length > 0 ? errors.join('；') : `转给了「${task.title}」`
    }
    // 转进去的是 Super-agent 写的一条完整后续；没写的照旧一条条带上原话。
    const sends =
      item.brief !== ''
        ? [{ messages, text: item.brief, quote: { id: null, author: name, replyTo: null, text: item.brief } as const }]
        : messages.map((message) => ({ messages: [message], text: `用户又说：「${message.body}」${item.note === '' ? '' : `\n${item.note}`}`, quote: message.body }))
    for (const send of sends) {
      const sent = pod.tasks.sendToTask(task, send.text, ownerSource(), send.quote)
      if (!sent.ok) errors.push(`${send.messages.map((message) => message.id).join('、')}：${sent.error.message}`)
      else for (const message of send.messages) pod.engine.topics.decide(message.id, session.botId, 'relayed', task.id, item.brief !== '' ? item.brief : item.note)
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
      'open 开任务交给对口的 bot（要查要跑的、要写成长东西的），brief 写交代；forward 转给明确指向的任务（同时让它跟进那条消息所在的话题），brief 写完整的后续；',
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
      '对用户说话：发一条消息到聊天室。写明回的是哪条消息（to，不回具体某条就写 room）和用途：confirm 确认（开了任务后回一句，任务卡挂在这句下面；转给任务后回一句，task 写那个任务，消息开头挂任务记号）、answer 答复（第一句就是答案）、relay 转告（任务问用户、没做成时，task 写那个任务，消息开头挂任务记号，任务问的事做成卡片挂在这句下面；交的回答 dsh-bot 会以你的名义原样发，不用转告）。用户问任务的细节时只讲问的那部分，task 写那个任务。你在别处写的文字用户看不到，只有 reply 会发出去。',
    properties: {
      to: str('回哪条消息（消息 id）'),
      room: str('不回具体某条时，发到哪个聊天室（room id）'),
      purpose: oneOf('confirm 确认 / answer 答复 / relay 转告', ['confirm', 'answer', 'relay']),
      text: str('要说的话'),
      task: str('relay、confirm：说的是哪个任务（任务 id）；answer：答的是哪个任务（可选）'),
    },
    required: ['purpose', 'text'],
    parse: (args) => {
      const body = text(args, 'text')
      if (body === '') return '要写说什么'
      const to = text(args, 'to')
      const room = text(args, 'room')
      if (to === '' && room === '') return '要写回哪条消息（to）或者发到哪个聊天室（room）'
      const raw = text(args, 'purpose')
      const purpose: 'confirm' | 'answer' | 'relay' = raw === 'confirm' || raw === 'relay' ? raw : 'answer'
      if (purpose === 'relay' && text(args, 'task') === '') return '转告要写 task（任务 id）'
      return { to, room, purpose, body, task: text(args, 'task') }
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
      // 转告和确认挂任务记号（taskId）：刚开任务的那句没写 task 时挂这个聊天室刚开的任务，任务卡挂在这句下面。答复附报告（reportTaskId）。
      const chipTask = purpose === 'answer' ? undefined : (about?.rootId ?? (purpose === 'confirm' ? pod.front.openedIn(session.botId, target.id) : undefined))
      // 转告任务在问的事：那件事的卡片（问题、批准、登录）挂在这句下面，在这里点就是答复。
      const asked = purpose === 'relay' && about !== undefined ? pod.waits.latestOpenFor(about.rootId) : undefined
      // 走回复队列：按顺序发、留回执；群里挂在回的那条下面，单聊里回的正是最新那句就不挂引用。
      const messageId = pod.replies.send({
        roomId: target.id,
        author: session.botId,
        purpose,
        body,
        sessionId: session.id,
        replyTo: replied?.id ?? null,
        ...(chipTask === undefined ? {} : { taskId: chipTask }),
        data: {
          ...(pageId === undefined ? {} : { pageId }),
          ...(about === undefined || purpose !== 'answer' ? {} : { reportTaskId: about.rootId }),
          ...(asked === undefined ? {} : { waitId: asked.id }),
        },
      })
      if (replied !== undefined && purpose === 'answer' && pod.engine.topics.awaiting(replied.id, session.botId)) pod.engine.topics.decide(replied.id, session.botId, 'answered')
      pod.front.confirmed(session.botId, target.id)
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
