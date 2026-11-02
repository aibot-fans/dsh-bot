import { formatLocal, parseCron, parseLocalTime, recurring, type PodSession, type Trigger, type TriggerSpec } from 'pod-domain'
import type { JsonSchema, ToolDefinition } from '../dsh.ts'
import { isTicket } from '../engine/index.ts'
import type { PodRuntime } from '../pod.ts'
import { failure, oneOf, podTool, str, success, text } from './define.ts'
import { SCHEDULE_PROPS, readSchedule } from './schedule.ts'

/** 触发器的写法：时间（只一次或重复），或者等某个任务就绪、结束。 */
export const TRIGGER_PROPS: Readonly<Record<string, JsonSchema>> = {
  ...SCHEDULE_PROPS,
  after_task: str('等这个任务（任务 id）就绪再叫醒；和时间只能写一种'),
  on: oneOf('after_task 等到什么时候：ready 就绪（默认）/ ended 结束', ['ready', 'ended']),
}

/** 读工具参数里的触发器：都没写返回 undefined，写错了返回说明。 */
export function readTriggerArgs(pod: PodRuntime, args: Readonly<Record<string, unknown>>): TriggerSpec | string | undefined {
  const now = pod.now()
  const afterTask = text(args, 'after_task')
  const schedule = readSchedule(args, now)
  if (afterTask !== '' && schedule !== undefined) return 'after_task 和时间只能写一种'
  if (afterTask !== '') {
    if (pod.engine.tickets.get(afterTask) === undefined) return `找不到任务 ${afterTask}`
    return { kind: 'task', taskId: afterTask, on: text(args, 'on') === 'ended' ? 'ended' : 'ready' }
  }
  if (schedule === undefined || typeof schedule === 'string') return schedule
  if ('cron' in schedule) {
    const parsed = parseCron(schedule.cron)
    return typeof parsed === 'string' ? parsed : { kind: 'cron', cron: schedule.cron }
  }
  if ('runAt' in schedule) return { kind: 'at', at: schedule.runAt }
  const at = parseLocalTime(schedule.at, pod.settings.get().timezone, now)
  if (typeof at === 'string') return at
  return at > now ? { kind: 'at', at } : '这个时间已经过了'
}

/** 重复的触发器让任务变成常开任务（例程），只一次的是叫醒。 */
export function sourceFor(spec: TriggerSpec, fallback: 'wake' | 'open'): 'routine' | 'wake' | 'open' {
  return recurring(spec) ? 'routine' : fallback
}

/** 给模型看的触发器列表：id、什么时候、下次、开没开。 */
export function triggerLines(pod: PodRuntime, triggers: readonly Trigger[]): readonly Readonly<Record<string, unknown>>[] {
  return triggers.map((trigger) => ({
    id: trigger.id,
    when: pod.triggers.describe(trigger),
    next: trigger.nextAt === null ? null : formatLocal(trigger.nextAt, trigger.timezone),
    enabled: trigger.enabled,
    ...(trigger.note === '' ? {} : { note: trigger.note }),
  }))
}

interface WakeArgs {
  readonly spec: TriggerSpec | undefined
  readonly note: string
  readonly change: string
  readonly cancel: string
}

/** 定时叫醒：任务会话给自己挂触发器，醒来还在这个会话里。 */
export function wakeTool(pod: PodRuntime, session: PodSession): ToolDefinition {
  const current = (): PodSession => pod.registry.get(session.id) ?? session
  return podTool<WakeArgs>({
    name: 'wake_me',
    description: [
      '定时叫醒：给这个任务挂一个触发器，到点（或等的任务就绪）时叫醒你，醒来还在这个会话里接着做，开工说明里写明是哪个触发器。',
      '只要一次：in_minutes、at 或 after_task；要一直重复：time（加 weekdays）、every_minutes 或 cron，任务就成了常开任务，每次做完报 ready（有新东西）或 dismissed（没有），等下次到点。',
      '改已有的写 change、删写 cancel（触发器 id，见返回的列表）。你受阻或失败时不会被叫醒；处理暂停时也不会。',
    ].join(''),
    properties: {
      ...TRIGGER_PROPS,
      note: str('醒来时带给自己的一句话，比如“看服务起来没有”'),
      change: str('要改时间的触发器 id'),
      cancel: str('要删掉的触发器 id'),
    },
    parse: (args) => {
      const spec = readTriggerArgs(pod, args)
      if (typeof spec === 'string') return spec
      const change = text(args, 'change')
      const cancel = text(args, 'cancel')
      if (cancel === '' && spec === undefined && change === '') return '写一种时间（in_minutes、at、time、every_minutes、cron）或 after_task；删掉写 cancel'
      return { spec, note: text(args, 'note'), change, cancel }
    },
    run: ({ spec, note, change, cancel }) => {
      const task = pod.tasks.taskOf(current())
      if (task === undefined || !isTicket(task)) return failure('这个会话不属于工单任务，没法挂触发器')
      const mine = (id: string): boolean => pod.triggers.get(id)?.taskId === task.id
      if (cancel !== '') {
        if (!mine(cancel) || !pod.triggers.close(cancel, session.botId)) return failure(`这个任务上没有触发器 ${cancel}`)
        return success('删掉了。', { triggers: triggerLines(pod, pod.triggers.of(task.id)) })
      }
      if (change !== '') {
        if (!mine(change)) return failure(`这个任务上没有触发器 ${change}`)
        const changed = pod.triggers.change(change, { ...(spec === undefined ? {} : { spec }), ...(note === '' ? {} : { note }) }, session.botId)
        if (typeof changed === 'string') return failure(changed)
        return success('改好了。', { triggers: triggerLines(pod, pod.triggers.of(task.id)) })
      }
      if (spec === undefined) return failure('写一种时间或 after_task')
      const set = pod.triggers.set(task, { spec, note, createdBy: session.botId, state: { source: sourceFor(spec, 'wake') } })
      if (typeof set === 'string') return failure(set)
      const next = set.nextAt === null ? '' : `下次 ${formatLocal(set.nextAt, set.timezone)}。`
      return success(`挂好了：${pod.triggers.describe(set)}。${next}这一轮做完照常汇报（等消息就报 waiting），到点会叫醒你。`, {
        triggers: triggerLines(pod, pod.triggers.of(task.id)),
      })
    },
  })
}
