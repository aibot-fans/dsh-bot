import type { DatabaseSync } from 'node:sqlite'
import { t, type TriggerSpec } from 'pod-domain'
import { getRoutine } from 'pod-store'
import type { SessionRegistry } from '../agents/registry.ts'
import type { BotService } from '../bots/service.ts'
import type { RoomService } from '../chat/rooms.ts'
import type { Engine } from '../engine/index.ts'
import type { TriggerClock } from '../engine/triggers.ts'
import { openAutoTask } from '../tasks/standing.ts'

export interface RoutineMigrationDeps {
  readonly db: DatabaseSync
  readonly engine: Engine
  readonly rooms: RoomService
  readonly triggers: TriggerClock
  readonly bots: BotService
  readonly registry: SessionRegistry
  readonly now: () => number
  readonly warn: (message: string, error?: unknown) => void
}

/**
 * 旧的例程换成挂触发器的常开任务：时间、开关、补跑、错峰、盯网页的指纹都搬到触发器上，原来的下次时间沿用；
 * 例程那一行记下换成了哪个任务并标成删掉。旧的例程会话不再用。返回换了几个。
 */
export function migrateRoutines(deps: RoutineMigrationDeps): number {
  const rows = deps.db.prepare('SELECT id FROM routines WHERE deleted_at IS NULL AND task_id IS NULL ORDER BY created_at').all() as unknown as readonly { readonly id: string }[]
  const now = deps.now()
  let moved = 0
  for (const row of rows) {
    const routine = getRoutine(deps.db, row.id)
    if (routine === undefined) continue
    const retire = (taskId: string): void => {
      deps.db.prepare('UPDATE routines SET task_id = ?, deleted_at = ?, updated_at = ? WHERE id = ?').run(taskId, now, now, routine.id)
    }
    const bot = deps.bots.get(routine.botId)
    const spec: TriggerSpec | undefined =
      routine.kind === 'watch'
        ? { kind: 'page', url: routine.url, selector: routine.selector, minutes: routine.intervalMinutes }
        : routine.runAt !== null
          ? routine.runAt > now
            ? { kind: 'at', at: routine.runAt }
            : undefined
          : { kind: 'cron', cron: routine.cron }
    if (bot === undefined || bot.archivedAt !== null || spec === undefined) {
      retire('')
      continue
    }
    let roomId = routine.roomId !== null && deps.rooms.get(routine.roomId) !== undefined ? routine.roomId : null
    if (roomId === null) {
      const opened = deps.rooms.openDirect({ botId: bot.id })
      if (!opened.ok) {
        deps.warn(t('例程「{title}」没换成任务：{reason}', { title: routine.title, reason: opened.error.message }))
        continue
      }
      roomId = opened.value.id
    }
    const opened = openAutoTask(deps, {
      bot,
      title: routine.title,
      brief: routine.prompt,
      roomId,
      replyTo: [{ roomId, messageId: null }],
      origin: { kind: 'rule', rule: t('例程'), requester: routine.createdBy },
      trigger: {
        spec,
        timezone: routine.timezone,
        enabled: routine.enabled,
        nextAt: routine.nextRunAt,
        lastAt: routine.lastRunAt,
        state: {
          source: 'routine',
          catchUp: routine.catchUp,
          offPeak: routine.offPeak,
          lastStatus: routine.lastStatus,
          ...(routine.pageId === null ? {} : { pageId: routine.pageId }),
          ...(routine.fingerprint === '' ? {} : { fingerprint: routine.fingerprint, lastText: routine.lastText }),
        },
        createdBy: routine.createdBy,
      },
      actor: routine.createdBy,
    })
    if (!opened.ok) {
      deps.warn(t('例程「{title}」没换成任务：{reason}', { title: routine.title, reason: opened.error.message }))
      retire('')
      continue
    }
    retire(opened.value.task.id)
    moved += 1
  }
  for (const session of deps.registry.active().filter((item) => item.kind === 'routine')) deps.registry.retire(session.id)
  return moved
}
