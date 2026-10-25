import type { DatabaseSync } from 'node:sqlite'
import {
  GROUP_NAME_MAX,
  shortGroupName,
  PRIORITY,
  childTaskFolder,
  fail,
  intersectProfiles,
  newAcceptance,
  newId,
  ok,
  parsePlan,
  readySubtasks,
  rootTaskFolder,
  truncate,
  validatePlan,
  type Bot,
  type PodResult,
  type PodSession,
  type Task,
  type TaskResult,
  type Team,
  type TeamPlan,
} from 'pod-domain'
import { insertTask, planKeys, readTaskPlan, setTaskPlanKey, transaction, updateTask, writeTaskPlan } from 'pod-store'
import type { Dispatcher } from '../agents/dispatcher.ts'
import { noticeSource, relaySource } from '../agents/messages.ts'
import type { SessionRegistry } from '../agents/registry.ts'
import type { BotService } from '../bots/service.ts'
import type { RoomService } from '../chat/rooms.ts'
import type { Auditor } from '../core/audit.ts'
import type { SettingsService } from '../core/settings.ts'
import type { AgentRegistry } from '../dsh.ts'
import { composeBrief } from '../tasks/brief.ts'
import type { TaskService } from '../tasks/service.ts'
import type { TeamService } from '../teams/service.ts'
import { allDoneEvent, boardSummary, composeKickoff, coordContext, stalledEvent, submitEvent } from './texts.ts'

export interface OrchestratorDeps {
  readonly db: DatabaseSync
  readonly bots: BotService
  readonly teams: TeamService
  readonly registry: SessionRegistry
  readonly dispatcher: Dispatcher
  readonly agents: AgentRegistry
  readonly rooms: RoomService
  readonly tasks: TaskService
  readonly settings: SettingsService
  readonly audit: Auditor
  readonly workspaceRoot: string
  readonly now: () => number
  readonly onDelivered: (root: Task) => readonly string[]
  readonly notify: (task: Task, event: 'done' | 'failed' | 'stalled') => void
  /** 临时 bot 表现好就转为常驻（返回 true 表示已转，不再归档）。 */
  readonly promote?: (botId: string, rootId: string) => boolean
}

export interface SubmitResult {
  readonly rootId: string
  readonly roomId: string
  readonly pending: boolean
}

/**
 * 团队任务（L2 临时小组、L3 正式团队）的编排：按计划建任务树和任务记录、发开工说明、
 * 按依赖派出子任务，组长在自己的协调会话里按事件验收、改计划、交付。计划变更和审批在 coordinator.ts。
 */
export class Orchestrator {
  protected readonly deps: OrchestratorDeps

  constructor(deps: OrchestratorDeps) {
    this.deps = deps
  }

  protected get db(): DatabaseSync {
    return this.deps.db
  }

  plan(rootId: string): TeamPlan | null {
    return readTaskPlan<TeamPlan>(this.db, rootId)
  }

  keys(rootId: string): ReadonlyMap<string, string> {
    return planKeys(this.db, rootId)
  }

  /** 计划里的子任务 id（s1）或真实任务 id 都认。 */
  resolveSubtask(rootId: string, key: string): Task | undefined {
    const id = this.keys(rootId).get(key) ?? key
    const task = this.deps.tasks.get(id)
    return task !== undefined && task.rootId === rootId && task.parentId !== null ? task : undefined
  }

  keyOf(task: Task): string {
    for (const [key, id] of this.keys(task.rootId)) if (id === task.id) return key
    return task.id
  }

  children(rootId: string): readonly Task[] {
    return this.deps.tasks.tree(rootId).filter((task) => task.parentId === rootId)
  }

  nameOf = (botId: string | null): string => (botId === null ? '未指定' : (this.deps.bots.get(botId)?.name ?? botId))

  board(rootId: string): string {
    const root = this.deps.tasks.get(rootId)
    if (root === undefined) return ''
    return boardSummary(root, this.children(rootId), this.keys(rootId), this.nameOf)
  }

  leaderOf(root: Task): Bot {
    const team = root.teamId === null ? undefined : this.deps.teams.get(root.teamId)
    return (team === undefined ? undefined : this.deps.bots.activeBot(team.leaderBotId)) ?? this.deps.bots.lead()
  }

