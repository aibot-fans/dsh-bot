import type { PodSession, Task } from 'pod-domain'
import { getMessage } from 'pod-store'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { bool, failure, podTool, str, strList, success, text, texts, flag } from '../tools/define.ts'

function ticketOf(pod: PodRuntime, session: PodSession): Task | undefined {
  return pod.tasks.taskOf(pod.registry.get(session.id) ?? session)
}

/** 确认：直通或转来的消息归这个任务，开始处理。 */
export function ackTool(pod: PodRuntime, session: PodSession): ToolDefinition {
  return podTool({
    name: 'ack',
    description: '确认别处话题里直通进来的消息归这个任务（消息前面标着 [直通消息 id]），然后接着做；任务对话里接着说的（[接着说 id]）不用确认。可以一次确认几条。',
    properties: { message_ids: strList('要确认的消息 id') },
    required: ['message_ids'],
    parse: (args) => {
      const ids = texts(args, 'message_ids')
      return ids.length === 0 ? '要写消息 id' : { ids }
    },
    concurrent: true,
    run: ({ ids }) => {
      const task = ticketOf(pod, session)
      if (task === undefined) return failure('这条会话没有对应的任务')
      const result = pod.intake.ack(task, ids, session.botId)
      return result.ok ? success(`已确认 ${result.value} 条，接着做。`) : failure(result.error.message)
    },
  })
}

/** 交还：这条不归这个任务，回到前台重新判断；每条只能交还一次。 */
export function handbackTool(pod: PodRuntime, session: PodSession): ToolDefinition {
  return podTool({
    name: 'handback',
    description: '送进来的消息（接着说的、直通的、转来的）不归这个任务（另一件事、属于别的任务）时交还，写一句原因，它会回到前台重新判断；每条只能交还一次。整个话题都不归你就设 unfollow，之后那里的消息不再直通给你。',
    properties: {
      message_id: str('要交还的消息 id'),
      reason: str('为什么不归这个任务，一句话'),
      unfollow: bool('同时取消跟进这条所在的话题'),
    },
    required: ['message_id', 'reason'],
    parse: (args) => {
      const messageId = text(args, 'message_id')
      const reason = text(args, 'reason')
      if (messageId === '') return '要写消息 id'
      if (reason === '') return '要写一句原因'
      return { messageId, reason, unfollow: flag(args, 'unfollow') === true }
    },
    run: ({ messageId, reason, unfollow }) => {
      const task = ticketOf(pod, session)
      if (task === undefined) return failure('这条会话没有对应的任务')
      const result = pod.intake.handback(task, messageId, reason, unfollow, session.botId)
      if (!result.ok) return failure(result.error.message)
      const tail = result.value.unfollowed ? '那个话题也不再跟进。' : ''
      return success(`已交还给前台。${tail}这次执行只是为它开的、没有别的要做，就用 report 报 waiting 结束。`)
    },
  })
}

/** 答复：用户在任务里问你（直通或转来的消息里的问题），回在问的那条下面。结果和问题走 report。 */
export function answerTool(pod: PodRuntime, session: PodSession): ToolDefinition {
  return podTool({
    name: 'reply',
    description:
      '答复用户在这个任务里问你的话（直通或转来的消息里的问题，比如进度、某个细节）：回在那条消息下面，第一句就是答案，问什么答什么。结果不用它发，报 ready 时摘要会作为结果发出去；要用户拿主意用 report 的 blocked。',
    properties: { to: str('回哪条消息（消息 id）'), text: str('要说的话') },
    required: ['to', 'text'],
    parse: (args) => (text(args, 'to') === '' || text(args, 'text') === '' ? '要写回哪条消息和要说的话' : { to: text(args, 'to'), body: text(args, 'text') }),
    run: ({ to, body }) => {
      const task = ticketOf(pod, session)
      if (task === undefined) return failure('这条会话没有对应的任务')
      const message = getMessage(pod.db, to)
      if (message === undefined || message.deletedAt !== null) return failure(`找不到消息 ${to}`)
      const asked = task.replyTo.some((target) => target.messageId === message.id) || pod.engine.topics.routes(message.id).some((route) => route.taskId === task.id)
      if (!asked) return failure('这条消息没有交给这个任务；只能答复直通或转给你的消息')
      const messageId = pod.taskReplies.answer(task, session.botId, session.id, message, body)
      return success('已答复，回在那条消息下面。', { messageId })
    },
  })
}
