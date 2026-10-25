import type { DatabaseSync } from 'node:sqlite'
import type { Bot, PodSettings } from 'pod-domain'
import { listRootTasks } from 'pod-store'
import type { BotService } from '../bots/service.ts'
import type { RoomService } from '../chat/rooms.ts'
import type { Auditor } from '../core/audit.ts'
import type { PodBus } from '../core/bus.ts'
import type { LiteLlm } from '../core/lite.ts'
import type { MemoryService } from '../memory/service.ts'
import type { NotificationService } from '../notify/service.ts'
import type { TaskService } from '../tasks/service.ts'
import type { UsageMeter } from '../usage/meter.ts'
import { FeedbackService } from './feedback.ts'
import { Retrospective } from './retro.ts'
import { EvolutionService } from './service.ts'
import { SkillService } from './skills.ts'
import { Tuner } from './tuning.ts'

export interface EvolutionKitDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly audit: Auditor
  readonly bots: BotService
  readonly memory: MemoryService
  readonly rooms: RoomService
  readonly notifications: NotificationService
  readonly tasks: () => TaskService
  readonly meter: UsageMeter
  readonly lite: LiteLlm
  readonly settings: () => PodSettings
  readonly workspaceRoot: string
  readonly now: () => number
  readonly warn: (message: string, error?: unknown) => void
  readonly teamsOf: (botId: string) => readonly string[]
  readonly efforts: (bot: Bot) => Promise<{ readonly efforts: readonly string[]; readonly current: string } | undefined>
  readonly liteIsDeepSeek: () => Promise<boolean>
}

export interface EvolutionKit {
  readonly feedback: FeedbackService
  readonly skills: SkillService
  readonly evolution: EvolutionService
  readonly retro: Retrospective
  readonly tuner: Tuner
}

/** 组装自我优化：反馈信号、技能、进化日志、复盘和夜间调整。 */
export function createEvolutionKit(deps: EvolutionKitDeps): EvolutionKit {
  const feedback = new FeedbackService({
    db: deps.db,
    bus: deps.bus,
    meter: deps.meter,
    workspaceRoot: deps.workspaceRoot,
    now: deps.now,
    task: (id) => deps.tasks().get(id),
    lastBotIn: (roomId) => {
      const row = deps.db.prepare("SELECT author FROM messages WHERE room_id = ? AND kind = 'text' AND author NOT IN ('owner', 'pod') AND deleted_at IS NULL ORDER BY seq DESC LIMIT 1").get(roomId) as { readonly author: string } | undefined
      return row?.author
    },
  })
  const skills = new SkillService({ db: deps.db, bus: deps.bus, audit: deps.audit, now: deps.now, teamsOf: deps.teamsOf })
  const evolution = new EvolutionService({
    db: deps.db,
    bus: deps.bus,
    audit: deps.audit,
    bots: deps.bots,
    memory: deps.memory,
    skills,
    feedback,
    rooms: deps.rooms,
    notifications: deps.notifications,
    settings: deps.settings,
    now: deps.now,
    ownerChanges: (since) =>
      deps.memory
        .changes(since)
        .filter((change) => (change.after ?? change.before)?.scopeKind === 'owner')
        .map((change) => (change.after ?? change.before)?.content ?? ''),
    rootsFinishedSince: (since) => listRootTasks(deps.db, { limit: 500 }).filter((task) => (task.finishedAt ?? 0) >= since).length,
  })
  const retro = new Retrospective({
    db: deps.db,
    lite: deps.lite,
    get tasks() {
      return deps.tasks()
    },
    bots: deps.bots,
    memory: deps.memory,
    skills,
    evolution,
    settings: deps.settings,
    now: deps.now,
    warn: deps.warn,
    liteIsDeepSeek: deps.liteIsDeepSeek,
  })
  const tuner = new Tuner({ db: deps.db, lite: deps.lite, bots: deps.bots, feedback, evolution, now: deps.now, warn: deps.warn, efforts: deps.efforts })
  return { feedback, skills, evolution, retro, tuner }
}
