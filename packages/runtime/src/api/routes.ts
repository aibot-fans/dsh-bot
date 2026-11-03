import {
  MEMORY_TYPES,
  OWNER,
  fail,
  isActive,
  ok,
  readBool,
  readId,
  readInt,
  readString,
  t,
  type MemoryScopeKind,
  type MemoryStatus,
  type MemoryType,
  type SearchKind,
  type TaskStatus,
} from 'pod-domain'
import { getMessage, listAudit, progressOfTree, reportsFor, updateHandoverNote } from 'pod-store'
import type { PodRuntime } from '../pod.ts'
import type { ControlAction } from '../tasks/service.ts'
import { followViews, taskTimeline } from '../tasks/timeline.ts'
import { get, post, type RouteSpec } from './router.ts'
import { overviewOf, routesOf, taskOfMessage, triggerViews } from './views.ts'

/** 任务对话的「进展」最多列几条。 */
const PROGRESS_LIMIT = 12

/** 设置、bot 管理、回收站、审计和维护这些基础接口。 */
export function baseRoutes(pod: PodRuntime): readonly RouteSpec[] {
  return [
    get('/status', () => ok(pod.status())),
    get('/health', () => ok(pod.health())),
    post('/health/retry', (body) => {
      const kind = readString(body, 'kind')
      return kind === '' ? fail('invalid-input', t('缺少问题的种类')) : pod.problems.retry(kind)
    }),
    get('/settings', () => ok(pod.settings.get())),
    post('/settings/update', (body) => pod.settings.update(body)),
    // 页面上报 dsh 的界面语言：设置是“跟随 dsh”时宿主照它说话。
    post('/locale', (body) => pod.language.reportHost(readString(body, 'locale'))),
    get('/models', async () => ok(await pod.models.catalog())),

    get('/bots', () => ok(pod.bots.active())),
    post('/bot/create', (body) => pod.bots.create(body)),
    post('/bot/update', (body) => pod.bots.update(body)),
    post('/bot/archive', (body) => pod.bots.archive(body)),
    post('/bot/restore', (body) => pod.bots.restore(body)),
    post('/bot/rollback', (body) => pod.bots.rollback(body)),
    get('/bot/versions', (query) => pod.bots.versions(query)),
    get('/bot/seed', (query) => {
      const id = readId(query, 'id')
      return id === undefined ? fail('invalid-input', t('缺少 bot 的 id')) : ok(pod.seeds.update(id) ?? null)
    }),
    post('/bot/seed/keep', (body) => {
      const id = readId(body, 'id')
      return id === undefined ? fail('invalid-input', t('缺少 bot 的 id')) : pod.seeds.keep(id)
    }),
    post('/bot/seed/adopt', (body) => {
      const id = readId(body, 'id')
      return id === undefined ? fail('invalid-input', t('缺少 bot 的 id')) : pod.seeds.adopt(id)
    }),
    get('/recycle', () => ok({ bots: pod.bots.recycleBin(), teams: pod.teams.all().filter((team) => team.archivedAt !== null) })),

    get('/teams', () => ok(pod.teams.list())),
    get('/team/templates', () => ok(pod.teams.templates())),
    post('/team/create', (body) => pod.teams.create(body)),
    post('/team/update', (body) => pod.teams.update(body)),
    post('/team/archive', (body) => pod.teams.archive(body)),
    post('/team/restore', (body) => pod.teams.restore(body)),
    post('/team/from-template', (body) => pod.teams.fromTemplate(body)),

    get('/audit', (query) => {
      const before = Number(readString(query, 'before'))
      const limit = Math.min(readInt(query, 'limit') ?? (Number(readString(query, 'limit')) || 100), 500)
      return ok(listAudit(pod.db, Number.isSafeInteger(before) && before > 0 ? { limit, before } : { limit }))
    }),
    post('/maintenance/backup', async () => ok({ file: await pod.maintenance.backupNow(pod.now()) })),
  ]
}

const SCOPES: readonly MemoryScopeKind[] = ['owner', 'bot', 'team', 'room', 'task']

