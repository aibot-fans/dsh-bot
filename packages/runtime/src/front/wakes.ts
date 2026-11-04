import type { DatabaseSync } from 'node:sqlite'
import { PRIORITY, oneLine, t, truncate, type Room, type RoomMessage, type Task, type Wait } from 'pod-domain'
import { cancelDelivery, getDelivery, getMessage, getWait, listEffects, transaction, type Delivery } from 'pod-store'
import { noticeSource } from '../agents/messages.ts'
import type { Replies } from '../chat/replies.ts'
import { CARD_LIMITS, clipCard } from '../core/cards.ts'
import type { Dispatcher } from '../effects/delivery.ts'
import { Later, type Effects } from '../effects/queue.ts'

/** 任务交来、要前台在派活的地方说的三种事：交了回答、问用户、没做成。 */
export type WakeKind = 'result' | 'question' | 'failed'

/** 叫醒前台以后，这么久还没在派活的地方说，dsh-bot 原样发出去。 */
const FALLBACK_MS = 3 * 60_000

/** 前台正在写这一件（叫醒的那条已经收进它的历史，这一轮还没结束），最多再等到这时候。 */
const WRITING_MAX_MS = 10 * 60_000

/** 叫醒里带的完整回答最多多少字；截断处留着汇报的 id，用 read 读全文。 */
const ANSWER_LIMIT = 6000

const HEADS: Readonly<Record<WakeKind, string>> = { result: '[任务交结果]', question: '[任务问你]', failed: '[任务没做成]' }

/** 叫醒一次前台：哪个任务、什么事、在哪说，记在兜底那一行里，重启后也在。 */
export interface Wake {
  readonly key: string
  readonly kind: WakeKind
  readonly botId: string
  readonly sessionId: string
  readonly taskId: string
  /** 派活的聊天室：前台在这里说。 */
  readonly roomId: string
  /** 交结果时回在哪条下面（用户问的那句）。 */
  readonly anchor: string | null
  /** 完整回答、没做成的原因，或者问的事。 */
  readonly body: string
  readonly waitId: string | null
  readonly reportId: string | null
  readonly owner: string
  readonly title: string
  readonly deliveryId: string
  readonly createdAt: number
}

/** 任务这边交来的一件事。 */
export interface TaskWake {
  readonly kind: WakeKind
  readonly body: string
  readonly anchor: string | null
  readonly waitId?: string | null
  readonly reportId?: string | null
}

export interface WakeInput extends TaskWake {
  readonly task: Task
  readonly botId: string
  readonly sessionId: string
  readonly room: Room
  readonly owner: string
}

export interface FrontWakesDeps {
  readonly db: DatabaseSync
  readonly now: () => number
  readonly effects: Effects
  readonly dispatcher: Dispatcher
  readonly replies: Replies
}

function readWake(key: string, payload: Readonly<Record<string, unknown>>): Wake | undefined {
  const text = (name: string): string | null => (typeof payload[name] === 'string' ? (payload[name] as string) : null)
  const kind = text('kind')
  const botId = text('botId')
  const sessionId = text('sessionId')
  const taskId = text('taskId')
  const roomId = text('roomId')
  const deliveryId = text('deliveryId')
  if (kind !== 'result' && kind !== 'question' && kind !== 'failed') return undefined
  if (botId === null || sessionId === null || taskId === null || roomId === null || deliveryId === null) return undefined
  return {
    key,
    kind,
    botId,
    sessionId,
    taskId,
    roomId,
    anchor: text('anchor'),
    body: text('body') ?? '',
    waitId: text('waitId'),
    reportId: text('reportId'),
    owner: text('owner') ?? '',
    title: text('title') ?? '',
    deliveryId,
    createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : 0,
  }
}

/** 叫醒的那条交给了前台、它看得到（收进历史或者正在交）。 */
function handedOver(delivery: Delivery | undefined): boolean {
  return delivery !== undefined && delivery.status === 'sent'
}

/** 用户当时怎么问的：来由里的原话；后来在派活的地方接着问、要回的那句也列上。 */
function askedLines(task: Task, anchor: RoomMessage | undefined): readonly string[] {
  const quotes = task.origin?.quotes ?? []
  const lines = quotes.map((quote) => `- ${quote.author}：「${truncate(oneLine(quote.text), 300)}」`)
  const later = anchor !== undefined && !quotes.some((quote) => quote.messageId === anchor.id) ? [`- 后来又问（${anchor.id}）：「${truncate(oneLine(anchor.body), 300)}」`] : []
  return [...lines, ...later]
}

