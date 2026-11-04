import type { DatabaseSync } from 'node:sqlite'
import {
  OWNER,
  POD,
  PRIORITY,
  WAIT_KIND_LABELS,
  fail,
  isOpenWait,
  maskSecrets,
  newId,
  ok,
  readId,
  readString,
  t,
  truncate,
  type PodResult,
  type PodSession,
  type Task,
  type Wait,
  type WaitKind,
} from 'pod-domain'
import { getMessage, getWait, insertWait, listWaits, setRootWaitStatus, setWaitStatus, taskConversationOf, waitsForRoot } from 'pod-store'
import type { Dispatcher } from '../effects/delivery.ts'
import type { RoomService } from '../chat/rooms.ts'
import type { Auditor } from '../core/audit.ts'
import type { PodBus } from '../core/bus.ts'

export interface WaitServiceDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly rooms: RoomService
  readonly dispatcher: Dispatcher
  readonly audit: Auditor
  readonly now: () => number
  readonly task: (taskId: string) => Task | undefined
  /** 没绕过去的等你事项会让任务进入“等你”，处理完再回到进行中。 */
  readonly setTaskWaiting: (task: Task, waiting: boolean) => void
  /** 工单的答复由任务接着做（开一次新的执行）；返回 true 就不再直接送进会话。 */
  readonly sendToTask?: (task: Task, text: string, quote: string) => boolean
  readonly notify: (wait: Wait) => void
  /** 等你卡发到聊天室：干活的 bot 回复任务卡（走回复队列）。 */
  readonly speak: (wait: Wait, task: Task | undefined) => void
}

export interface AskInput {
  readonly session: PodSession
  readonly kind: WaitKind
  readonly title: string
  readonly detail: string
  /** 已经先绕过去了：任务照常推进，交付时列进“前提和待确认”。 */
  readonly bypassed: boolean
  readonly data?: Readonly<Record<string, unknown>>
  /** 问题来自哪次汇报。 */
  readonly reportId?: string | null
  /** 问题的几个选项，你点一下就是答复。 */
  readonly options?: readonly string[]
  /** 每个选项下面的一句说明，和选项一一对应。 */
  readonly optionNotes?: readonly string[]
  /** 第一个选项是 bot 推荐的。 */
  readonly recommended?: boolean
}

/** 用问题卡片问的几种：在卡片上答了，你的回答也作为你的一句话留在对话里。 */
const QUESTION_KINDS: ReadonlySet<WaitKind> = new Set(['ambiguity', 'unknown-state'])

/** 问题的选项放进事项的 data：选项、每个选项下面的说明（都没写就不放）、第一个是不是推荐的。 */
function optionData(input: AskInput): Readonly<Record<string, unknown>> {
  const options = (input.options ?? []).map((option) => truncate(option, 60))
  if (options.length === 0) return {}
  const notes = options.map((_, index) => truncate(input.optionNotes?.[index] ?? '', 80))
  return { options, ...(notes.some(Boolean) ? { optionNotes: notes } : {}), ...(input.recommended === true ? { recommended: true } : {}) }
}

/**
 * 等你处理：只在必须你出面的情况出现。都是异步的——只有卡住的那个任务在等，其他照常；
 * 能绕过的先绕过。你处理之后，答复转回给原来的会话。
 */
export class WaitService {
  private resolvers: ReadonlyMap<WaitKind, (wait: Wait, answer: string) => boolean> = new Map()
  private readonly deps: WaitServiceDeps

