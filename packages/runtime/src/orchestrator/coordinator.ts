import {
  POD,
  PRIORITY,
  affectedByAssumption,
  childTaskFolder,
  fail,
  intersectProfiles,
  isTerminal,
  newAcceptance,
  newId,
  ok,
  parsePlan,
  truncate,
  validatePlan,
  type PodResult,
  type PodSession,
  type Task,
  type TaskResult,
  type TeamPlan,
} from 'pod-domain'
import { insertTask, setTaskPlanKey, updateTask, writeTaskPlan } from 'pod-store'
import { noticeSource, relaySource } from '../agents/messages.ts'
import { Orchestrator } from './orchestrator.ts'
import { changeEvent, rejectText, revisionLine } from './texts.ts'

export interface RevisionInput {
  readonly reason: string
  readonly assumptionChanges: readonly { readonly id: string; readonly text: string }[]
  readonly redo: readonly string[]
  readonly drop: readonly string[]
  readonly add: unknown
  readonly modify: readonly { readonly key: string; readonly brief?: string; readonly acceptance?: readonly string[] }[]
}

/** 同一个子任务打回几次以后提示组长换人。 */
const REWORK_LIMIT = 2

/** 组长的操作：验收、打回、改计划、改派、交付；以及“谨慎”档的开工确认和你提出的需求变更。 */
export class Coordinator extends Orchestrator {
  /** 协调会话所属的根任务。 */
  rootFor(session: PodSession): Task | undefined {
    if (session.taskId === null) return undefined
    const task = this.deps.tasks.get(session.taskId)
    return task !== undefined && task.parentId === null ? task : undefined
  }

  /** “谨慎”档：你点了“开始”。 */
  async approve(rootId: string): Promise<PodResult<Task>> {
    const root = this.deps.tasks.get(rootId)
    if (root === undefined || !root.planPending) return fail('conflict', '这个任务不在等你确认')
    this.deps.tasks.event(root, 'approved', 'owner', {})
    this.deps.rooms.milestone(root.roomId, '你确认了计划，开工')
    return this.start(rootId)
  }

  async review(session: PodSession, key: string, pass: boolean, feedback: string): Promise<PodResult<{ readonly task: Task; readonly hint: string }>> {
    const root = this.rootFor(session)
    if (root === undefined) return fail('not-found', '这条会话不是协调会话')
    const task = this.resolveSubtask(root.id, key)
    if (task === undefined) return fail('not-found', `找不到子任务「${key}」`)
    if (task.status !== 'review') return fail('conflict', `子任务「${task.title}」现在是${task.status}，不在待验收`)
    const now = this.deps.now()
    const leaderName = this.nameOf(session.botId)
    if (pass) {
      const done = updateTask(this.db, task.id, { status: 'done', finishedAt: now, note: '' }, now) ?? task
      this.deps.tasks.touched(done)
      this.deps.tasks.event(done, 'reviewed', session.botId, { pass: true })
      // 做了什么，成员提交时已经以自己的名义在群里说过；这里只记验收结果，和打回对称。
      this.deps.rooms.milestone(done.roomId, `${leaderName} 验收通过「${done.title}」`, { taskId: done.id })
      await this.schedule(root.id)
      this.afterSettled(root.id)
      return ok({ task: done, hint: '已通过，下游子任务会自动开工。' })
    }
    if (feedback === '') return fail('invalid-input', '打回时要写清哪一条没达到、要怎么改')
    const attempts = task.attempts + 1
    const reworked = updateTask(this.db, task.id, { status: 'running', attempts, note: `被打回：${truncate(feedback, 80)}` }, now) ?? task
    this.deps.tasks.touched(reworked)
    this.deps.tasks.event(reworked, 'reviewed', session.botId, { pass: false, feedback })
    this.deps.rooms.milestone(reworked.roomId, `${leaderName} 打回「${reworked.title}」：${truncate(feedback, 60)}`, { taskId: reworked.id })
    const target = this.deps.registry.activeForTask(reworked.id, 'task')
    if (target !== undefined) {
      this.deps.dispatcher.enqueue({ sessionId: target.id, mode: 'followup', priority: PRIORITY.task, text: rejectText(reworked, feedback, attempts), source: relaySource(session.id) })
    } else {
      await this.startSubtask(reworked, `上一版被打回：${feedback}`)
    }
    const hint = attempts >= REWORK_LIMIT ? `同一个子任务已经打回 ${attempts} 次，考虑用 reassign_task 换人，或者自己补。` : '已打回，修改后会重新提交给你。'
    return ok({ task: reworked, hint })
  }

