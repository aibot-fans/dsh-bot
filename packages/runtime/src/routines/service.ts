import type { DatabaseSync } from 'node:sqlite'
import {
  PAGE_KIND_LABELS,
  PAGE_MAX_MINUTES,
  PAGE_MIN_MINUTES,
  checkUrl,
  describeCron,
  fail,
  formatLocal,
  ok,
  parseCron,
  parseLocalTime,
  readBool,
  readId,
  readInt,
  readObject,
  readString,
  t,
  truncate,
  type PageKind,
  type PodResult,
  type PodSettings,
  type Routine,
  type Task,
  type Trigger,
  type TriggerSpec,
} from 'pod-domain'
import { triggersBySource } from 'pod-store'
import type { SessionRegistry } from '../agents/registry.ts'
import type { BotService } from '../bots/service.ts'
import type { RoomService } from '../chat/rooms.ts'
import type { Auditor } from '../core/audit.ts'
import type { PodBus } from '../core/bus.ts'
import type { Engine } from '../engine/index.ts'
import type { TriggerClock, Wake } from '../engine/triggers.ts'
import { openAutoTask } from '../tasks/standing.ts'

export interface RoutineDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly bots: BotService
  readonly rooms: RoomService
  readonly registry: SessionRegistry
  readonly engine: Engine
  readonly triggers: TriggerClock
  readonly audit: Auditor
  readonly settings: () => PodSettings
  readonly now: () => number
  readonly warn: (message: string, error?: unknown) => void
  /** 例程要更新的页面现在的样子；页面不存在时返回 undefined。 */
  readonly describePage: (pageId: string) => { readonly title: string; readonly kind: PageKind; readonly version: number; readonly deleted: boolean } | undefined
}

export interface PageContent {
  readonly title: string
  readonly text: string
}

interface Entry {
  readonly task: Task
  readonly trigger: Trigger
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 例程：挂着时间触发器（或盯网页）的常开任务。每次到点是这个任务的一次新执行，在同一个任务会话里接着做；
 * 你在它的任务卡下说话就是在调整它。例程的 id 就是任务 id，时间、开关、补跑、错峰都在触发器上。
 */
export class RoutineService {
  private readonly deps: RoutineDeps

  constructor(deps: RoutineDeps) {
    this.deps = deps
  }

  /** 每个常开任务一条：一个任务挂了几个重复的触发器时，算最早挂上的那个。 */
  private entries(): readonly Entry[] {
    const seen = new Set<string>()
    return triggersBySource(this.deps.db, 'routine').flatMap((trigger) => {
      if (seen.has(trigger.taskId)) return []
      seen.add(trigger.taskId)
      const task = this.deps.engine.tickets.get(trigger.taskId)
      return task === undefined || task.endedAt !== null ? [] : [{ task, trigger }]
    })
  }

  private entry(id: string | undefined): Entry | undefined {
    return id === undefined ? undefined : this.entries().find((item) => item.task.id === id)
  }

  private view({ task, trigger }: Entry): Routine {
    const spec = trigger.spec
    return {
      id: task.id,
      title: task.title,
      kind: spec.kind === 'page' ? 'watch' : 'cron',
      cron: spec.kind === 'cron' ? spec.cron : '',
      runAt: spec.kind === 'at' ? spec.at : null,
      timezone: trigger.timezone,
      prompt: task.brief,
      botId: task.ownerBotId ?? '',
      roomId: task.roomId,
      pageId: text(trigger.state.pageId) || null,
      url: spec.kind === 'page' ? spec.url : '',
      selector: spec.kind === 'page' ? spec.selector : '',
      intervalMinutes: spec.kind === 'page' ? spec.minutes : 60,
      fingerprint: text(trigger.state.fingerprint),
      lastText: '',
      catchUp: trigger.state.catchUp !== false,
      offPeak: trigger.state.offPeak === true,
      enabled: trigger.enabled,
      lastRunAt: trigger.lastAt,
      nextRunAt: trigger.enabled ? trigger.nextAt : null,
      lastStatus: text(trigger.state.lastStatus),
      createdBy: task.createdBy,
      createdAt: task.createdAt,
      updatedAt: Math.max(task.updatedAt, trigger.updatedAt),
    }
  }

  list(): readonly Routine[] {
    return this.entries().map((item) => this.view(item))
  }

