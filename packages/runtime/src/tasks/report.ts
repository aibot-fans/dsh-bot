import {
  REPORT_STATUSES,
  WAIT_KINDS,
  fail,
  needsReport,
  ok,
  t,
  type PodResult,
  type PodSession,
  type ReportStatus,
  type Task,
  type TaskResult,
  type Wait,
  type WaitKind,
} from 'pod-domain'
import type { BotService } from '../bots/service.ts'
import type { ToolDefinition } from '../dsh.ts'
import { isTicket, type Engine } from '../engine/index.ts'
import type { PodRuntime } from '../pod.ts'
import { bool, failure, flag, intList, oneOf, podTool, str, strList, success, text, texts, ints } from '../tools/define.ts'
import type { TaskReplies } from './replies.ts'
import type { TaskService } from './service.ts'
import type { Subtasks } from './subtasks.ts'
import type { TaskTurns } from './turns.ts'

export interface ReportArgs {
  readonly status: ReportStatus
  readonly summary: string
  readonly report: string
  readonly question: string
  readonly questionKind: WaitKind
  /** 问题的几个选项，你点一下就是答复。 */
  readonly options: readonly string[]
  /** 每个选项下面的一句说明，和选项一一对应，没写的是空串。 */
  readonly optionNotes: readonly string[]
  /** 第一个选项是 bot 推荐的。 */
  readonly recommended: boolean
  readonly aboutMessage: string | null
  readonly replyMessage: string | null
  /** 勾的验收项（组长给子任务写的），编号从 1 开始。 */
  readonly checks: readonly number[]
  /** 要的东西本身是文件时，文件的路径。 */
  readonly files: readonly string[]
  readonly lessons: string
}

export interface ReportingDeps {
  readonly tasks: TaskService
  readonly engine: Engine
  readonly turns: TaskTurns
  readonly bots: BotService
  readonly ask: (input: {
    readonly session: PodSession
    readonly kind: WaitKind
    readonly title: string
    readonly detail: string
    readonly reportId: string | null
    /** 写给用户的那段说明（汇报的 summary），卡片上显示它；detail 里还带着给 Super-agent 和组长看的 report。 */
    readonly summary: string
    readonly options: readonly string[]
    readonly optionNotes: readonly string[]
    readonly recommended: boolean
  }) => Wait
  readonly notify: (task: Task, event: 'done' | 'failed' | 'stalled') => void
  readonly onRootStateChange: (rootId: string, change: 'delivered') => readonly string[]
  readonly onSubtaskStalled: (task: Task, reason: string) => void
  readonly learn: (session: PodSession, task: Task, lessons: string) => void
  /** 汇报时这一轮之前收进历史的消息都算读过（任务结束时没读的才退回前台）。 */
  readonly markRead: (sessionId: string) => void
  /** 结果、等你发到聊天室（走回复队列）。 */
  readonly replies: TaskReplies
  readonly subtasks: Subtasks
}

/**
 * 汇报的后续：引擎记下汇报、改执行和阶段，这里做对外的事——就绪的回答作为结果发出去、受阻的问题进等你、
 * 失败由干活的 bot 回复任务卡说原因；进展、等消息和无需处理不说话（只更新任务卡）。
 * 团队子任务按旧的提交、找你、停滞走。
 */
export class TaskReporting {
  private readonly deps: ReportingDeps

  constructor(deps: ReportingDeps) {
    this.deps = deps
  }

  report(session: PodSession, args: ReportArgs): PodResult<{ readonly task: Task; readonly message: string }> {
    const task = this.deps.tasks.taskOf(session)
    if (task === undefined || session.kind !== 'task') return fail('not-found', t('这条会话没有对应的任务'))
    if (task.endedAt !== null) return fail('conflict', t('任务已经结束'))
    this.deps.markRead(session.id)
    return isTicket(task) ? this.ticket(session, task, args) : this.subtask(session, task, args)
  }

  /** 交的结果就是那条回答；假设、没核实的、跳过的都写在回答里，这里只记被绕过的几项。 */
  private result(args: ReportArgs, extra: readonly string[] = []): TaskResult {
    return { summary: args.summary, files: args.files, assumptions: [], unverified: extra, skipped: [] }
  }

  private record(session: PodSession, task: Task, args: ReportArgs): ReturnType<Engine['runs']['report']> {
    return this.deps.engine.runs.report({
      task,
      author: session.botId,
      status: args.status,
      summary: args.summary,
      report: args.report,
      question: args.question,
      aboutMessage: args.aboutMessage,
      replyMessage: args.replyMessage,
      checks: args.checks.map((index) => index - 1),
      acceptance: [],
      data: { files: args.files },
    })
  }

