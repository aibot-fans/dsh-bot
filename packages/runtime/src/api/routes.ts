import {
  MEMORY_TYPES,
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
import { getMessage, listAudit, taskResultMessage, updateHandoverNote } from 'pod-store'
import type { PodRuntime } from '../pod.ts'
import { roomActivity, taskActivity, type ActivityDeps } from '../tasks/activity.ts'
import type { ControlAction } from '../tasks/service.ts'
import { get, post, type RouteSpec } from './router.ts'
import { taskOfMessage } from './views.ts'

function activityDeps(pod: PodRuntime): ActivityDeps {
  return { db: pod.db, room: (id) => pod.rooms.get(id), task: (id) => pod.tasks.get(id), snapshot: (id) => pod.tasks.snapshot(id), botName: (id) => pod.bots.get(id)?.name }
}

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

const SCOPES: readonly MemoryScopeKind[] = ['owner', 'bot', 'team', 'room', 'task', 'org']

const STATUSES: readonly TaskStatus[] = ['queued', 'running', 'waiting', 'review', 'done', 'failed', 'paused', 'stopped', 'cancelled']

/** 房间、消息、任务和等你处理。 */
export function workRoutes(pod: PodRuntime): readonly RouteSpec[] {
  return [
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
    // 动态：群、单聊详情里成员下面那一栏；任务详情里也是它。
    get('/room/activity', (query) => {
      const id = readId(query, 'id')
      const activity = id === undefined ? undefined : roomActivity(activityDeps(pod), id)
      return activity === undefined ? fail('not-found', t('找不到这个聊天室')) : ok(activity)
    }),
    get('/task/activity', (query) => {
      const id = readId(query, 'id')
      const jobs = id === undefined ? undefined : taskActivity(activityDeps(pod), id)
      return jobs === undefined ? fail('not-found', t('找不到这个任务')) : ok(jobs)
    }),
    // 没有自己对话的任务放结果的那条消息：点这种任务时跳过去。
    get('/task/message', (query) => {
      const id = readId(query, 'id')
      const task = id === undefined ? undefined : pod.tasks.get(id)
      return task === undefined ? fail('not-found', t('找不到这个任务')) : ok(taskResultMessage(pod.db, task.rootId) ?? null)
    }),
    post('/task/control', (body) => {
      const taskId = readId(body, 'taskId')
      const action = readString(body, 'action')
      if (taskId === undefined || !['pause', 'resume', 'stop', 'cancel', 'retry', 'accept'].includes(action)) return fail('invalid-input', t('要写明任务和操作'))
      return pod.tasks.control(taskId, action as ControlAction, 'owner')
    }),
    post('/task/redeliver', (body) => {
      const taskId = readId(body, 'taskId')
      return taskId === undefined ? fail('invalid-input', t('缺少任务 id')) : pod.tasks.redeliver(taskId)
    }),
    post('/task/approve', async (body) => {
      const taskId = readId(body, 'taskId')
      return taskId === undefined ? fail('invalid-input', t('缺少任务 id')) : pod.coordinator.approve(taskId)
    }),
    post('/tasks/stop-all', () => {
      const active = pod.tasks.roots(500).filter((task) => isActive(task.status) || task.status === 'paused')
      const stopped = active.map((task) => pod.tasks.control(task.id, 'stop', 'owner')).filter((result) => result.ok).length
      return ok({ stopped })
    }),

    get('/waits', () => ok(pod.waits.open())),
    get('/wait', (query) => {
      const id = readId(query, 'id')
      const wait = id === undefined ? undefined : pod.waits.get(id)
      return wait === undefined ? fail('not-found', t('找不到这件事')) : ok(wait)
    }),

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
    // 主题笔记：一个范围的笔记，和并进每页的条目（每句话的出处）。
    get('/memory/notes', (query) => {
      const scope = readString(query, 'scope') as MemoryScopeKind
      if (!SCOPES.includes(scope)) return fail('invalid-input', t('作用域不对'))
      const scopeId = readString(query, 'scopeId')
      return ok({ notes: pod.memory.notes(scope, scopeId), merged: pod.memory.list({ scopeKind: scope, scopeId, statuses: ['merged'] }), guide: pod.dreams.guide(scope, scopeId) })
    }),
    post('/memory/note/update', (body) => pod.memory.updateNoteFromPage(body)),
    post('/memory/guide', (body) => {
      const scope = readString(body, 'scope') as MemoryScopeKind
      return SCOPES.includes(scope) ? ok(pod.dreams.setGuide(scope, readString(body, 'scopeId'), readString(body, 'text'))) : fail('invalid-input', t('作用域不对'))
    }),
    // 夜里的整理：每一晚一条记录，先给你看或直接生效，能整晚撤销。
    get('/memory/dreams', () => ok(pod.dreams.list())),
    get('/memory/dream', (query) => {
      const detail = pod.dreams.detail(readString(query, 'id'))
      return detail === undefined ? fail('not-found', t('找不到这次整理')) : ok(detail)
    }),
    post('/memory/dream/start', (body) => {
      const scope = readString(body, 'scope') as MemoryScopeKind
      return pod.dreams.start('manual', SCOPES.includes(scope) ? [{ kind: scope, id: readString(body, 'scopeId') }] : [])
    }),
    post('/memory/dream/apply', (body) => {
      const skip = (body as { readonly skip?: unknown }).skip
      return pod.dreams.apply(readString(body, 'id'), Array.isArray(skip) ? skip.filter((seq): seq is number => typeof seq === 'number') : [])
    }),
    post('/memory/dream/discard', (body) => pod.dreams.discard(readString(body, 'id'))),
    post('/memory/dream/reread', () => pod.dreams.reread()),
    post('/memory/dream/revert', (body) => pod.dreams.revert(readString(body, 'id'))),
    post('/memory/dream/answer', (body) => pod.dreams.answer(readString(body, 'id'), readString(body, 'questionId'), readString(body, 'label'))),

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
