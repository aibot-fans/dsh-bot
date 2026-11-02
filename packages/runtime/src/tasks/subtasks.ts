import type { DatabaseSync } from 'node:sqlite'
import { PRIORITY, TICKET_STAGE_LABELS, childTaskFolder, fail, newAcceptance, newId, ok, t, truncate, type Bot, type PodResult, type PodSession, type Room, type Task, type TaskOrigin, type TaskReport } from 'pod-domain'
import { getMessage, latestDecisiveReport, runsFor, taskCardMessage, taskRoomOf, transaction } from 'pod-store'
import { noticeSource } from '../agents/messages.ts'
import type { BotService } from '../bots/service.ts'
import type { RoomService } from '../chat/rooms.ts'
import type { Auditor } from '../core/audit.ts'
import type { Dispatcher } from '../effects/delivery.ts'
import { isTicket, type Engine } from '../engine/index.ts'
import type { TaskService } from './service.ts'
import { CARD_LIMITS, clipCard } from '../core/cards.ts'

/** 子任务验收没通过最多返工几次。 */
export const MAX_REWORKS = 2

const SELF_NAMES = new Set(['自己', '我', 'me', 'self'])

export interface SubtaskInput {
  readonly title: string
  readonly bot: string
  readonly brief: string
  readonly acceptance: readonly string[]
  /** 等这个子任务就绪再开工（子任务 id），空的马上开工。 */
  readonly after: string
}

/** 子任务这次汇报了什么（告诉组长用）。 */
export interface SubtaskReport {
  readonly report: TaskReport
  readonly question: string
  /** 问题已经交给用户（登录、写入审批这类）。 */
  readonly toOwner: boolean
  readonly files: readonly string[]
}

export interface SubtaskDeps {
  readonly db: DatabaseSync
  readonly engine: Engine
  readonly tasks: TaskService
  readonly rooms: RoomService
  readonly bots: BotService
  readonly dispatcher: Dispatcher
  readonly audit: Auditor
}

/**
 * 团队任务：任务会话要别人帮忙就开子任务，自己当组长。子任务是挂在根任务下的工单（L1），
 * 交给某个 bot（也可以是组长自己），各有会话和文件夹，同时跑；开第一个子任务时建任务群，整个群是一个话题，
 * 组长跟进，子任务只读跟进。子任务的汇报交给组长：就绪的由组长验收（最多返工 2 次），受阻、失败由组长定，
 * 只有登录、写入审批这类必须你出面的才找你。子任务不再开子任务。
 */
export class Subtasks {
  private readonly deps: SubtaskDeps