  private ask(session: PodSession, args: ReportArgs, reportId: string | null): void {
    this.deps.ask({
      session,
      kind: args.questionKind,
      title: args.question,
      detail: [args.summary, args.report].filter(Boolean).join('\n\n'),
      reportId,
      summary: args.summary,
      options: args.options,
      optionNotes: args.optionNotes,
      recommended: args.recommended,
    })
  }

  private ticket(session: PodSession, task: Task, args: ReportArgs): PodResult<{ readonly task: Task; readonly message: string }> {
    const { engine, tasks, replies } = this.deps
    if (task.parentId !== null) return this.child(session, task, args)
    const open = args.status === 'ready' ? this.deps.subtasks.openChildren(task) : []
    if (open.length > 0) {
      return fail('conflict', t('还有子任务没结束：{titles}。先用 review_subtask 验收，或者 stop_subtask 停掉', { titles: open.map((child) => `${child.id}「${child.title}」`).join('、') }))
    }
    const outcome = this.record(session, task, args)
    if (args.status !== 'progress') this.deps.turns.clear(task.id)
    const bot = this.deps.bots.get(session.botId)
    switch (args.status) {
      case 'progress':
        return ok({ task: outcome.task, message: t('已更新任务卡') })
      case 'waiting': {
        const restored = this.restoreIfMisrouted(outcome.task, outcome.report.runId)
        return ok({ task: restored ?? outcome.task, message: t('已记下：这一步做完了，等后续消息。这一轮到这里结束。') })
      }
      case 'blocked': {
        this.ask(session, args, outcome.report.id)
        return ok({ task: engine.tickets.get(task.id) ?? outcome.task, message: t('已经交给用户处理；用户答复后会开一次新的执行，答复带给你。这一轮到这里结束。') })
      }
      case 'failed':
        replies.wait(outcome.task, session.botId, { body: args.summary, sessionId: session.id })
        this.deps.notify({ ...outcome.task, note: args.summary }, 'failed')
        tasks.tellRequester(outcome.task, `[任务没做成] 「${task.title}」：${args.summary}`)
        return ok({ task: outcome.task, message: t('已记下失败，等用户决定重试还是结束。这一轮到这里结束。') })
      case 'dismissed':
        return ok({ task: outcome.task, message: outcome.standing ? t('已记下：这次没有要说的，不发消息，等下次到点。') : t('已记下：无需处理，任务结束。') })
      case 'ready': {
        const bypassed = this.deps.onRootStateChange(task.rootId, 'delivered')
        const result = this.result(args, bypassed)
        const delivered = engine.tickets.patch(outcome.task, { result })
        // 交的回答原样回在每一处还没得到答复的提问下面，开了群的发在群里；交了就算做完。
        replies.result(delivered, session.botId, session.id, result.summary, outcome.report.id)
        if (args.lessons !== '') this.deps.learn(session, delivered, args.lessons)
        if (outcome.standing) return ok({ task: delivered, message: t('已发出这次的结果，等下次到点。') })
        tasks.tellRequester(delivered, `[任务交付] 「${delivered.title}」已完成，结果已经发给用户。摘要：${args.summary}`)
        this.deps.notify(delivered, 'done')
        if (bot !== undefined && bot.temporary && bot.role === 'member' && outcome.completed) tasks.retireTemporary(bot)
        return ok({ task: delivered, message: t('已交付。') })
      }
    }
  }

