import { TASK_STATUS_LABELS, type PodSession } from 'pod-domain'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { failure, podTool, str, success, text } from './define.ts'

/** 所在的根任务：任务会话找父任务，协调会话就是根任务本身。 */
function rootIdOf(pod: PodRuntime, session: PodSession): string | undefined {
  if (session.taskId === null) return undefined
  return pod.tasks.get(session.taskId)?.rootId
}

/** 成员之间的协作工具：异步咨询、查看成员实时状态、查看任务板。全部记录在案，没有私下通道。 */
export function teamTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const current = (): PodSession => pod.registry.get(session.id) ?? session

  const askBot = podTool({
    name: 'ask_bot',
    description:
      '向另一个 bot 私下异步咨询：问题投进对方的咨询会话，你不用停下手上的工作，答复只送回给你。不能嵌套；不要什么事都问组长，先看角色卡判断该问谁。' +
      '在群聊里要群成员当着大家回答（比如用户让你 @ 某人），用 mention_member，不用这个。',
    properties: { bot: str('问谁：名字或 id'), question: str('问题，写清背景') },
    required: ['bot', 'question'],
    parse: (args) => (text(args, 'question') === '' ? '问题不能为空' : { bot: text(args, 'bot'), question: text(args, 'question') }),
    run: async ({ bot, question }) => {
      const result = await pod.consults.ask(current(), bot, question)
      return result.ok ? success('已经问了，答复到了会送回给你。先继续做别的。') : failure(result.error.message)
    },
  })

  const status = podTool({
    name: 'team_status',
    description: '查看同一个任务里各成员现在在做什么（第几步、最近动作）。',
    properties: {},
    concurrent: true,
    parse: () => ({}),
    run: () => {
      const rootId = rootIdOf(pod, current())
      if (rootId === undefined) return failure('这条会话不在团队任务里')
      const lines = pod.tasks
        .tree(rootId)
        .filter((task) => task.parentId !== null)
        .map((task) => {
          const session = pod.registry.activeForTask(task.id, 'task')
          const activity = session === undefined ? undefined : pod.observer.activityOf(session.id)
          const doing = activity === undefined ? '' : ` · 第 ${activity.steps} 步${activity.current === null ? '' : `：${activity.current}`}`
          return `- 「${task.title}」${pod.coordinator.nameOf(task.ownerBotId)} · ${TASK_STATUS_LABELS[task.status]}${doing}`
        })
      return success(lines.join('\n'))
    },
  })

  const board = podTool({
    name: 'task_board',
    description: '查看所在任务的任务板（只读）：子任务、负责人、状态、验收项进度和依赖。',
    properties: {},
    concurrent: true,
    parse: () => ({}),
    run: () => {
      const rootId = rootIdOf(pod, current())
      return rootId === undefined ? failure('这条会话不在团队任务里') : success(pod.coordinator.board(rootId))
    },
  })

  return session.kind === 'task' ? [askBot, status, board] : [askBot]
}
