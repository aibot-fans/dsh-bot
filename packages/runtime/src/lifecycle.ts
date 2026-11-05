import { PRIORITY, t, type PodSession } from 'pod-domain'
import { sessionsWithPending } from 'pod-store'
import { noticeSource } from './agents/messages.ts'
import { isTicket } from './engine/index.ts'
import type { PreStepDecision } from './dsh.ts'
import type { PodRuntime } from './pod.ts'

/**
 * 重启后恢复：dsh web 停掉时正在跑的任务会话不会自己醒，这里按任务状态补一条“接着做”。
 * 组长那边有待验收的子任务时，也提醒它看一下任务板。已经有待投消息的会话不重复提醒。
 */
export function recoverAfterRestart(pod: PodRuntime): void {
  const pending = new Set(sessionsWithPending(pod.db))
  const remind = (session: PodSession, text: string, summary: string): void => {
    pod.dispatcher.enqueue({ sessionId: session.id, mode: 'followup', priority: PRIORITY.task, text, source: noticeSource(summary) })
  }
  for (const session of pod.registry.active()) {
    if (pending.has(session.id) || pod.dispatcher.isRunning(session.id) || session.taskId === null) continue
    const task = pod.tasks.get(session.taskId)
    // 工单在启动时由引擎恢复（各开一次新的执行），这里只管团队任务。
    if (task === undefined || isTicket(task)) continue
    if (session.kind === 'task' && task.status === 'running') {
      remind(
        session,
        '[dsh-bot] dsh web 重启过，这个任务的上一轮被中断了，在后台跑的命令也跟着停了。看一下任务文件夹里已有的产出，从停下的地方接着做，没跑完的命令要用就重跑；做完用 report 汇报。',
        t('dsh 重启后接着做'),
      )
    }
    if (session.kind === 'coord' && task.status === 'running' && pod.tasks.tree(task.id).some((child) => child.status === 'review')) {
      remind(session, `[dsh-bot] dsh web 重启过。有子任务在等你验收，看一下任务板再处理：\n${pod.coordinator.board(task.id)}`, t('dsh 重启后提醒验收'))
    }
  }
}

function every(ms: number, work: () => void): ReturnType<typeof setInterval> {
  const timer = setInterval(work, ms)
  timer.unref()
  return timer
}

function later(ms: number, work: () => void): ReturnType<typeof setTimeout> {
  const timer = setTimeout(work, ms)
  timer.unref()
  return timer
}

/**
 * 插件启动后的常驻工作：观察会话、安装工具、拦暂停的任务、补投消息，以及各种定时器
 * （调度和看门狗、例程和简报、记忆提取、复盘、本周变化、空闲标签页）。返回停止函数。
 */
export function startRuntime(pod: PodRuntime): () => void {
  const { ctx } = pod
  const warn = (label: string) => (error: unknown) => ctx.logger.warn(label, error)
  const stopBinder = pod.binder.start()
  const stopObserver = pod.observer.start()
  const stopPreStep = ctx.on('agent/pre-step', async (payload, next): Promise<PreStepDecision> => {
    if (pod.tasks.shouldBlockStep(payload.agent.session.id)) return { kind: 'reject' }
    return next()
  })
  pod.rooms.ensureLeadRoom()
  // 以前的正式团队转成普通群；以前建的群补组长：没点名的话先给它，群里留一行。
  pod.adoptTeams()
  pod.rooms.groups.assignLeaders()
  const stopAibot = pod.aibot.start()
  pod.seeds.sync()
  // 上次没交出的接着交，交了没收进历史的查过再重交；没结束的执行记成被打断、各开一次新的；然后副作用队列开始干活。
  pod.dispatcher.recover()
  pod.engine.tickets.refreshOpen()
  pod.engine.tickets.settleReviews()
  pod.engine.runs.recoverInterrupted()
  pod.launcher.recover()
  pod.front.start()
  pod.effects.start()
  // 旧的例程换成挂触发器的常开任务；每日简报按设置建好它的常开任务。
  pod.migrateRoutines()
  pod.brief.ensure()
  // 上次 dsh web 退出时正在执行的浏览器写操作和 X 写操作：标为状态未知，先问你。
  pod.browser.approvals.markUnknown()
  pod.x.writes.markUnknown()
  const timeouts = [
    later(20_000, () => recoverAfterRestart(pod)),
    // 停机期间错过的触发器只补最近一次。
    later(30_000, () => void pod.triggers.tick().catch(warn('触发器出错'))),
  ]
  const intervals = [
    every(30_000, () => {
      void pod.dispatcher.pump()
      pod.watchdog.tick()
      // 看门狗定时巡查进行中的任务；处理暂停时不巡查。
      if (!pod.settings.get().paused) pod.judge.review()
    }),
    every(30_000, () => {
      pod.evolutionKit.evolution.weeklyTick()
      void pod.triggers.tick().catch(warn('触发器出错'))
      const busy = pod.registry.active().some((session) => session.taskId !== null && pod.dispatcher.isRunning(session.id))
      pod.sleep.set(pod.settings.get().preventSleep && busy)
    }),
    every(5 * 60_000, () => void pod.extractor.tick().catch(warn('记忆提取出错'))),
    every(60_000, () => pod.refreshExposure()),
    every(5 * 60_000, () => void pod.evolutionKit.retro.tick().catch(warn('复盘出错'))),
    every(60_000, () => void pod.browser.browser.sweep().catch(warn('关闭空闲标签页出错'))),
    // 占着电脑太久没动静的任务，结束它在小助手里的会话。
    every(60_000, () => pod.computer.tick()),
  ]
  const stopIndexing = pod.bus.subscribe((envelope) => {
    if (envelope.event.type !== 'task') return
    pod.indexTaskTree(envelope.event.rootId)
    // 给其他插件：任务变了（ctx.pod 对外接口）。
    ctx.emit?.('pod/task-updated', { taskId: envelope.event.taskId, rootId: envelope.event.rootId })
  })
  void pod.searchIndex
    .count()
    .then((count) => (count === 0 ? pod.search.rebuild() : 0))
    .catch(warn('重建搜索索引失败'))
  return () => {
    pod.effects.stop()
    pod.dispatcher.stop()
    pod.turns.dispose()
    pod.front.dispose()
    for (const timer of timeouts) clearTimeout(timer)
    for (const timer of intervals) clearInterval(timer)
    pod.sleep.stop()
    stopIndexing()
    stopAibot()
    void pod.searchIndex.stop()
    void pod.browser.browser.dispose()
    void pod.computer.dispose().catch(warn('让用电脑的小助手退出时出错'))
    stopPreStep()
    stopObserver()
    stopBinder()
    pod.clearActivityTimers()
  }
}