  /** 改派：原负责人的会话停下，新负责人带着交接说明重新开工。 */
  async reassign(session: PodSession, key: string, botName: string, note: string): Promise<PodResult<Task>> {
    const root = this.rootFor(session)
    if (root === undefined) return fail('not-found', '这条会话不是协调会话')
    const task = this.resolveSubtask(root.id, key)
    if (task === undefined) return fail('not-found', `找不到子任务「${key}」`)
    if (isTerminal(task.status) && task.status !== 'failed') return fail('conflict', '这个子任务已经结束')
    const owner = this.deps.bots.resolve(botName)
    if (owner === undefined) return fail('not-found', `找不到 bot「${botName}」`)
    if (owner.id === task.ownerBotId && task.status !== 'failed') return fail('invalid-input', '已经是它在负责了')
    for (const old of this.deps.registry.forTask(task.id).filter((item) => item.status === 'active')) {
      this.deps.dispatcher.cancelPending(old.id)
      this.deps.agents.get(old.id)?.cancel({ kind: 'hook', reason: 'pod: reassigned' })
      this.deps.registry.retire(old.id)
    }
    const handover = [
      `原负责人：${this.nameOf(task.ownerBotId)}。`,
      task.note === '' ? undefined : `最近的进度说明：${task.note}`,
      task.acceptance.some((item) => item.done) ? `已完成的验收项：${task.acceptance.filter((item) => item.done).map((item) => item.text).join('；')}` : undefined,
      `过程文件在 ${task.folder}/，先看一遍再接着做。`,
      note === '' ? undefined : `组长说明：${note}`,
    ]
      .filter(Boolean)
      .join('\n')
    const now = this.deps.now()
    const moved = updateTask(this.db, task.id, { ownerBotId: owner.id, status: 'queued', note: '' }, now) ?? task
    this.deps.rooms.addMember(root.roomId ?? '', owner.id)
    this.deps.tasks.event(moved, 'reassigned', session.botId, { to: owner.id, note })
    this.deps.rooms.milestone(moved.roomId, `「${moved.title}」改派给 ${owner.name}`, { taskId: moved.id })
    await this.startSubtask(moved, handover)
    return ok(this.deps.tasks.get(moved.id) ?? moved)
  }