  get(id: string): Routine | undefined {
    const found = this.entry(id)
    return found === undefined ? undefined : this.view(found)
  }

  /** 例程的任务卡所在的聊天室：写了就用那个，没写是负责的 bot 的单聊。 */
  private roomFor(botId: string, roomId: string | null): string | PodResult<never> {
    if (roomId !== null) return this.deps.rooms.get(roomId) === undefined ? fail('not-found', t('找不到要发结果的房间')) : roomId
    const opened = this.deps.rooms.openDirect({ botId })
    return opened.ok ? opened.value.id : opened
  }

  /** 只跑一次的时刻：runAt（毫秒）或 at（「HH:MM」「YYYY-MM-DD HH:MM」）。都没写返回 undefined，写错了或者已经过了返回说明。 */
  private readRunAt(input: unknown, timezone: string): number | string | undefined {
    const now = this.deps.now()
    const at = readString(input, 'at')
    const time = at === '' ? readInt(input, 'runAt') : parseLocalTime(at, timezone, now)
    if (time === undefined || typeof time === 'string') return time
    return time > now ? time : t('这个时间已经过了')
  }

  /** 新建例程：{ title, kind, cron | runAt | at | url+interval, prompt, botId, roomId?, pageId? }。 */
  create(input: unknown, actor: string): PodResult<Routine> {
    const kind = readString(input, 'kind') === 'watch' ? 'watch' : 'cron'
    const title = truncate(readString(input, 'title'), 40)
    const prompt = readString(input, 'prompt')
    const botId = readId(input, 'botId')
    if (title === '') return fail('invalid-input', t('例程要有名字'))
    if (prompt === '') return fail('invalid-input', t('要写清每次做什么'))
    const bot = botId === undefined ? undefined : this.deps.bots.activeBot(botId)
    if (bot === undefined) return fail('not-found', t('找不到负责的 bot'))
    const room = this.roomFor(bot.id, readId(input, 'roomId') ?? null)
    if (typeof room !== 'string') return room
    const pageId = kind === 'cron' ? (readId(input, 'pageId') ?? null) : null
    if (pageId !== null && this.deps.describePage(pageId)?.deleted !== false) return fail('not-found', t('找不到要更新的页面'))
    const timezone = readString(input, 'timezone') || this.deps.settings().timezone
    let spec: TriggerSpec
    if (kind === 'watch') {
      const checked = checkUrl(readString(input, 'url'), this.deps.settings().allowedHosts)
      if (!checked.ok) return fail('invalid-input', checked.reason)
      const minutes = readInt(input, 'intervalMinutes') ?? (Number(readString(input, 'intervalMinutes')) || 60)
      if (minutes < PAGE_MIN_MINUTES || minutes > PAGE_MAX_MINUTES) return fail('invalid-input', t('检查间隔在 {min} 分钟到 7 天之间', { min: PAGE_MIN_MINUTES }))
      spec = { kind: 'page', url: checked.url.toString(), selector: readString(input, 'selector'), minutes }
    } else {
      const runAt = this.readRunAt(input, timezone)
      if (typeof runAt === 'string') return fail('invalid-input', runAt)
      if (runAt !== undefined) spec = { kind: 'at', at: runAt }
      else {
        const cron = readString(input, 'cron')
        const parsed = parseCron(cron)
        if (typeof parsed === 'string') return fail('invalid-input', parsed)
        spec = { kind: 'cron', cron }
      }
    }
    const opened = openAutoTask(this.deps, {
      bot,
      title,
      brief: prompt,
      roomId: room,
      replyTo: [{ roomId: room, messageId: null }],
      origin: { kind: 'rule', rule: t('例程'), requester: actor === 'owner' ? 'owner' : actor },
      trigger: {
        spec,
        timezone,
        // 只跑一次的多半是“到点看一眼”，默认不错峰；盯网页第一次一分钟后就读。
        state: { source: 'routine', catchUp: readBool(input, 'catchUp') ?? true, offPeak: readBool(input, 'offPeak') ?? spec.kind === 'cron', ...(pageId === null ? {} : { pageId }) },
        ...(spec.kind === 'page' ? { nextAt: this.deps.now() + 60_000 } : {}),
        createdBy: actor,
      },
      actor,
    })
    if (!opened.ok) return opened
    this.deps.audit.record('routine.create', actor, opened.value.task.id, { title, kind, spec })
    this.deps.bus.emit({ type: 'routines' })
    return ok(this.get(opened.value.task.id) ?? this.view({ task: opened.value.task, trigger: opened.value.trigger as Trigger }))
  }