  /** 主管提交团队计划：校验通过就建任务树；放手档直接开工，谨慎档等你点“开始”。 */
  async submit(requester: PodSession, raw: unknown): Promise<PodResult<SubmitResult>> {
    const plan = parsePlan(raw, 1)
    const team = plan.level === 'L3' ? (plan.team === null ? undefined : this.deps.teams.resolve(plan.team)) : undefined
    if (plan.level === 'L3' && team === undefined) return fail('invalid-input', `找不到团队「${plan.team ?? ''}」。先用 create_team 组建，或者改成 L2 临时小组。`)
    const draftIds = new Set(plan.drafts.map((draft) => draft.draftId))
    const problems = validatePlan(plan, { profileOf: (owner) => (draftIds.has(owner) ? undefined : this.deps.bots.resolve(owner)?.toolProfile) })
    if (problems.length > 0) return fail('invalid-input', `计划没通过校验，请修改后重新提交：\n- ${problems.join('\n- ')}`)
    const drafts = new Map<string, Bot>()
    for (const draft of plan.drafts) {
      const bot = this.deps.bots.createFromDraft(
        { name: draft.name, title: draft.title, persona: draft.persona, capabilities: draft.capabilities, toolProfile: draft.toolProfile, temporary: true },
        { source: 'lead', actor: requester.botId, reason: `为「${truncate(plan.goal, 30)}」新建的临时 bot` },
      )
      drafts.set(draft.draftId, bot)
    }
    const ownerOf = (owner: string): Bot | undefined => drafts.get(owner) ?? this.deps.bots.resolve(owner)
    const requesterBot = this.deps.bots.get(requester.botId) ?? this.deps.bots.lead()
    const leader = team === undefined ? requesterBot : (this.deps.bots.activeBot(team.leaderBotId) ?? requesterBot)
    const careful = (team?.autonomy ?? this.deps.settings.get().autonomy) === 'careful'
    const { root, subtasks, roomId } = this.createTree(plan, team, requester, requesterBot, leader, ownerOf, careful)
    this.deps.tasks.event(root, 'planned', requester.botId, { level: plan.level, reasons: plan.reasons, drafts: [...drafts.values()].map((bot) => bot.name) })
    this.deps.audit.record('task.plan', requester.botId, root.id, { level: plan.level, subtasks: subtasks.length })
    if (careful) {
      this.deps.rooms.milestone(roomId, '计划等你确认（谨慎档）：点开工说明上的“开始”')
      return ok({ rootId: root.id, roomId, pending: true })
    }
    await this.start(root.id)
    return ok({ rootId: root.id, roomId, pending: false })
  }