  constructor(deps: WaitServiceDeps) {
    this.deps = deps
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  ask(input: AskInput): Wait {
    const task = input.session.taskId === null ? undefined : this.deps.task(input.session.taskId)
    // 有任务对话（另开的单聊、任务群）的根任务在那里问，提醒和未读也落在那里。
    const conversation = task === undefined || task.parentId !== null ? undefined : taskConversationOf(this.db, task.id)?.id
    const roomId = conversation ?? task?.roomId ?? input.session.roomId
    const wait = insertWait(this.db, {
      id: newId('wait'),
      kind: input.kind,
      status: input.bypassed ? 'bypassed' : 'open',
      title: truncate(input.title, 120),
      detail: input.detail,
      data: { ...input.data, ...optionData(input) },
      taskId: task?.id ?? null,
      rootId: task?.rootId ?? null,
      sessionId: input.session.id,
      botId: input.session.botId,
      roomId,
      now: this.deps.now(),
    })
    if (input.reportId !== undefined && input.reportId !== null) this.db.prepare('UPDATE waits SET report_id = ? WHERE id = ?').run(input.reportId, wait.id)
    if (roomId !== null) this.deps.speak(wait, task)
    if (task !== undefined && !input.bypassed) this.deps.setTaskWaiting(task, true)
    this.deps.audit.record('wait.create', input.session.botId, wait.id, { kind: wait.kind, title: wait.title, bypassed: input.bypassed })
    this.deps.bus.emit({ type: 'waits' })
    this.deps.notify(wait)
    return wait
  }

  get(id: string): Wait | undefined {
    return getWait(this.db, id)
  }

  /** “等你处理”列表：还卡着的和已先绕过的。 */
  open(): readonly Wait[] {
    return listWaits(this.db, ['open', 'bypassed'])
  }

  openCountFor(rootId: string): number {
    return waitsForRoot(this.db, rootId).filter(isOpenWait).length
  }

  private latestOpen(rootId: string, test: (wait: Wait) => boolean): Wait | undefined {
    return waitsForRoot(this.db, rootId)
      .filter((wait) => isOpenWait(wait) && test(wait))
      .reduce<Wait | undefined>((latest, wait) => (latest === undefined || wait.createdAt > latest.createdAt ? wait : latest), undefined)
  }

  /** 这个任务（整棵树）最近一件还开着的、要你拿主意的事：你回前台的话转进任务时就是答它。 */
  latestQuestionFor(rootId: string): Wait | undefined {
    return this.latestOpen(rootId, (wait) => wait.kind === 'ambiguity')
  }

  /** 这个任务（整棵树）最近一件还开着的事：前台转告时，它的卡片挂在转告的那句话下面。 */
  latestOpenFor(rootId: string): Wait | undefined {
    return this.latestOpen(rootId, () => true)
  }

  openCountInRoom(roomId: string): number {
    return this.open().filter((wait) => wait.roomId === roomId).length
  }

  /** 某类事项由别的模块自己处理答复（比如浏览器写操作批准后执行），返回 true 就不再按默认方式转回。 */
  setResolver(kind: WaitKind, resolver: (wait: Wait, answer: string) => boolean): void {
    this.resolvers = new Map([...this.resolvers, [kind, resolver]])
  }

  /** 你处理了一件事：写下答复，转回给原来的会话。 */
  answer(input: unknown): PodResult<Wait> {
    const id = readId(input, 'waitId')
    if (id === undefined) return fail('invalid-input', t('缺少等你事项的 id'))
    const wait = this.get(id)
    if (wait === undefined) return fail('not-found', t('找不到这件事'))
    if (!isOpenWait(wait) && wait.status !== 'suspended') return fail('conflict', t('这件事已经处理过了'))
    const raw = readString(input, 'answer')
    const answer = maskSecrets(raw).text
    const resolved = setWaitStatus(this.db, id, 'resolved', answer === '' ? t('已处理') : answer, this.deps.now()) ?? wait
    const handled = this.resolvers.get(resolved.kind)?.(resolved, answer) ?? false
    if (!handled) this.forward(resolved, answer)
    this.echo(resolved, answer, input)
    this.afterChange(resolved)
    this.deps.audit.record('wait.answer', OWNER, id, { answer })
    return ok(resolved)
  }

  /** 你说不用管：关闭这件事，告诉原会话按已有的做法继续。 */
  dismiss(input: unknown): PodResult<Wait> {
    const id = readId(input, 'waitId')
    if (id === undefined) return fail('invalid-input', t('缺少等你事项的 id'))
    const wait = this.get(id)
    if (wait === undefined) return fail('not-found', t('找不到这件事'))
    const closed = setWaitStatus(this.db, id, 'closed', t('不用处理'), this.deps.now()) ?? wait
    if (wait.status === 'open') this.forward(closed, '这件事不用管了，按你能做到的继续，并在交付里注明。')
    this.afterChange(closed)
    return ok(closed)
  }

  /**
   * 在对话里的问题卡片上答的（页面带着卡片所在的对话）：你的回答也作为你的一句话留在那里，回在卡片那条下面。
   * 只是记录，不再交给谁，答复已经转给问的任务了。
   */
  private echo(wait: Wait, answer: string, input: unknown): void {
    const roomId = readString(input, 'roomId')
    if (roomId === '' || answer === '' || !QUESTION_KINDS.has(wait.kind)) return
    const card = getMessage(this.db, readString(input, 'messageId'))
    this.deps.rooms.post(roomId, { author: OWNER, kind: 'text', body: answer, replyTo: card?.roomId === roomId ? card.id : null, data: { answerOf: wait.id } })
  }

  private forward(wait: Wait, answer: string): void {
    if (wait.sessionId === null) return
    const task = wait.taskId === null ? undefined : this.deps.task(wait.taskId)
    if (task !== undefined && (task.status === 'cancelled' || task.status === 'done')) return
    const text = `[用户对「${wait.title}」的答复]\n[用户原话] ${answer === '' ? '已处理（比如已经登录好了）' : answer}`
    if (task !== undefined && this.deps.sendToTask?.(task, text, `${wait.title}：${answer === '' ? t('已处理') : answer}`) === true) return
    this.deps.dispatcher.enqueue({
      sessionId: wait.sessionId,
      mode: this.deps.dispatcher.isRunning(wait.sessionId) ? 'steer' : 'followup',
      priority: PRIORITY.owner,
      text,
      source: { kind: 'user' },
    })
  }

  private afterChange(wait: Wait): void {
    this.settleMessages(wait)
    if (wait.taskId !== null) {
      const task = this.deps.task(wait.taskId)
      const stillBlocked = task !== undefined && this.blockingFor(task.id) > 0
      if (task !== undefined && task.status === 'waiting' && !stillBlocked) this.deps.setTaskWaiting(task, false)
    }
    // 对话里的等你卡片自己显示处理结果，不再另发里程碑。
    this.deps.bus.emit({ type: 'waits' })
  }

  /** 带着这件事卡片的消息（问的那句、前台转告的那句）记下怎么处理的：卡片上的按钮收起，写上处理结果。 */
  private settleMessages(wait: Wait): void {
    const rows = this.db
      .prepare("SELECT id FROM messages WHERE json_extract(data, '$.waitId') = ? AND deleted_at IS NULL")
      .all(wait.id) as unknown as readonly { readonly id: string }[]
    for (const row of rows) {
      const message = getMessage(this.db, row.id)
      if (message !== undefined) this.deps.rooms.patchMessage(message.id, { data: { ...message.data, settled: { status: wait.status, answer: wait.answer } } })
    }
  }

  private blockingFor(taskId: string): number {
    return this.open().filter((wait) => wait.taskId === taskId && wait.status === 'open').length
  }

  /**
   * 根任务状态变化时，等你事项跟着变：停止时挂起、继续时恢复、取消时关闭；
   * 交付时已绕过的移到交付卡的“前提和待确认”，返回这些事项，由调用方写进结果。
   */
  onRootChange(rootId: string, change: 'stopped' | 'resumed' | 'cancelled' | 'delivered'): readonly Wait[] {
    const now = this.deps.now()
    let moved: readonly Wait[] = []
    if (change === 'stopped') setRootWaitStatus(this.db, rootId, ['open', 'bypassed'], 'suspended', now)
    if (change === 'resumed') setRootWaitStatus(this.db, rootId, ['suspended'], 'open', now)
    if (change === 'cancelled') setRootWaitStatus(this.db, rootId, ['open', 'bypassed', 'suspended'], 'closed', now)
    if (change === 'delivered') {
      moved = waitsForRoot(this.db, rootId).filter((wait) => wait.status === 'bypassed')
      for (const wait of moved) setWaitStatus(this.db, wait.id, 'closed', t('已绕过，写进交付的前提和待确认'), now)
    }
    this.deps.bus.emit({ type: 'waits' })
    return moved
  }

  /** 交付卡上的一行：已绕过的事项。 */
  static describe(wait: Wait): string {
    return t('{kind}：{title}（已先绕过）', { kind: t(WAIT_KIND_LABELS[wait.kind]), title: wait.title })
  }

  /** Pod 自己的说明行，比如“写操作执行到一半进程退出，状态未知”。 */
  podNotice(roomId: string | null, body: string): void {
    if (roomId !== null) this.deps.rooms.post(roomId, { author: POD, kind: 'notice', body })
  }
}
