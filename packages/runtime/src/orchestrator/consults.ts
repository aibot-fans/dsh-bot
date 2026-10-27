import type { DatabaseSync } from 'node:sqlite'
import { PRIORITY, botFolder, fail, newId, ok, t, truncate, type Bot, type PodResult, type PodSession, type Task } from 'pod-domain'
import { answerConsult, insertConsult, oldestPendingConsult } from 'pod-store'
import type { Dispatcher } from '../agents/dispatcher.ts'
import { relaySource } from '../agents/messages.ts'
import type { SessionRegistry } from '../agents/registry.ts'
import type { BotService } from '../bots/service.ts'
import type { RoomService } from '../chat/rooms.ts'

/** 内部评审里每个 bot 最多等多久。 */
const REVIEW_TURN_MS = 4 * 60_000

export interface ConsultDeps {
  readonly db: DatabaseSync
  readonly bots: BotService
  readonly registry: SessionRegistry
  readonly dispatcher: Dispatcher
  readonly rooms: RoomService
  readonly task: (taskId: string) => Task | undefined
  readonly now: () => number
}

export interface ReviewStatement {
  readonly bot: string
  readonly text: string
}

/**
 * bot 之间的沟通：ask_bot 是异步咨询，对方在咨询会话里回答，答复再送回提问的 bot，
 * 双方都不用停下手上的工作；不能嵌套。原文折叠在任务记录里，没有私下通道。
 * 内部评审复用同一套会话：按顺序让每个 bot 发言，后面的能看到前面的。
 */
export class ConsultService {
  /** 咨询会话这一轮里最后说的话；轮次结束时作为答复。 */
  private readonly drafts = new Map<string, string>()
  /** 内部评审在等某条会话的答复。 */
  private readonly waiting = new Map<string, (text: string) => void>()
  private readonly deps: ConsultDeps

  constructor(deps: ConsultDeps) {
    this.deps = deps
  }

  private rootOf(session: PodSession): Task | undefined {
    if (session.taskId === null) return undefined
    const task = this.deps.task(session.taskId)
    if (task === undefined) return undefined
    return task.parentId === null ? task : this.deps.task(task.rootId)
  }

  private async consultSession(target: Bot, rootId: string | null, fresh: boolean): Promise<PodSession> {
    const existing = fresh ? undefined : this.deps.registry.activeConsult(target.id, rootId)
    if (existing !== undefined) return existing
    return this.deps.registry.open({
      bot: target,
      kind: 'consult',
      roomId: null,
      taskId: rootId,
      folder: botFolder(target),
      title: t('dsh-bot · 咨询 · {name}', { name: target.name }),
    })
  }

  /** 提问的会话在群聊里时，那个群和现在的成员；群里的成员要在群里 @，不走咨询。 */
  private groupOf(session: PodSession): { readonly members: readonly Bot[] } | undefined {
    if (session.kind !== 'chat' || session.roomId === null) return undefined
    const room = this.deps.rooms.get(session.roomId)
    return room === undefined || room.kind === 'direct' ? undefined : { members: this.deps.rooms.memberBots(room) }
  }

  /** ask_bot：把问题投进对方的咨询会话，立即返回；答复到了再送回提问的会话。 */
  async ask(asker: PodSession, targetName: string, question: string): Promise<PodResult<string>> {
    if (asker.kind === 'consult') return fail('forbidden', t('咨询不能嵌套：正在回答咨询时不能再咨询别人'))
    const target = this.deps.bots.resolve(targetName)
    if (target === undefined) return fail('not-found', t('找不到 bot「{targetName}」', { targetName }))
    if (target.id === asker.botId) return fail('invalid-input', t('不能咨询自己'))
    if (this.groupOf(asker)?.members.some((bot) => bot.id === target.id) === true) {
      return fail('invalid-input', t('{name}就在这个群里：用 mention_member 在群里 @ 它，让它当着大家回答。ask_bot 只用来问不在群里的 bot。', { name: target.name }))
    }
    const root = this.rootOf(asker)
    const session = await this.consultSession(target, root?.id ?? null, false)
    const consult = insertConsult(this.deps.db, {
      id: newId('msg'),
      rootId: root?.id ?? null,
      roomId: root?.roomId ?? asker.roomId,
      askerSession: asker.id,
      askerBot: asker.botId,
      targetBot: target.id,
      consultSession: session.id,
      question,
      createdAt: this.deps.now(),
    })
    const askerName = this.deps.bots.get(asker.botId)?.name ?? 'bot'
    this.deps.dispatcher.enqueue({
      sessionId: session.id,
      mode: 'followup',
      priority: PRIORITY.consult,
      text: `[来自${askerName}的咨询]${root === undefined ? '' : `（任务「${root.title}」）`}\n${question}`,
      source: relaySource(asker.id),
    })
    return ok(consult.id)
  }