  /** 计划变更：新增、取消、修改、重做子任务；纠正前提时只重做依赖它的子任务。已完成且不受影响的保留。 */
  async revise(session: PodSession, input: RevisionInput): Promise<PodResult<TeamPlan>> {
    const root = this.rootFor(session)
    if (root === undefined) return fail('not-found', '这条会话不是协调会话')
    const plan = this.plan(root.id)
    if (plan === null) return fail('not-found', '这个任务没有计划')
    if (input.reason === '') return fail('invalid-input', '要写明为什么改')
    const version = plan.version + 1
    const assumptions = plan.assumptions.map((item) => {
      const change = input.assumptionChanges.find((candidate) => candidate.id === item.id)
      return change === undefined ? item : { ...item, text: change.text }
    })
    const redoKeys = new Set([...input.redo, ...input.assumptionChanges.flatMap((change) => affectedByAssumption(plan, change.id))])
    const added = parsePlan({ goal: plan.goal, subtasks: input.add }, version).subtasks.filter((item) => item.title !== '')
    const existingKeys = new Set(plan.subtasks.map((item) => item.id))
    const freshAdded = added.map((item, index) => (existingKeys.has(item.id) ? { ...item, id: `v${version}-${index + 1}` } : item))
    const next: TeamPlan = {
      ...plan,
      version,
      assumptions,
      subtasks: [
        ...plan.subtasks
          .filter((item) => !input.drop.includes(item.id))
          .map((item) => {
            const change = input.modify.find((candidate) => candidate.key === item.id)
            return change === undefined ? item : { ...item, brief: change.brief ?? item.brief, acceptance: change.acceptance ?? item.acceptance }
          }),
        ...freshAdded,
      ],
      revision: { reason: input.reason, redo: [...redoKeys], added: freshAdded.map((item) => item.id), dropped: [...input.drop] },
    }
    const problems = validatePlan(next, { profileOf: (owner) => this.deps.bots.resolve(owner)?.toolProfile })
    if (problems.length > 0) return fail('invalid-input', `新计划没通过校验：\n- ${problems.join('\n- ')}`)
    const now = this.deps.now()
    writeTaskPlan(this.db, root.id, next, version, now)
    updateTask(this.db, root.id, { planVersion: version, stage: 'execute' }, now)
    for (const key of input.drop) {
      const task = this.resolveSubtask(root.id, key)
      if (task === undefined || isTerminal(task.status)) continue
      updateTask(this.db, task.id, { status: 'cancelled', finishedAt: now, note: `计划第 ${version} 版取消` }, now)
      for (const old of this.deps.registry.forTask(task.id).filter((item) => item.status === 'active')) {
        this.deps.dispatcher.cancelPending(old.id)
        this.deps.agents.get(old.id)?.cancel({ kind: 'hook', reason: 'pod: dropped by plan revision' })
      }
    }
    for (const change of input.modify) {
      const task = this.resolveSubtask(root.id, change.key)
      if (task === undefined) continue
      updateTask(this.db, task.id, { ...(change.brief === undefined ? {} : { brief: change.brief }), ...(change.acceptance === undefined ? {} : { acceptance: newAcceptance(change.acceptance) }) }, now)
    }
    const idOf = new Map(this.keys(root.id))
    for (const item of freshAdded) {
      const owner = this.deps.bots.resolve(item.owner)
      const id = newId('task')
      insertTask(this.db, {
        id,
        rootId: root.id,
        parentId: root.id,
        roomId: root.roomId,
        teamId: root.teamId,
        title: item.title,
        brief: item.brief,
        kind: item.kind,
        deliverable: item.deliverable,
        acceptance: newAcceptance(item.acceptance),
        dependsOn: item.dependsOn.map((key) => idOf.get(key) ?? key),
        needs: item.needs,
        ownerBotId: owner?.id ?? null,
        level: null,
        status: 'queued',
        stage: null,
        folder: childTaskFolder(root.folder, { id, title: item.title }),
        urgent: root.urgent,
        tainted: root.tainted,
        maxProfile: owner === undefined ? root.maxProfile : intersectProfiles(owner.toolProfile, root.maxProfile),
        createdBy: session.id,
        requesterSession: null,
        now,
      })
      setTaskPlanKey(this.db, id, item.id)
      idOf.set(item.id, id)
      if (owner !== undefined && root.roomId !== null) this.deps.rooms.addMember(root.roomId, owner.id)
    }
    const redone: string[] = []
    for (const key of redoKeys) if (await this.redo(root, key, version, input.reason)) redone.push(key)
    this.deps.tasks.event(root, 'revised', session.botId, { version, reason: input.reason, redo: redone, added: freshAdded.map((item) => item.id), dropped: input.drop })
    this.deps.rooms.post(root.roomId ?? '', { author: POD, kind: 'milestone', body: revisionLine(version, input.reason, freshAdded.length, input.drop.length, redone.length), data: { taskId: root.id } })
    this.deps.tasks.touched(root)
    await this.schedule(root.id)
    return ok(next)
  }