  /**
   * 子任务：汇报交给组长。就绪的结果回复在它的任务卡下面，等组长验收；拿不准的事（ambiguity）由组长定，
   * 登录、写入审批这类必须用户出面的才找用户；失败和无需处理组长来定。
   */
  private child(session: PodSession, task: Task, args: ReportArgs): PodResult<{ readonly task: Task; readonly message: string }> {
    const { engine, replies, subtasks } = this.deps
    const outcome = this.record(session, task, args)
    if (args.status !== 'progress') this.deps.turns.clear(task.id)
    const told = (toOwner: boolean): void => subtasks.reported(engine.tickets.get(task.id) ?? outcome.task, { report: outcome.report, question: args.question, toOwner, files: args.files })
    switch (args.status) {
      case 'progress':
        return ok({ task: outcome.task, message: t('已更新任务卡') })
      case 'waiting':
        return ok({ task: outcome.task, message: t('已记下：这一步做完了，等后续消息。这一轮到这里结束。') })
      case 'blocked': {
        const toOwner = args.questionKind !== 'ambiguity'
        if (toOwner) this.ask(session, args, outcome.report.id)
        told(toOwner)
        return ok({
          task: engine.tickets.get(task.id) ?? outcome.task,
          message: toOwner ? t('已经交给用户处理；用户答复后会开一次新的执行，答复带给你。这一轮到这里结束。') : t('已经交给组长；组长答复后会开一次新的执行，答复带给你。这一轮到这里结束。'),
        })
      }
      case 'failed':
        told(false)
        return ok({ task: outcome.task, message: t('已记下失败，交给组长处理。这一轮到这里结束。') })
      case 'dismissed':
        told(false)
        return ok({ task: outcome.task, message: t('已记下：无需处理，子任务结束。') })
      case 'ready': {
        const result = this.result(args)
        const delivered = engine.tickets.patch(outcome.task, { result })
        replies.result(delivered, session.botId, session.id, result.summary)
        if (args.lessons !== '') this.deps.learn(session, delivered, args.lessons)
        told(false)
        return ok({ task: delivered, message: t('已交给组长验收。') })
      }
    }
  }

  /**
   * 结束了的任务被一条消息重新打开，它却把这次带来的消息都交还了：恢复成原来的结束方式，
   * 免得一条走错的消息让做完的任务一直开着。
   */
  private restoreIfMisrouted(task: Task, runId: string | null): Task | undefined {
    const { engine } = this.deps
    const run = runId === null ? undefined : engine.runs.get(runId)
    const reopened = run?.detail.reopened
    if (run === undefined || (reopened !== 'done' && reopened !== 'dismissed')) return undefined
    const ids = (Array.isArray(run.detail.messages) ? run.detail.messages : []).flatMap((item) =>
      typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).id === 'string' ? [(item as Record<string, unknown>).id as string] : [],
    )
    if (ids.length === 0 || !ids.every((id) => engine.topics.handedBack(id, task.id))) return undefined
    return engine.tickets.end(task.id, reopened, 'pod')
  }

  /** 团队子任务：进展勾验收项，就绪交给组长验收，受阻找你，失败交给组长处理。 */
  private subtask(session: PodSession, task: Task, args: ReportArgs): PodResult<{ readonly task: Task; readonly message: string }> {
    const { tasks } = this.deps
    switch (args.status) {
      case 'progress': {
        const updated = tasks.progress(session, args.checks, args.summary)
        return updated.ok ? ok({ task: updated.value, message: t('已更新任务卡') }) : updated
      }
      case 'ready':
      case 'dismissed': {
        const submitted = tasks.submit(session, this.result(args))
        if (submitted.ok && args.lessons !== '') this.deps.learn(session, submitted.value, args.lessons)
        return submitted.ok ? ok({ task: submitted.value, message: t('已交给组长验收。') }) : submitted
      }
      case 'blocked':
        this.ask(session, args, null)
        return ok({ task, message: t('已经交给用户处理；先做不依赖这件事的部分，都做不了就结束这一轮。') })
      case 'failed': {
        const failed = tasks.write(task, { status: 'failed', note: args.summary })
        tasks.event(failed, 'stalled', session.botId, { reason: args.summary })
        this.deps.onSubtaskStalled(failed, args.summary)
        return ok({ task: failed, message: t('已交给组长处理。') })
      }
      case 'waiting':
        return ok({ task, message: t('已记下。') })
    }
  }
}

const ASK_KINDS: readonly WaitKind[] = WAIT_KINDS.filter((kind) => kind === 'login' || kind === 'write' || kind === 'security' || kind === 'ambiguity')

/** 问题最多给几个选项。 */
const MAX_OPTIONS = 6

/** 选项和它下面的说明：一一对应，空的选项连同说明一起不要，没写说明的是空串。 */
function optionsOf(args: Readonly<Record<string, unknown>>): { readonly options: readonly string[]; readonly notes: readonly string[] } {
  const listOf = (key: string): readonly string[] => (Array.isArray(args[key]) ? (args[key] as readonly unknown[]).map((item) => (typeof item === 'string' ? item.trim() : '')) : [])
  const notes = listOf('option_notes')
  const pairs = listOf('options')
    .map((option, index): readonly [string, string] => [option, notes[index] ?? ''])
    .filter(([option]) => option !== '')
    .slice(0, MAX_OPTIONS)
  return { options: pairs.map(([option]) => option), notes: pairs.map(([, note]) => note) }
}