/** 问的事：问题和选项（选项下面的说明、推荐的标出来）；批准、登录写清要做什么。 */
function questionLines(wait: Wait | undefined, body: string): readonly string[] {
  if (wait === undefined) return [`问的是：${body}`]
  if (wait.kind === 'write' || wait.kind === 'approval' || wait.kind === 'security') return [`在等用户批准：${wait.title}`]
  if (wait.kind === 'login') return [`要用户登录：${wait.title}`]
  const options = Array.isArray(wait.data.options) ? wait.data.options.filter((item): item is string => typeof item === 'string') : []
  const notes = Array.isArray(wait.data.optionNotes) ? wait.data.optionNotes : []
  const listed = options.map((option, index) => {
    const note = typeof notes[index] === 'string' && notes[index] !== '' ? `——${notes[index] as string}` : ''
    return `  ${index + 1}. ${option}${note}${wait.data.recommended === true && index === 0 ? '（它推荐的）' : ''}`
  })
  const summary = typeof wait.data.summary === 'string' && wait.data.summary !== '' ? [`它的说明：${truncate(wait.data.summary, CARD_LIMITS.report)}`] : []
  return [`问题：${wait.title}`, ...(listed.length === 0 ? [] : ['选项：', ...listed]), ...summary]
}

/**
 * 叫醒前台说任务交来的事：交了回答、问用户、没做成，每件叫醒一次（不攒成一批），前台照提示词里的写法在派活的地方说。
 * 同时登记一条兜底：前台几分钟没说（出错、这一轮没回这一件），dsh-bot 以前台的名义把完整回答、问的事、没做成的原因原样发出去。
 * 前台说了就撤掉兜底。兜底记在副作用表里，重启后照样到点。
 */
export class FrontWakes {
  private readonly deps: FrontWakesDeps

  constructor(deps: FrontWakesDeps) {
    this.deps = deps
    deps.effects.handle('wake', (payload, row) => this.fallback(row.key, payload), { limit: () => 2, retry: [30_000, 60_000] })
  }

  wake(input: WakeInput): void {
    const { db, now } = this.deps
    const created = now()
    const key = `${input.task.id}:${input.waitId ?? input.reportId ?? String(created)}`
    const anchor = input.anchor === null ? undefined : getMessage(db, input.anchor)
    const what = input.kind === 'result' ? t('交了回答') : input.kind === 'question' ? t('在问你') : t('没做成')
    transaction(db, () => {
      const delivery = this.deps.dispatcher.enqueue({
        sessionId: input.sessionId,
        mode: 'followup',
        priority: PRIORITY.owner,
        text: this.text(input, anchor),
        source: noticeSource(t('「{title}」{what}', { title: input.task.title, what })),
      })
      this.deps.effects.enqueue(
        'wake',
        key,
        {
          kind: input.kind,
          botId: input.botId,
          sessionId: input.sessionId,
          taskId: input.task.id,
          roomId: input.room.id,
          anchor: anchor?.id ?? null,
          body: input.body,
          waitId: input.waitId ?? null,
          reportId: input.reportId ?? null,
          owner: input.owner,
          title: input.task.title,
          deliveryId: delivery.id,
          createdAt: created,
        },
        FALLBACK_MS,
      )
    })
  }

  private text(input: WakeInput, anchor: RoomMessage | undefined): string {
    const { task, kind, owner, room } = input
    const where = `「${room.title}」（room 写 ${room.id}）`
    if (kind === 'result') {
      return [
        `${HEADS.result} 「${task.title}」（${task.id}，${owner}做的）交了回答。`,
        '用户怎么问的：',
        ...askedLines(task, anchor),
        `${owner}交的完整回答（原样在任务对话里，用户点任务记号就能看）：`,
        clipCard(input.body, ANSWER_LIMIT, input.reportId ?? null),
        `照交结果的写法用 reply 在${where}交给用户：${anchor === undefined ? '' : `to 写 ${anchor.id}，`}task 写 ${task.id}。几分钟内没说，dsh-bot 会把完整回答原样发给用户。`,
      ].join('\n')
    }
    if (kind === 'question') {
      const wait = input.waitId === undefined || input.waitId === null ? undefined : getWait(this.deps.db, input.waitId)
      return [
        `${HEADS.question} 「${task.title}」（${task.id}，${owner}在做）在任务对话里问用户：`,
        ...questionLines(wait, input.body),
        `用 reply 在${where}说一两句，task 写 ${task.id}：要用户定什么、为什么要问。问的事会原样做成卡片挂在你这句下面，你不列选项，不替用户选。`,
      ].join('\n')
    }
    return [
      `${HEADS.failed} 「${task.title}」（${task.id}，${owner}在做）没做成：`,
      truncate(input.body, CARD_LIMITS.report * 2),
      `用 reply 在${where}告诉用户，task 写 ${task.id}：为什么没做成、做到了哪、用户可以怎么办（接着做、换个办法、不做了）。`,
    ].join('\n')
  }