  /** 咨询会话说了话：先记下来，轮次结束时用最后一段作为答复。 */
  onText(session: PodSession, text: string): void {
    if (session.kind === 'consult') this.drafts.set(session.id, text)
  }

  onTurnEnd(session: PodSession): void {
    if (session.kind !== 'consult') return
    const text = this.drafts.get(session.id)
    this.drafts.delete(session.id)
    if (text === undefined) return
    const waiter = this.waiting.get(session.id)
    if (waiter !== undefined) {
      this.waiting.delete(session.id)
      waiter(text)
      return
    }
    const consult = oldestPendingConsult(this.deps.db, session.id)
    if (consult === undefined) return
    answerConsult(this.deps.db, consult.id, text, this.deps.now())
    const targetName = this.deps.bots.get(consult.targetBot)?.name ?? 'bot'
    const askerName = this.deps.bots.get(consult.askerBot)?.name ?? 'bot'
    this.deps.dispatcher.enqueue({
      sessionId: consult.askerSession,
      mode: this.deps.dispatcher.isRunning(consult.askerSession) ? 'steer' : 'followup',
      priority: PRIORITY.consult,
      text: `[${targetName}的答复]（你问的是：${truncate(consult.question, 80)}）\n${text}`,
      source: relaySource(session.id),
    })
    if (consult.roomId !== null) {
      const room = this.deps.rooms.get(consult.roomId)
      const outside = room !== undefined && room.kind !== 'direct' && !this.deps.rooms.memberBots(room).some((bot) => bot.id === consult.targetBot)
      this.deps.rooms.post(consult.roomId, {
        author: consult.askerBot,
        kind: 'folded',
        body: t('**{askerName}问**：{question}\n\n**{targetName}答**：{text}', { askerName, question: consult.question, targetName, text }),
        // 群外的 bot 只回答了提问的 bot，不是在群里发言；标出来，免得看着像大家都回复了。
        data: { label: t('{askerName} 咨询了 {targetName}{value}', { askerName, targetName, value: outside ? t('（群外，只答给提问的人）') : '' }) },
      })
    }
  }

  /**
   * 内部评审：主管挑 2–4 个相关的 bot，轮流发言，后面的能看到前面的；没话说的回 PASS。
   * 原文折叠在房间里，结论由主管写。
   */
  async review(
    lead: PodSession,
    input: { readonly topic: string; readonly question: string; readonly bots: readonly string[]; readonly format: 'round' | 'free' },
    signal: AbortSignal,
  ): Promise<PodResult<readonly ReviewStatement[]>> {
    const members = input.bots.map((name) => this.deps.bots.resolve(name))
    const missing = input.bots.filter((_, index) => members[index] === undefined)
    if (missing.length > 0) return fail('not-found', t('找不到 bot：{missing}', { missing: missing.join(t('、')) }))
    const reviewers = members.filter((bot): bot is Bot => bot !== undefined && bot.id !== lead.botId)
    if (reviewers.length < 2 || reviewers.length > 4) return fail('invalid-input', t('内部评审要 2–4 个 bot（不含你自己）'))
    const statements: ReviewStatement[] = []
    for (const bot of reviewers) {
      if (signal.aborted) break
      const session = await this.consultSession(bot, null, true)
      const before = statements.map((item) => `- ${item.bot}：${item.text}`).join('\n')
      const text = [
        `[内部评审] 主题：${input.topic}`,
        `问题：${input.question}`,
        before === '' ? '你第一个发言。' : `前面的发言：\n${before}`,
        input.format === 'free' ? '自由讨论：有新的观点就说，没有补充就只回复 PASS。' : '请给出你的看法，3–6 条，简洁具体。',
      ].join('\n\n')
      const answer = await this.await(session, text, lead, signal)
      statements.push({ bot: bot.name, text: answer ?? t('（没有在时限内回答）') })
    }
    const transcript = statements.map((item) => t('**{bot}**：{text}', { bot: item.bot, text: item.text })).join('\n\n')
    if (lead.roomId !== null) {
      this.deps.rooms.post(lead.roomId, { author: lead.botId, kind: 'folded', body: transcript, data: { label: t('内部评审原文：{topic}', { topic: input.topic }) } })
    }
    return ok(statements)
  }

  private await(session: PodSession, text: string, lead: PodSession, signal: AbortSignal): Promise<string | undefined> {
    return new Promise((resolve) => {
      const done = (value: string | undefined): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.waiting.delete(session.id)
        resolve(value)
      }
      const abort = (): void => done(undefined)
      const timer = setTimeout(() => done(undefined), REVIEW_TURN_MS)
      timer.unref()
      signal.addEventListener('abort', abort)
      this.waiting.set(session.id, (answer) => done(answer))
      this.deps.dispatcher.enqueue({ sessionId: session.id, mode: 'followup', priority: PRIORITY.consult, text, source: relaySource(lead.id) })
    })
  }
}