/** 汇报工具：任务会话用它交结果、问问题、报失败，代替以前的 update_task、complete_task、ask_owner。 */
export function reportTool(pod: PodRuntime, session: PodSession): ToolDefinition {
  const current = (): PodSession => pod.registry.get(session.id) ?? session
  return podTool({
    name: 'report',
    description: [
      '向 dsh-bot 汇报这个任务，一次只能是一种状态，最多附一个问题：',
      'progress 里程碑（做成了一步，带着时间列在任务对话的进展里，不叫醒谁，聊天室里不说话）；waiting 这一步做完了，等后续消息；ready 做完了，交上回答；',
      'blocked 缺东西做不下去（登录、权限、用户的决定），必须附一个问题；failed 试过了做不成，写原因；dismissed 看过了不用做（重复、已经做过）。',
      'summary 会原样发到对话里：ready 时是给用户的完整回答，failed 时是原因；progress 时是做成了什么，只进进展；blocked、failed 还要写 report（卡在哪、试过什么，不发到对话里）。',
      '交了就算做完，不用用户验收。除了 progress，汇报后这一轮结束。',
    ].join(''),
    properties: {
      status: oneOf('progress / waiting / ready / blocked / failed / dismissed', [...REPORT_STATUSES]),
      summary: str('发到对话里的话。ready：给用户的完整回答，先一句说答案，再列要点，来源、假设、没核实的写在里面；failed：没做成的原因；progress：一句做成了什么（比如“找到 3 家的公开报价”），不写正在做什么'),
      report: str('blocked、failed 必填：卡在哪、试过什么、还缺什么，给 Super-agent 和组长看，不发到对话里'),
      question: str('blocked 时要用户处理的事：只问一个问题，一句话说清'),
      options: strList('问题的选项（2–6 个，能给就给），用户点一下就是答复；有推荐的放第一个，recommended 写 true'),
      option_notes: strList('每个选项下面的一句说明（选了会怎样、代价），和 options 一一对应'),
      recommended: bool('第一个选项是你推荐的'),
      question_kind: oneOf('问题的种类：login 需要登录或验证；write 要批准不可撤回的对外操作；security 被安全规则拦下；ambiguity 要用户拿主意', [...ASK_KINDS]),
      about_message: str('问题针对哪条消息（消息 id，可选）'),
      reply_message: str('这次汇报回的是哪条消息（消息 id，可选）'),
      checks: intList('组长写了验收项的子任务：ready 或 progress 时勾上的编号，从 1 开始；ready 不写就当作都过了'),
      files: strList('只在用户要的东西本身是文件（文档、表格、代码）时写：文件的路径，回答里也要说'),
      lessons: str('这次学到的做法或教训（可选，会写进你的经验）'),
    },
    required: ['status', 'summary'],
    parse: (args) => {
      const status = text(args, 'status')
      if (!(REPORT_STATUSES as readonly string[]).includes(status)) return 'status 只能是 progress、waiting、ready、blocked、failed、dismissed'
      const summary = text(args, 'summary')
      if (summary === '') return '摘要不能为空'
      const report = text(args, 'report')
      if (needsReport(status as ReportStatus) && report === '') return `${status} 要写 report（卡在哪、试过什么）`
      const question = text(args, 'question')
      if (status === 'blocked' && question === '') return 'blocked 要附一个问题'
      const kind = text(args, 'question_kind')
      const { options, notes } = optionsOf(args)
      return {
        status: status as ReportStatus,
        summary,
        report,
        question,
        questionKind: (ASK_KINDS as readonly string[]).includes(kind) ? (kind as WaitKind) : 'ambiguity',
        options,
        optionNotes: notes,
        recommended: flag(args, 'recommended') === true && options.length > 0,
        aboutMessage: text(args, 'about_message') || null,
        replyMessage: text(args, 'reply_message') || null,
        checks: ints(args, 'checks'),
        files: texts(args, 'files'),
        lessons: text(args, 'lessons'),
      }
    },
    run: (args, exec) => {
      const result = pod.reporting.report(current(), args)
      if (!result.ok) return failure(result.error.message)
      if (args.status !== 'progress') exec.concludeTurn()
      return success(result.value.message, { status: args.status, stage: result.value.task.ticketStage ?? result.value.task.status })
    },
  })
}