  private createTree(
    plan: TeamPlan,
    team: Team | undefined,
    requester: PodSession,
    requesterBot: Bot,
    leader: Bot,
    ownerOf: (owner: string) => Bot | undefined,
    careful: boolean,
  ): { readonly root: Task; readonly subtasks: readonly Task[]; readonly roomId: string } {
    const now = this.deps.now()
    const rootId = newId('task')
    const title = truncate(plan.goal, 40)
    const ceiling = requesterBot.toolProfile
    const tree = transaction(this.db, () => {
      const root = insertTask(this.db, {
        id: rootId,
        rootId,
        parentId: null,
        roomId: null,
        teamId: team?.id ?? null,
        title,
        brief: plan.goal,
        kind: '',
        deliverable: plan.deliverables.join('、'),
        acceptance: [],
        dependsOn: [],
        needs: { browser: false, shell: false },
        ownerBotId: leader.id,
        level: plan.level,
        status: careful ? 'queued' : 'running',
        stage: 'split',
        folder: rootTaskFolder({ id: rootId, title }, team),
        urgent: false,
        tainted: requester.tainted,
        maxProfile: ceiling,
        planPending: careful,
        createdBy: requester.id,
        requesterSession: requester.id,
        now,
      })
      writeTaskPlan(this.db, rootId, plan, 1, now)
      const created = plan.subtasks.map((item) => {
        const owner = ownerOf(item.owner)
        const id = newId('task')
        const task = insertTask(this.db, {
          id,
          rootId,
          parentId: rootId,
          roomId: null,
          teamId: team?.id ?? null,
          title: item.title,
          brief: item.brief,
          kind: item.kind,
          deliverable: item.deliverable,
          acceptance: newAcceptance(item.acceptance),
          dependsOn: [],
          needs: item.needs,
          ownerBotId: owner?.id ?? null,
          level: null,
          status: 'queued',
          stage: null,
          folder: childTaskFolder(root.folder, { id, title: item.title }),
          urgent: false,
          tainted: requester.tainted,
          maxProfile: owner === undefined ? ceiling : intersectProfiles(owner.toolProfile, ceiling),
          createdBy: requester.id,
          requesterSession: null,
          now,
        })
        setTaskPlanKey(this.db, id, item.id)
        return { key: item.id, task, dependsOn: item.dependsOn }
      })
      const idOf = new Map(created.map((item) => [item.key, item.task.id]))
      const subtasks = created.map(
        (item) => updateTask(this.db, item.task.id, { dependsOn: item.dependsOn.map((key) => idOf.get(key) ?? key) }, now) ?? item.task,
      )
      return { root, subtasks }
    })
    const members = [leader.id, requesterBot.id, ...tree.subtasks.map((task) => task.ownerBotId).filter((id): id is string => id !== null)]
    const groupName = plan.name !== undefined && plan.name !== '' ? truncate(plan.name, GROUP_NAME_MAX) : shortGroupName(plan.goal)
    const room = this.deps.rooms.createTaskRoom(groupName, rootId, members, team?.id ?? null)
    const root = updateTask(this.db, rootId, { roomId: room.id }, now) ?? tree.root
    for (const task of tree.subtasks) updateTask(this.db, task.id, { roomId: room.id }, now)
    this.deps.rooms.post(room.id, {
      author: leader.id,
      kind: 'kickoff',
      body: composeKickoff(plan, tree.subtasks, this.nameOf, leader.name, careful),
      data: { taskId: rootId, pending: careful },
    })
    this.deps.rooms.post(room.id, { author: leader.id, kind: 'task-card', body: title, data: { taskId: rootId, rootId } })
    // 发起的单聊里也放一张卡片，点开就能看进度；正式团队的团队记录里也放一张。
    for (const target of [requester.roomId, team?.roomId ?? null]) {
      if (target !== null && target !== room.id) {
        this.deps.rooms.post(target, { author: leader.id, kind: 'task-card', body: title, data: { taskId: rootId, rootId, roomId: room.id } })
      }
    }
    return { root, subtasks: tree.subtasks, roomId: room.id }
  }

  /** 开工：组长开一条协调会话（只注入背景，不唤醒），然后派出依赖已满足的子任务。 */
  async start(rootId: string): Promise<PodResult<Task>> {
    const root = this.deps.tasks.get(rootId)
    if (root === undefined || root.parentId !== null) return fail('not-found', '找不到这个团队任务')
    const now = this.deps.now()
    const started = updateTask(this.db, rootId, { status: 'running', stage: 'execute', planPending: false, startedAt: root.startedAt ?? now }, now) ?? root
    this.deps.tasks.touched(started)
    const leader = this.leaderOf(started)
    const plan = this.plan(rootId)
    let coord = this.deps.registry.activeForTask(rootId, 'coord')
    if (coord === undefined) {
      coord = await this.deps.registry.open({
        bot: leader,
        kind: 'coord',
        roomId: started.roomId,
        taskId: rootId,
        folder: started.folder,
        title: `Pod · 协调 · ${started.title}`,
        tainted: started.tainted,
        ceiling: started.maxProfile,
      })
    }
    if (plan !== null) {
      const context = coordContext(plan, this.board(rootId))
      this.deps.dispatcher.enqueue({ sessionId: coord.id, mode: 'inject', priority: PRIORITY.task, text: context, source: noticeSource('你负责协调的任务') })
    }
    await this.schedule(rootId)
    return ok(this.deps.tasks.get(rootId) ?? started)
  }

  /** 派出依赖都满足了的子任务；被取消的上游也算满足，不让下游一直等。 */
  async schedule(rootId: string): Promise<void> {
    const root = this.deps.tasks.get(rootId)
    if (root === undefined || root.status !== 'running') return
    const children = this.children(rootId)
    const settled = new Set(children.filter((task) => task.status === 'done' || task.status === 'cancelled').map((task) => task.id))
    const started = new Set(children.filter((task) => task.status !== 'queued').map((task) => task.id))
    const ready = readySubtasks(children, settled, started)
    for (const id of ready) {
      const task = this.deps.tasks.get(id)
      if (task !== undefined) await this.startSubtask(task)
    }
  }