const STATUSES: readonly TaskStatus[] = ['queued', 'running', 'waiting', 'review', 'done', 'failed', 'paused', 'stopped', 'cancelled']

/** 房间、消息、任务和等你处理。 */
export function workRoutes(pod: PodRuntime): readonly RouteSpec[] {
  return [
    get('/overview', () => ok(overviewOf(pod))),
    get('/message/routes', (query) => {
      const id = readId(query, 'id')
      return id === undefined ? fail('invalid-input', t('缺少消息 id')) : ok(routesOf(pod, id))
    }),
    get('/rooms', (query) => pod.rooms.list(query)),
    post('/room/open', (body) => pod.rooms.openDirect(body)),
    get('/room/messages', (query) => pod.rooms.messages(query)),
    get('/room/members', (query) => {
      const roomId = readId(query, 'roomId')
      return roomId === undefined ? fail('invalid-input', t('缺少房间 id')) : ok(pod.rooms.members(roomId))
    }),
    get('/room/info', (query) => {
      const roomId = readId(query, 'roomId')
      const room = roomId === undefined ? undefined : pod.rooms.get(roomId)
      if (room === undefined) return fail('not-found', t('找不到这个房间'))
      const sessions = pod.registry.active().filter((session) => session.roomId === room.id)
      return ok({ room, members: pod.rooms.members(room.id), sessions })
    }),
    post('/room/send', (body) => pod.rooms.send(body)),
    post('/room/read', (body) => pod.rooms.markRead(body)),
    post('/room/update', (body) => pod.rooms.update(body)),
    post('/message/pin', (body) => pod.rooms.pin(body)),
    get('/room/pins', (query) => pod.rooms.pins(query)),
    get('/message', (query) => {
      const id = readId(query, 'id')
      const message = id === undefined ? undefined : getMessage(pod.db, id)
      return message === undefined ? fail('not-found', t('找不到这条消息')) : ok(message)
    }),

    get('/tasks', (query) => {
      const wanted = readString(query, 'status')
        .split(',')
        .filter((item): item is TaskStatus => (STATUSES as readonly string[]).includes(item))
      return ok(pod.tasks.roots(200, wanted.length === 0 ? undefined : wanted).map((task) => pod.tasks.snapshot(task.id)).filter(Boolean))
    }),
    get('/task/snapshot', (query) => {
      const id = readId(query, 'id')
      const snapshot = id === undefined ? undefined : pod.tasks.snapshot(id)
      return snapshot === undefined ? fail('not-found', t('找不到这个任务')) : ok(snapshot)
    }),
    get('/task/detail', (query) => {
      const id = readId(query, 'id')
      const snapshot = id === undefined ? undefined : pod.tasks.snapshot(id)
      if (snapshot === undefined) return fail('not-found', t('找不到这个任务'))
      const rootId = snapshot.task.rootId
      return ok({
        snapshot,
        events: pod.tasks.events(rootId),
        sessions: pod.tasks.tree(rootId).flatMap((task) => pod.registry.forTask(task.id)),
        waits: pod.waits.open().filter((wait) => wait.rootId === rootId),
        reports: reportsFor(pod.db, snapshot.task.id, 20),
        timeline: taskTimeline(pod.db, snapshot.task),
        follows: followViews(pod.db, snapshot.task),
        triggers: triggerViews(pod, snapshot.task.id),
      })
    }),
    get('/task/progress', (query) => {
      const id = readId(query, 'id')
      const task = id === undefined ? undefined : pod.tasks.get(id)
      return task === undefined ? fail('not-found', t('找不到这个任务')) : ok(progressOfTree(pod.db, task.rootId, PROGRESS_LIMIT))
    }),
    post('/task/control', (body) => {
      const taskId = readId(body, 'taskId')
      const action = readString(body, 'action')
      if (taskId === undefined || !['pause', 'resume', 'stop', 'cancel', 'retry', 'accept'].includes(action)) return fail('invalid-input', t('要写明任务和操作'))
      return pod.tasks.control(taskId, action as ControlAction, 'owner')
    }),
    post('/task/diagnose', async (body) => {
      const taskId = readId(body, 'taskId')
      const task = taskId === undefined ? undefined : pod.tasks.get(taskId)
      return task === undefined ? fail('not-found', t('找不到这个任务')) : ok({ text: await pod.judge.diagnose(task) })
    }),
    post('/task/redeliver', (body) => {
      const taskId = readId(body, 'taskId')
      return taskId === undefined ? fail('invalid-input', t('缺少任务 id')) : pod.tasks.redeliver(taskId)
    }),
    post('/task/approve', async (body) => {
      const taskId = readId(body, 'taskId')
      return taskId === undefined ? fail('invalid-input', t('缺少任务 id')) : pod.coordinator.approve(taskId)
    }),
    get('/task/plan', (query) => {
      const id = readId(query, 'id')
      const plan = id === undefined ? null : pod.coordinator.plan(id)
      return plan === null ? fail('not-found', t('这个任务没有团队计划')) : ok({ plan, keys: Object.fromEntries(pod.coordinator.keys(id ?? '')) })
    }),
    post('/trigger/update', (body) => {
      const id = readId(body, 'id')
      const enabled = readBool(body, 'enabled')
      if (id === undefined || enabled === undefined) return fail('invalid-input', t('缺少触发器 id 或开关'))
      const changed = pod.triggers.change(id, { enabled }, OWNER)
      return typeof changed === 'string' ? fail('conflict', changed) : ok(changed)
    }),
    post('/trigger/delete', (body) => {
      const id = readId(body, 'id')
      return id !== undefined && pod.triggers.close(id, OWNER) ? ok(null) : fail('not-found', t('找不到这个触发器'))
    }),
    post('/trigger/run', async (body) => {
      const id = readId(body, 'id')
      if (id === undefined) return fail('invalid-input', t('缺少触发器 id'))
      const problem = await pod.triggers.fireNow(id)
      return problem === undefined ? ok(null) : fail('conflict', problem)
    }),
    post('/task/talk', (body) => {
      const taskId = readId(body, 'taskId')
      const text = readString(body, 'text')
      if (taskId === undefined || text === '') return fail('invalid-input', t('要写明任务和要说的话'))
      return pod.tasks.talk(taskId, text)
    }),
    post('/tasks/stop-all', () => {
      const active = pod.tasks.roots(500).filter((task) => isActive(task.status) || task.status === 'paused')
      const stopped = active.map((task) => pod.tasks.control(task.id, 'stop', 'owner')).filter((result) => result.ok).length
      return ok({ stopped })
    }),

    get('/waits', () => ok(pod.waits.open())),

    // ---------- 例程和通知 ----------
    get('/routines', () => ok(pod.routines.list().map((routine) => ({ ...routine, description: pod.routines.describe(routine) })))),
    post('/routine/create', (body) => pod.routines.create(body, 'owner')),
    post('/routine/update', (body) => pod.routines.update(body)),
    post('/routine/delete', (body) => pod.routines.remove(body)),
    post('/routine/run', (body) => pod.routines.runNow(body)),
    get('/notifications', () => ok({ items: pod.notifications.list(), unread: pod.notifications.unread() })),
    post('/notifications/read', (body) => {
      const ids = (body as { readonly ids?: unknown }).ids
      pod.notifications.markRead(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : 'all')
      return ok(null)
    }),

    // ---------- 记忆 ----------
    get('/memory', (query) => {
      const scope = readString(query, 'scope') as MemoryScopeKind
      const statuses = readString(query, 'status').split(',').filter(Boolean) as MemoryStatus[]
      return ok(
        pod.memory.list({
          ...(SCOPES.includes(scope) ? { scopeKind: scope } : {}),
          ...(readString(query, 'scopeId') === '' && scope !== 'owner' ? {} : { scopeId: readString(query, 'scopeId') }),
          statuses: statuses.length === 0 ? ['active', 'pending', 'archived'] : statuses,
        }),
      )
    }),
    get('/memory/core', (query) => {
      const scope = readString(query, 'scope') as MemoryScopeKind
      return SCOPES.includes(scope) ? ok(pod.memory.core(scope, readString(query, 'scopeId'))) : fail('invalid-input', t('作用域不对'))
    }),
    post('/memory/core', (body) => {
      const scope = readString(body, 'scope') as MemoryScopeKind
      if (!SCOPES.includes(scope)) return fail('invalid-input', t('作用域不对'))
      return ok(pod.memory.setCore(scope, readString(body, 'scopeId'), readString(body, 'text'), 'owner'))
    }),
    post('/memory/add', (body) => {
      const scope = readString(body, 'scope') as MemoryScopeKind
      const type = readString(body, 'type') as MemoryType
      if (!SCOPES.includes(scope)) return fail('invalid-input', t('作用域不对'))
      return pod.memory.add(
        {
          scopeKind: scope,
          scopeId: readString(body, 'scopeId'),
          type: (MEMORY_TYPES as readonly string[]).includes(type) ? type : 'fact',
          content: readString(body, 'content'),
          source: 'owner',
          private: readBool(body, 'private') === true,
          pinned: readBool(body, 'pinned') === true,
        },
        'owner',
        '你在记忆页面添加',
      )
    }),
    post('/memory/update', (body) => pod.memory.updateFromPage(body)),
    post('/memory/delete', (body) => {
      const id = readId(body, 'id')
      return id === undefined ? fail('invalid-input', t('缺少记忆 id')) : pod.memory.remove(id, 'owner')
    }),
    get('/memory/changes', (query) => {
      const since = Number(readString(query, 'since'))
      return ok(pod.memory.changes(Number.isSafeInteger(since) && since > 0 ? since : undefined))
    }),
    post('/memory/revert', (body) => {
      const logId = readInt(body, 'logId')
      return logId === undefined ? fail('invalid-input', t('缺少变更编号')) : pod.memory.revert(logId)
    }),

    // ---------- 搜索和交接笔记 ----------
    get('/search', async (query) => {
      const q = readString(query, 'q')
      if (q === '') return ok([])
      const kinds = readString(query, 'kinds').split(',').filter(Boolean) as SearchKind[]
      const roomId = readString(query, 'roomId')
      const botId = readString(query, 'botId')
      const hits = await pod.search.search(q, {
        limit: 50,
        ...(kinds.length === 0 ? {} : { kinds }),
        ...(roomId === '' ? {} : { roomId }),
        ...(botId === '' ? {} : { botId }),
      })
      // 搜到的消息开了或送进了任务：带上任务，结果里能直接打开它的任务页。
      return ok(hits.map((hit) => (hit.kind === 'message' && hit.taskId === null ? { ...hit, taskId: taskOfMessage(pod, hit.ref.slice(hit.ref.indexOf(':') + 1)) } : hit)))
    }),
    get('/handovers', (query) => {
      const roomId = readString(query, 'roomId')
      const taskId = readString(query, 'taskId')
      return ok(pod.segments.list(roomId !== '' ? { roomId } : { taskId }))
    }),
    post('/handover/update', (body) => {
      const id = readId(body, 'id')
      const note = (body as { readonly note?: unknown }).note
      if (id === undefined || typeof note !== 'object' || note === null) return fail('invalid-input', t('要写明交接笔记和内容'))
      const updated = updateHandoverNote(pod.db, id, note as Readonly<Record<string, unknown>>, pod.now())
      return updated === undefined ? fail('not-found', t('找不到这份交接笔记')) : ok(updated)
    }),
    post('/wait/answer', (body) => pod.waits.answer(body)),
    post('/wait/dismiss', (body) => pod.waits.dismiss(body)),

    get('/session/activity', (query) => {
      const id = readId(query, 'id')
      return id === undefined ? fail('invalid-input', t('缺少会话 id')) : ok(pod.observer.activityOf(id) ?? null)
    }),
  ]
}
