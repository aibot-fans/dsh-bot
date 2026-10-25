import { PRIORITY, acceptanceProgress, type PodSession, type Task } from 'pod-domain'
import type { AgentRegistry } from '../dsh.ts'
import type { Dispatcher } from './dispatcher.ts'
import { noticeSource } from './messages.ts'
import type { SessionObserver } from './observer.ts'
import type { SessionRegistry } from './registry.ts'

/** 模型流多久没动静算卡死：dsh 里模型流卡死时回合不会自己结束。 */
const STREAM_STUCK_MS = 3 * 60_000

/** 工具调用多久没结束算可疑（shell 跑长命令是正常的，只标出来，不打断）。 */
const TOOL_STUCK_MS = 30 * 60_000

/** 步数涨了这么多却没有新的验收项、没有新的进度说明，标“可能在绕圈”。 */
const STALL_STEPS = 25

/** 同一个工具、同样的参数连续调用几次算重复。 */
const REPEAT_LIMIT = 3

interface TaskProgress {
  readonly fingerprint: string
  readonly steps: number
  readonly warned: boolean
}

export interface WatchdogDeps {
  readonly registry: SessionRegistry
  readonly observer: SessionObserver
  readonly dispatcher: Dispatcher
  readonly agents: AgentRegistry
  readonly task: (taskId: string) => Task | undefined
  readonly now: () => number
  /** 标出停滞或卡死时通知派活的人和你。 */
  readonly onStall: (session: PodSession, task: Task | undefined, reason: string) => void
}

function fingerprint(task: Task): string {
  return `${acceptanceProgress(task.acceptance).done}|${task.note}|${task.status}`
}

/**
 * 看门狗和绕圈检测：
 * - 一步长时间没有任何事件：先取消并重试一次；还卡住就标出来交给派活的人。
 * - 步数一直在涨却没有新进展：标“可能在绕圈”，提醒它换做法，并提醒你一次。不打断任务。
 * - 反复调用同一个工具、同样的参数：提醒它换做法。
 */
export class Watchdog {
  private readonly retried = new Set<string>()
  private readonly progress = new Map<string, TaskProgress>()
  private readonly recentCalls = new Map<string, readonly string[]>()
  private readonly deps: WatchdogDeps

  constructor(deps: WatchdogDeps) {
    this.deps = deps
  }

  /** 每 30 秒跑一次。 */
  tick(): void {
    const now = this.deps.now()
    for (const session of this.deps.registry.active()) {
      const activity = this.deps.observer.activityOf(session.id)
      if (activity === undefined || !activity.running || activity.lastEventAt === null) continue
      const silent = now - activity.lastEventAt
      if (activity.current !== null) {
        if (silent > TOOL_STUCK_MS && !activity.stalled) {
          this.deps.observer.markStalled(session.id, true)
          this.deps.onStall(session, this.taskOf(session), `工具「${activity.current}」已经 ${Math.round(silent / 60_000)} 分钟没有结束`)
        }
        continue
      }
      if (silent <= STREAM_STUCK_MS) continue
      const key = `${session.id}:${activity.turn}`
      if (this.retried.has(key)) {
        if (!activity.stalled) {
          this.deps.observer.markStalled(session.id, true)
          this.deps.onStall(session, this.taskOf(session), '模型长时间没有响应，重试后还是卡住')
        }
        continue
      }
      this.retried.add(key)
      this.retry(session)
    }
  }

  private taskOf(session: PodSession): Task | undefined {
    return session.taskId === null ? undefined : this.deps.task(session.taskId)
  }

  /** 取消卡住的这一步（保留待处理的消息），再投一条继续的提醒。 */
  private retry(session: PodSession): void {
    const agent = this.deps.agents.get(session.id)
    if (agent === undefined) return
    agent.cancel({ kind: 'hook', reason: 'pod: watchdog' }, { keepInbox: true })
    this.deps.dispatcher.enqueue({
      sessionId: session.id,
      mode: 'followup',
      priority: PRIORITY.task,
      text: '[Pod] 上一步长时间没有响应，已经重试。请从上一步接着做。',
      source: noticeSource('上一步长时间没有响应，已重试'),
    })
  }

  /** 每走一步检查一次任务有没有新进展。 */
  onStep(session: PodSession, steps: number): void {
    const task = this.taskOf(session)
    if (task === undefined || session.kind !== 'task' || task.status !== 'running') return
    const current = fingerprint(task)
    const previous = this.progress.get(task.id)
    if (previous === undefined || previous.fingerprint !== current) {
      this.progress.set(task.id, { fingerprint: current, steps, warned: false })
      if (previous !== undefined && previous.warned) this.deps.observer.markStalled(session.id, false)
      return
    }
    if (previous.warned || steps - previous.steps < STALL_STEPS) return
    this.progress.set(task.id, { ...previous, warned: true })
    this.deps.observer.markStalled(session.id, true)
    this.deps.dispatcher.enqueue({
      sessionId: session.id,
      mode: 'inject',
      priority: PRIORITY.task,
      text: `[Pod 提醒] 你已经做了 ${steps - previous.steps} 步，但没有勾新的验收项，也没有写新的进度说明，可能在绕圈。换个做法；确实卡住就用 ask_owner 说明，能绕过的先绕过。`,
      source: noticeSource('可能在绕圈，提醒换做法'),
    })
    this.deps.onStall(session, task, `已经 ${steps - previous.steps} 步没有新进展，可能在绕圈`)
  }

  /** 反复调用同一个工具、同样的参数时提醒一次。 */
  onToolCall(session: PodSession, name: string, args: string): void {
    const signature = `${name}:${args}`
    const recent = [...(this.recentCalls.get(session.id) ?? []), signature].slice(-REPEAT_LIMIT)
    this.recentCalls.set(session.id, recent)
    if (recent.length < REPEAT_LIMIT || recent.some((item) => item !== signature)) return
    this.recentCalls.set(session.id, [])
    this.deps.dispatcher.enqueue({
      sessionId: session.id,
      mode: 'inject',
      priority: PRIORITY.task,
      text: `[Pod 提醒] 你已经连续 ${REPEAT_LIMIT} 次用同样的参数调用 ${name}，结果不会变。换个做法。`,
      source: noticeSource(`重复调用 ${name}，提醒换做法`),
    })
  }

  forget(sessionId: string): void {
    this.recentCalls.delete(sessionId)
  }
}