  /** 重做一个子任务；还没开工的不用重做（开工时自然按新前提来），返回是否真的重做了。 */
  private async redo(root: Task, key: string, version: number, reason: string): Promise<boolean> {
    const task = this.resolveSubtask(root.id, key)
    if (task === undefined || task.status === 'cancelled' || task.status === 'queued') return false
    const now = this.deps.now()
    const plan = this.plan(root.id)
    const acceptance = newAcceptance(plan?.subtasks.find((item) => item.id === key)?.acceptance ?? task.acceptance.map((item) => item.text))
    const reset = updateTask(this.db, task.id, { status: 'running', acceptance, result: null, finishedAt: null, note: `计划第 ${version} 版：需要重做` }, now) ?? task
    this.deps.tasks.touched(reset)
    const session = this.deps.registry.activeForTask(task.id, 'task')
    const text = `[计划第 ${version} 版] ${reason}\n这个子任务需要按新的前提重做。已有的过程文件可以参考，结果按新要求重新提交（complete_task）。`
    if (session === undefined) await this.startSubtask(reset, text)
    else this.deps.dispatcher.enqueue({ sessionId: session.id, mode: this.deps.dispatcher.isRunning(session.id) ? 'steer' : 'followup', priority: PRIORITY.task, text, source: noticeSource(`计划第 ${version} 版：需要重做`) })
    return true
  }

  /** 组长交付：根任务完成，任务卡变成交付卡，告诉派活的主管。 */
  deliver(session: PodSession, result: TaskResult): PodResult<Task> {
    const root = this.rootFor(session)
    if (root === undefined) return fail('not-found', '这条会话不是协调会话')
    if (isTerminal(root.status)) return fail('conflict', '任务已经结束')
    const open = this.children(root.id).filter((task) => !isTerminal(task.status) && task.status !== 'review')
    const now = this.deps.now()
    const bypassed = this.deps.onDelivered(root)
    const pendingNotes = open.map((task) => `「${task.title}」没有做完（${task.status}）`)
    const merged: TaskResult = { ...result, unverified: [...result.unverified, ...bypassed], skipped: [...result.skipped, ...pendingNotes] }
    const delivered = updateTask(this.db, root.id, { status: 'done', stage: 'done', result: merged, finishedAt: now }, now) ?? root
    this.deps.tasks.touched(delivered)
    this.deps.tasks.event(delivered, 'delivered', session.botId, { summary: result.summary, files: result.files })
    this.deps.rooms.milestone(delivered.roomId, `交付「${delivered.title}」`, { taskId: delivered.id })
    if (delivered.requesterSession !== null && delivered.requesterSession !== session.id) {
      const text = `[团队任务交付] 「${delivered.title}」已交付，交付卡已经发在群聊和你的单聊里。摘要：${result.summary}`
      this.deps.dispatcher.enqueue({ sessionId: delivered.requesterSession, mode: 'inject', priority: PRIORITY.task, text, source: noticeSource(text) })
    }
    this.deps.notify(delivered, 'done')
    this.retireTemporaryBots(root.id)
    return ok(delivered)
  }

  private retireTemporaryBots(rootId: string): void {
    const owners = new Set(this.children(rootId).map((task) => task.ownerBotId).filter((id): id is string => id !== null))
    for (const botId of owners) {
      const bot = this.deps.bots.get(botId)
      if (bot === undefined || !bot.temporary || bot.archivedAt !== null) continue
      if (this.deps.promote?.(botId, rootId) === true) continue
      if (this.deps.tasks.activeLoad(botId) === 0) this.deps.bots.archiveById(botId, 'pod')
    }
  }

  /** 你在任务记录里提出的需求变更，主管转给组长。 */
  proposeChange(from: PodSession, rootId: string, quote: string, message: string): PodResult<Task> {
    const root = this.deps.tasks.get(rootId)
    if (root === undefined || root.parentId !== null) return fail('not-found', '找不到这个团队任务')
    if (quote === '') return fail('invalid-input', '必须原样引用用户的话')
    if (isTerminal(root.status)) return fail('conflict', '任务已经结束；交付后想改，建一个新任务或直接说要改哪里')
    this.tellCoordinator(root, changeEvent(root.title, quote, message, this.board(root.id)))
    this.deps.tasks.event(root, 'change-proposed', from.botId, { quote, message })
    this.deps.rooms.post(root.roomId ?? from.roomId ?? '', { author: POD, kind: 'receipt', body: '已把你的修改交给组长，出新版计划后会在这里写明改了什么', data: { taskId: root.id } })
    return ok(root)
  }
}