  constructor(deps: SubtaskDeps) {
    this.deps = deps
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  private name(botId: string | null): string {
    return botId === null ? 'bot' : (this.deps.bots.get(botId)?.name ?? 'bot')
  }

  private label(task: Task): string {
    return `「${task.title}」（${task.id}，${this.name(task.ownerBotId)}）`
  }

  /** 这条会话能当组长的任务：根任务（工单）才能开子任务。 */
  leaderTask(session: PodSession): PodResult<Task> {
    const task = this.deps.tasks.taskOf(session)
    if (task === undefined || session.kind !== 'task') return fail('not-found', t('这条会话没有对应的任务'))
    if (task.parentId !== null) return fail('conflict', t('子任务不能再开子任务；要别人帮忙，在汇报里说明，组长来安排'))
    if (!isTicket(task)) return fail('conflict', t('这个任务是按旧计划组队的，不能开子任务'))
    if (task.endedAt !== null) return fail('conflict', t('任务已经结束'))
    return ok(task)
  }

  /** 组长的子任务：按 id 找，必须是这个任务下面的。 */
  private childOf(parent: Task, id: string): PodResult<Task> {
    const child = this.deps.tasks.get(id.trim())
    if (child === undefined || child.parentId !== parent.id) return fail('not-found', t('「{id}」不是这个任务的子任务，用 list_subtasks 查', { id }))
    return ok(child)
  }

  private bot(session: PodSession, name: string): PodResult<Bot> {
    const self = this.deps.bots.get(session.botId)
    if (self === undefined) return fail('not-found', t('找不到你自己'))
    if (name === '' || SELF_NAMES.has(name.toLowerCase()) || name === self.name) return ok(self)
    const bot = this.deps.bots.resolve(name)
    if (bot === undefined || bot.archivedAt !== null) return fail('not-found', t('找不到 bot「{name}」', { name }))
    return ok(bot)
  }

  /** 任务群：开第一个子任务时建，组长跟进整个群的话题，你在群里说的话直接到组长。 */
  private room(parent: Task, leader: string, member: string): Room {
    const existing = taskRoomOf(this.db, parent.id)
    const room = existing ?? this.deps.rooms.createTaskRoom(parent.title, parent.id, [leader, member], null)
    if (existing !== undefined) this.deps.rooms.addMember(room.id, member)
    const topic = this.deps.engine.topics.ensureTeam(room.id, parent.id)
    this.deps.engine.topics.follow(parent.id, topic.id, 'own')
    if (existing === undefined) {
      // 原来的任务卡上多一个“打开群聊”，子任务的进展在那里；不另发里程碑。
      const cardId = taskCardMessage(this.db, parent.id)
      const card = cardId === undefined ? undefined : getMessage(this.db, cardId)
      if (card !== undefined && card.roomId !== room.id) this.deps.rooms.patchMessage(card.id, { data: { ...card.data, roomId: room.id } })
      this.deps.tasks.event(parent, 'team_room', leader, { roomId: room.id, title: room.title })
    }
    return room
  }

  open(session: PodSession, input: SubtaskInput): PodResult<{ readonly task: Task; readonly room: Room; readonly waiting: boolean }> {
    const leader = this.leaderTask(session)
    if (!leader.ok) return leader
    const parent = leader.value
    const bot = this.bot(session, input.bot)
    if (!bot.ok) return bot
    const after = input.after === '' ? undefined : this.childOf(parent, input.after)
    if (after !== undefined && !after.ok) return after
    const upstream = after?.value
    const id = newId('task')
    const opened = transaction(this.db, () => {
      const room = this.room(parent, session.botId, bot.value.id)
      const origin: TaskOrigin = { kind: 'bot', quotes: parent.origin?.quotes ?? [], requester: session.botId, roomId: room.id, rule: null, title: input.title, note: '' }
      const task = this.deps.engine.tickets.open({
        id,
        rootId: parent.rootId,
        parentId: parent.id,
        roomId: room.id,
        teamId: null,
        title: input.title,
        brief: input.brief,
        kind: '',
        deliverable: '',
        acceptance: newAcceptance(input.acceptance),
        dependsOn: upstream === undefined ? [] : [upstream.id],
        needs: { browser: false, shell: false },
        ownerBotId: bot.value.id,
        level: 'L1',
        folder: childTaskFolder(parent.folder, { id, title: input.title }),
        urgent: parent.urgent,
        tainted: parent.tainted,
        createdBy: session.id,
        requesterSession: session.id,
        origin,
        replyTo: [],
        actor: session.botId,
      })
      // 子任务只读跟进整个群：在跑的下一步看到别人的结论；回复它的任务卡直接到它。
      this.deps.engine.topics.follow(task.id, this.deps.engine.topics.ensureTeam(room.id, parent.id).id, 'readonly')
      const card = this.deps.rooms.post(room.id, { author: session.botId, kind: 'task-card', body: input.title, data: { taskId: id, rootId: parent.rootId, parentId: parent.id } })
      if (card !== undefined) this.deps.engine.topics.followMessage(id, card.id, 'own')
      this.deps.tasks.event(parent, 'subtask_opened', session.botId, { taskId: id, title: input.title, to: bot.value.id, after: upstream?.id ?? null })
      const waiting = upstream !== undefined && !this.isReady(upstream)
      if (!waiting) this.deps.engine.runs.queue(id, 'new', {})
      return { task: this.deps.tasks.get(id) ?? task, room, waiting }
    })
    this.deps.audit.record('task.subtask', session.botId, id, { parent: parent.id, to: bot.value.id, title: input.title })
    return ok(opened)
  }

  /** 交上来了（最后一次汇报是就绪）或者已经完成。 */
  private isReady(task: Task): boolean {
    if (task.endedAt !== null) return task.endReason === 'done'
    return latestDecisiveReport(this.db, task.id)?.status === 'ready'
  }

  /** 等它就绪才开工的子任务：现在开工。 */
  private startAfter(task: Task): void {
    for (const sibling of this.deps.engine.tickets.openChildren(task.parentId ?? '')) {
      if (!sibling.dependsOn.includes(task.id) || runsFor(this.db, sibling.id).length > 0) continue
      this.deps.engine.runs.queue(sibling.id, 'new', {})
    }
  }

  /** 验收：通过就完成；没通过把要改的地方带给它接着改，最多返工 2 次。 */
  review(session: PodSession, input: { readonly subtask: string; readonly pass: boolean; readonly feedback: string }): PodResult<string> {
    const leader = this.leaderTask(session)
    if (!leader.ok) return leader
    const found = this.childOf(leader.value, input.subtask)
    if (!found.ok) return found
    const child = found.value
    if (child.endedAt !== null) return fail('conflict', t('这个子任务已经结束了'))
    if (latestDecisiveReport(this.db, child.id)?.status !== 'ready') return fail('conflict', t('它还没交上来，等它报就绪再验收'))
    if (input.pass) {
      transaction(this.db, () => {
        this.deps.engine.tickets.end(child.id, 'done', session.botId)
        this.deps.tasks.event(child, 'reviewed', session.botId, { pass: true, feedback: input.feedback })
      })
      return ok(`${t('已通过。')}\n${this.boardLine(leader.value)}`)
    }
    if (input.feedback === '') return fail('invalid-input', t('没通过要写清哪里没达到、要怎么改'))
    const reworks = runsFor(this.db, child.id).filter((run) => run.reason === 'review').length
    if (reworks >= MAX_REWORKS) return fail('conflict', t('已经返工 {count} 次了：自己补上、改派给别人，或者接受现状在汇报里注明', { count: reworks }))
    transaction(this.db, () => {
      this.deps.tasks.event(child, 'reviewed', session.botId, { pass: false, feedback: input.feedback })
      this.deps.engine.runs.queue(child.id, 'review', { feedback: input.feedback, round: reworks + 1 })
    })
    return ok(t('已打回，第 {round} 次返工：要改的地方已经带给它。', { round: reworks + 1 }))
  }

  /** 给子任务补一句话（答复它的问题、改要求）：在跑就送进会话，没在跑就开一次执行带上。 */
  tell(session: PodSession, input: { readonly subtask: string; readonly text: string }): PodResult<string> {
    const leader = this.leaderTask(session)
    if (!leader.ok) return leader
    const found = this.childOf(leader.value, input.subtask)
    if (!found.ok) return found
    const child = found.value
    if (child.endedAt !== null && child.endReason === 'stopped') return fail('conflict', t('这个子任务已经停掉了，要接着做就重新开一个'))
    const author = this.name(session.botId)
    transaction(this.db, () => {
      if (child.endedAt !== null) this.deps.engine.tickets.reopen(child.id, session.botId)
      const run = this.deps.engine.runs.current(child.id)
      if (run?.status === 'running' && run.sessionId !== null) {
        this.deps.dispatcher.enqueue({ sessionId: run.sessionId, mode: 'followup', priority: PRIORITY.task, text: `[组长${author}] ${input.text}`, source: noticeSource(t('组长补了一句')) })
      } else this.deps.engine.runs.queue(child.id, 'message', { messages: [{ id: null, author: `组长${author}`, replyTo: null, text: input.text }] })
    })
    return ok(t('已经转给「{title}」。', { title: child.title }))
  }

  stop(session: PodSession, subtask: string): PodResult<string> {
    const leader = this.leaderTask(session)
    if (!leader.ok) return leader
    const found = this.childOf(leader.value, subtask)
    if (!found.ok) return found
    if (found.value.endedAt !== null) return fail('conflict', t('这个子任务已经结束了'))
    this.deps.engine.tickets.end(found.value.id, 'stopped', session.botId)
    return ok(`${t('已停掉。')}\n${this.boardLine(leader.value)}`)
  }

  /** 子任务一览：每个一行，id、标题、负责的 bot、阶段、最近的进度说明。 */
  board(parent: Task): string {
    const children = this.children(parent)
    if (children.length === 0) return t('还没有子任务。')
    return children
      .map((child) => {
        const stage = child.ticketStage === null ? '' : child.ticketStage === 'review' ? '等组长验收' : TICKET_STAGE_LABELS[child.ticketStage]
        const waiting = child.ticketStage === 'queued' && child.dependsOn.length > 0 && runsFor(this.db, child.id).length === 0 ? `，等 ${child.dependsOn.join('、')} 就绪` : ''
        const note = child.note === '' ? '' : ` · ${truncate(child.note, 80)}`
        const ended = child.endedAt === null ? '' : `（${child.endReason === 'done' ? '已完成' : child.endReason === 'stopped' ? '停掉了' : '无需处理'}）`
        return `- ${child.id}「${child.title}」（${this.name(child.ownerBotId)}） · ${child.endedAt === null ? stage : ended}${waiting}${note}`
      })
      .join('\n')
  }

  private children(parent: Task): readonly Task[] {
    return this.deps.tasks.tree(parent.rootId).filter((task) => task.parentId === parent.id)
  }

  /** 一行进度：完成几个、还开着几个。 */
  boardLine(parent: Task): string {
    const children = this.children(parent)
    const open = children.filter((child) => child.endedAt === null)
    if (open.length === 0) return t('子任务都结束了：合成结果，用 report 报 ready。')
    return t('子任务还开着 {open} 个（共 {total} 个）：{titles}', { open: open.length, total: children.length, titles: open.map((child) => `「${child.title}」`).join('、') })
  }

  /** 还没结束的子任务（组长报就绪前要先处理完）。 */
  openChildren(parent: Task): readonly Task[] {
    return this.deps.engine.tickets.openChildren(parent.id)
  }

  /** 子任务汇报了：告诉组长（在跑就送进会话，没在跑就开一次执行带上）；就绪的让等它的子任务开工。 */
  reported(child: Task, input: SubtaskReport): void {
    const parent = child.parentId === null ? undefined : this.deps.tasks.get(child.parentId)
    if (parent === undefined || parent.endedAt !== null) return
    const { report } = input
    if (report.status === 'ready') this.startAfter(child)
    const text = this.noticeText(child, input)
    if (text === undefined) return
    const full = `${text}\n${this.boardLine(parent)}`
    transaction(this.db, () => {
      const run = this.deps.engine.runs.current(parent.id)
      if (run?.status === 'running' && run.sessionId !== null) {
        this.deps.dispatcher.enqueue({ sessionId: run.sessionId, mode: 'followup', priority: PRIORITY.task, text: full, source: noticeSource(t('子任务有了新进展')) })
      } else this.deps.engine.runs.queue(parent.id, 'subtask', { notices: [full] })
    })
  }

  /** 送给组长的汇报：汇报 id、状态、摘要、问题，摘要和问题太长截断留 id；报告全文只给 id。 */
  private noticeText(child: Task, input: SubtaskReport): string | undefined {
    const { report } = input
    const label = this.label(child)
    const summary = clipCard(report.summary, CARD_LIMITS.report - 200, report.id)
    const question = clipCard(input.question, 200, report.id)
    switch (report.status) {
      case 'ready': {
        const files = input.files.length === 0 ? '' : `；文件：${input.files.join('、')}`
        return `[子任务就绪] ${label}：${summary}\n报告 ${report.id}（用 read 读全文）${files}\n用 review_subtask 验收：通过，或者写清要改什么打回（最多返工 ${MAX_REWORKS} 次）。`
      }
      case 'blocked':
        return input.toOwner
          ? `[子任务等用户] ${label}：${question}（汇报 ${report.id}，已经交给用户处理，用户答复后它接着做）`
          : `[子任务受阻] ${label}：${summary}\n问题：${question}\n汇报 ${report.id}。用 tell_subtask 答复它，它会接着做；也可以改派、自己做或者 stop_subtask 停掉。`
      case 'failed':
        return `[子任务没做成] ${label}：${summary}\n汇报 ${report.id}。你来定：tell_subtask 换个做法再试、改派、自己做，或者 stop_subtask 停掉。`
      case 'dismissed':
        return `[子任务无需处理] ${label}：${summary}（汇报 ${report.id}）`
      default:
        return undefined
    }
  }
}