  /** 改时间：cron（改成重复）、runAt 或 at（改成只跑一次）、intervalMinutes（盯网页的间隔）。返回新的 spec；没改返回 undefined，写错了返回说明。 */
  private readSpec(current: Entry, raw: unknown): TriggerSpec | string | undefined {
    const spec = current.trigger.spec
    const cron = readString(raw, 'cron')
    const runAt = this.readRunAt(raw, current.trigger.timezone)
    if (typeof runAt === 'string') return runAt
    const interval = readInt(raw, 'intervalMinutes')
    if (spec.kind === 'page') {
      if (cron !== '' || runAt !== undefined) return t('盯网页按间隔检查，只能改 intervalMinutes')
      if (interval === undefined) return undefined
      return interval < PAGE_MIN_MINUTES || interval > PAGE_MAX_MINUTES ? t('检查间隔在 {min} 分钟到 7 天之间', { min: PAGE_MIN_MINUTES }) : { ...spec, minutes: interval }
    }
    if (cron !== '' && runAt !== undefined) return t('重复的时间（cron）和只跑一次的时间只能写一个')
    if (runAt !== undefined) return { kind: 'at', at: runAt }
    if (cron === '') return undefined
    const parsed = parseCron(cron)
    return typeof parsed === 'string' ? parsed : { kind: 'cron', cron }
  }

  /** 改例程：{ id, patch }。patch 里只写要改的：名字、指令、时间、页面、谁来做、发到哪（roomId，null 是单聊）、开关。 */
  update(input: unknown, actor = 'owner'): PodResult<Routine> {
    const current = this.entry(readId(input, 'id'))
    if (current === undefined) return fail('not-found', t('找不到这个例程'))
    const raw = readObject(input, 'patch')
    const spec = this.readSpec(current, raw)
    if (typeof spec === 'string') return fail('invalid-input', spec)
    const enabled = readBool(raw, 'enabled')
    const effective = spec ?? current.trigger.spec
    if (enabled === true && effective.kind === 'at' && effective.at <= this.deps.now()) return fail('invalid-input', t('这个只跑一次的例程已经过了时间：写一个新的时间再打开'))
    const pageValue = readObject(raw, 'pageId')
    const pageId = typeof pageValue === 'string' && pageValue.trim() !== '' ? pageValue.trim() : null
    if (pageId !== null && this.deps.describePage(pageId)?.deleted !== false) return fail('not-found', t('找不到要更新的页面'))
    // 换人来做：之后到点由新的 bot 做，结果以它的名义发；旧的任务会话不再用。
    const botId = readId(raw, 'botId')
    if (botId !== undefined && this.deps.bots.activeBot(botId) === undefined) return fail('not-found', t('找不到要换成的 bot'))
    const roomValue = readObject(raw, 'roomId')
    let task = current.task
    const title = readString(raw, 'title') === '' ? undefined : truncate(readString(raw, 'title'), 40)
    const prompt = readString(raw, 'prompt') === '' ? undefined : readString(raw, 'prompt')
    if (title !== undefined || prompt !== undefined || (botId !== undefined && botId !== task.ownerBotId)) {
      task = this.deps.engine.tickets.patch(task, { ...(title === undefined ? {} : { title }), ...(prompt === undefined ? {} : { brief: prompt }), ...(botId === undefined ? {} : { ownerBotId: botId }) })
      if (botId !== undefined && botId !== current.task.ownerBotId) {
        const old = this.deps.registry.activeForTask(task.id, 'task')
        if (old !== undefined) this.deps.registry.retire(old.id)
      }
    }
    // 发到哪：房间 id；null 或空是负责的 bot 的单聊。换了地方就在那里放一张新的任务卡。
    if (roomValue !== undefined) {
      const wanted = typeof roomValue === 'string' && roomValue.trim() !== '' ? roomValue.trim() : null
      const room = this.roomFor(task.ownerBotId ?? '', wanted)
      if (typeof room !== 'string') return room
      if (room !== task.roomId) {
        task = this.deps.engine.tickets.patch(task, { roomId: room, replyTo: [{ roomId: room, messageId: null }] })
        const card = this.deps.rooms.post(room, { author: task.ownerBotId ?? 'pod', kind: 'task-card', body: task.title, data: { taskId: task.id, rootId: task.id, standing: true } })
        if (card !== undefined) this.deps.engine.topics.followMessage(task.id, card.id, 'own')
      }
    }
    const catchUp = readBool(raw, 'catchUp')
    const offPeak = readBool(raw, 'offPeak')
    const state = {
      ...(catchUp === undefined ? {} : { catchUp }),
      ...(offPeak === undefined ? {} : { offPeak }),
      ...(pageValue === undefined || effective.kind === 'page' ? {} : { pageId: pageId ?? '' }),
    }
    if (spec !== undefined || enabled !== undefined || Object.keys(state).length > 0) {
      const changed = this.deps.triggers.change(current.trigger.id, { ...(spec === undefined ? {} : { spec }), ...(enabled === undefined ? {} : { enabled }), state }, actor)
      if (typeof changed === 'string') return fail('invalid-input', changed)
    }
    this.deps.audit.record('routine.update', actor, task.id, { patch: raw })
    this.deps.bus.emit({ type: 'routines' })
    const updated = this.get(task.id)
    return updated === undefined ? fail('not-found', t('找不到这个例程')) : ok(updated)
  }