  /** 前台在说这个任务交来的哪一件：叫醒的那条已经交给它、还没说的里最早的那件。 */
  pending(botId: string, taskId: string): Wake | undefined {
    return this.handed(botId).find((wake) => wake.taskId === taskId)
  }

  /** reply 没写 task 时：前台在这个聊天室还没说的只有一件，就是它。 */
  onlyIn(botId: string, roomId: string): Wake | undefined {
    const here = this.handed(botId).filter((wake) => wake.roomId === roomId)
    return here.length === 1 ? here[0] : undefined
  }

  private handed(botId: string): readonly Wake[] {
    return listEffects(this.deps.db, 'wake')
      .map((row) => readWake(row.key, row.payload))
      .filter((wake): wake is Wake => wake !== undefined && wake.botId === botId && handedOver(getDelivery(this.deps.db, wake.deliveryId)))
  }

  /** 前台说了这一件：撤掉兜底。 */
  handled(wake: Wake): void {
    this.deps.effects.cancel('wake', wake.key)
  }

  /** 前台一轮结束：这一轮看到了却没说的，马上兜底。 */
  turnEnded(sessionId: string): void {
    for (const row of listEffects(this.deps.db, 'wake')) {
      const wake = readWake(row.key, row.payload)
      if (wake === undefined || wake.sessionId !== sessionId) continue
      if (getDelivery(this.deps.db, wake.deliveryId)?.readAt != null) this.deps.effects.enqueue('wake', row.key, row.payload)
    }
  }

  /**
   * 到点还没说：前台正在写这一件（收进历史了、这一轮还没结束，或者正交给它）就再等一会儿，最多到 WRITING_MAX_MS；
   * 还没交给前台的撤回，免得它之后再说一遍。然后以前台的名义原样发：完整回答回在用户问的那句上，问的事挂卡片，没做成的说原因。
   */
  private async fallback(key: string, payload: Readonly<Record<string, unknown>>): Promise<void> {
    const wake = readWake(key, payload)
    if (wake === undefined) return
    const delivery = getDelivery(this.deps.db, wake.deliveryId)
    const writing = handedOver(delivery) && delivery?.readAt === null
    if (writing && this.deps.now() - wake.createdAt < WRITING_MAX_MS) throw new Later()
    if (delivery?.status === 'pending') cancelDelivery(this.deps.db, delivery.id, t('前台没来得及说，dsh-bot 已经原样发了'))
    const base = { roomId: wake.roomId, author: wake.botId, sessionId: wake.sessionId, taskId: wake.taskId }
    if (wake.kind === 'result') {
      const anchor = wake.anchor === null ? undefined : getMessage(this.deps.db, wake.anchor)
      const replyTo = anchor === undefined || anchor.deletedAt !== null ? null : anchor.id
      this.deps.replies.send({ ...base, purpose: 'result', body: wake.body, replyTo, data: { verbatim: true, ...(wake.reportId === null ? {} : { reportId: wake.reportId }) } })
      return
    }
    if (wake.kind === 'question') {
      const wait = wake.waitId === null ? undefined : getWait(this.deps.db, wake.waitId)
      if (wait !== undefined && wait.status !== 'open') return
      const body = t('{owner}问：{question}', { owner: wake.owner, question: wait?.title ?? wake.body })
      this.deps.replies.send({ ...base, purpose: 'relay', body, replyTo: null, data: { verbatim: true, ...(wait === undefined ? {} : { waitId: wait.id }) } })
      return
    }
    this.deps.replies.send({ ...base, purpose: 'relay', body: t('「{title}」没做成：{reason}', { title: wake.title, reason: wake.body }), replyTo: null, data: { verbatim: true } })
  }
}