  /** 给负责人开一条任务会话，开头是任务说明、验收项、任务约定、前提和上游结果。 */
  async startSubtask(task: Task, handover?: string): Promise<void> {
    const root = this.deps.tasks.get(task.rootId)
    if (root === undefined || task.ownerBotId === null) return
    let owner = this.deps.bots.get(task.ownerBotId)
    if (owner === undefined) return
    if (owner.archivedAt !== null) {
      const restored = this.deps.bots.restore({ id: owner.id }, 'pod')
      if (restored.ok) owner = restored.value
    }
    const plan = this.plan(root.id)
    const key = this.keyOf(task)
    const upstream = task.dependsOn
      .map((id) => this.deps.tasks.get(id))
      .filter((item): item is Task => item !== undefined && item.result !== null)
      .map((item) => ({ title: item.title, summary: item.result?.summary ?? '', files: item.result?.files ?? [] }))
    const assumptions = (plan?.assumptions ?? []).filter((item) => item.affects.length === 0 || item.affects.includes(key)).map((item) => item.text)
    const coord = this.deps.registry.activeForTask(root.id, 'coord')
    const now = this.deps.now()
    const running = updateTask(this.db, task.id, { status: 'running', startedAt: task.startedAt ?? now, requesterSession: coord?.id ?? null }, now) ?? task
    this.deps.tasks.touched(running)
    let session: PodSession
    try {
      session = await this.deps.registry.open({
        bot: owner,
        kind: 'task',
        roomId: null,
        taskId: task.id,
        folder: task.folder,
        title: `Pod · ${root.title} · ${task.title}`,
        tainted: root.tainted,
        ceiling: task.maxProfile,
      })
    } catch (error) {
      const failed = updateTask(this.db, task.id, { status: 'failed', note: `开任务会话失败：${error instanceof Error ? error.message : String(error)}` }, this.deps.now())
      if (failed !== undefined) this.tellCoordinator(failed, stalledEvent(failed, key, failed.note, this.board(root.id)))
      return
    }
    const brief = composeBrief(running, {
      fromName: this.leaderOf(root).name,
      assumptions,
      conventions: plan?.conventions ?? [],
      upstream,
      workspaceRoot: this.deps.workspaceRoot,
    })
    this.deps.dispatcher.enqueue({
      sessionId: session.id,
      mode: 'followup',
      priority: root.urgent ? PRIORITY.urgent : PRIORITY.task,
      text: handover === undefined ? brief : `${brief}\n\n[交接] ${handover}`,
      source: coord === undefined ? noticeSource(`任务：${task.title}`) : relaySource(coord.id),
    })
    this.deps.tasks.event(running, 'started', owner.id, { key })
  }

  /** 唤醒组长处理一件事。 */
  tellCoordinator(task: Task, text: string): void {
    const coord = this.deps.registry.activeForTask(task.rootId, 'coord')
    if (coord === undefined) return
    this.deps.dispatcher.enqueue({ sessionId: coord.id, mode: 'followup', priority: task.urgent ? PRIORITY.urgent : PRIORITY.task, text, source: noticeSource(text.split('\n')[0] ?? '任务事件') })
  }

  /** 成员提交子任务：进入待验收，唤醒组长。 */
  onSubmitted(task: Task, result: TaskResult): Task {
    const now = this.deps.now()
    const acceptance = task.acceptance.map((item) => (item.done ? item : { ...item, done: true, at: now }))
    const review = updateTask(this.db, task.id, { status: 'review', result, acceptance }, now) ?? task
    this.deps.tasks.touched(review)
    this.tellCoordinator(review, submitEvent(review, this.keyOf(review), this.nameOf(review.ownerBotId), result, this.board(review.rootId)))
    return review
  }

  /** 子任务停滞或失败：交给组长处理（换做法、换人、拆小或降级）。 */
  onStalled(task: Task, reason: string): void {
    this.tellCoordinator(task, stalledEvent(task, this.keyOf(task), reason, this.board(task.rootId)))
  }

  /** 全部子任务通过后进入汇总，唤醒组长。 */
  protected afterSettled(rootId: string): void {
    const root = this.deps.tasks.get(rootId)
    if (root === undefined || root.status !== 'running') return
    const children = this.children(rootId)
    const live = children.filter((task) => task.status !== 'cancelled')
    if (live.length === 0 || live.some((task) => task.status !== 'done')) return
    if (root.stage === 'integrate') return
    const integrating = updateTask(this.db, rootId, { stage: 'integrate' }, this.deps.now()) ?? root
    this.deps.tasks.touched(integrating)
    this.tellCoordinator(integrating, allDoneEvent(integrating, this.board(rootId)))
  }
}