  /** 删掉例程：结束它的任务，触发器跟着关掉。 */
  remove(input: unknown, actor = 'owner'): PodResult<null> {
    const current = this.entry(readId(input, 'id'))
    if (current === undefined) return fail('not-found', t('找不到这个例程'))
    this.deps.engine.tickets.end(current.task.id, 'stopped', actor)
    this.deps.audit.record('routine.delete', actor, current.task.id, {})
    this.deps.bus.emit({ type: 'routines' })
    return ok(null)
  }

  async runNow(input: unknown): Promise<PodResult<Routine>> {
    const current = this.entry(readId(input, 'id'))
    if (current === undefined) return fail('not-found', t('找不到这个例程'))
    const problem = await this.deps.triggers.fireNow(current.trigger.id)
    if (problem !== undefined) return fail('conflict', problem)
    this.deps.bus.emit({ type: 'routines' })
    return ok(this.get(current.task.id) ?? this.view(current))
  }

  /** 到点了：每次都把要做的事再说一遍（会话可能压缩过），要更新页面的说清怎么更新；没新东西就报 dismissed，不发消息。 */
  wake(trigger: Trigger, task: Task): Wake {
    const lines = [`[例程「${task.title}」]`, trigger.spec.kind === 'page' ? `要关注的：${task.brief}` : task.brief]
    const pageId = text(trigger.state.pageId)
    if (pageId !== '') {
      const page = this.deps.describePage(pageId)
      if (page === undefined || page.deleted) lines.push('（这个例程原来要更新的页面已经删除，这次按普通例程完成，结果写在报告里。）')
      else
        lines.push(
          `这个例程要更新页面「${page.title}」（id：${pageId}，${page.kind}，现在是第 ${page.version} 版）：先用 get_page 读出当前内容，按上面的要求更新数据和文字，再用 save_page 带上这个 id 保存成新的一版，note 写这次更新了什么。`,
        )
    }
    if (trigger.spec.kind !== 'page') lines.push('做完报 ready，摘要只说值得注意的新东西或变化；跟上次比没有新东西就报 dismissed，不发消息。')
    return { note: lines.join('\n') }
  }

  /** 一句话说清什么时候跑：「每天 09:00，更新数据看板「x」」。 */
  describe(routine: Routine): string {
    if (routine.kind === 'watch') return t('每 {minutes} 分钟检查 {url}', { minutes: routine.intervalMinutes, url: routine.url })
    const page = routine.pageId === null ? undefined : this.deps.describePage(routine.pageId)
    const target = page === undefined || page.deleted ? '' : t('，更新{kind}「{title}」', { kind: t(PAGE_KIND_LABELS[page.kind]), title: page.title })
    const when = routine.runAt === null ? describeCron(routine.cron) : t('{time} 跑一次', { time: formatLocal(routine.runAt, routine.timezone) })
    return `${when}${target}`
  }

  /** 下次什么时候跑：「下次 10月26日 11:30」「已暂停」「没有下次了」。 */
  describeNext(routine: Routine): string {
    if (!routine.enabled) return t('已暂停')
    return routine.nextRunAt === null ? t('没有下次了') : t('下次 {time}', { time: formatLocal(routine.nextRunAt, routine.timezone) })
  }
}
