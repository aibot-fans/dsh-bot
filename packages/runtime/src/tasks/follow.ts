import type { PodSession, Task } from 'pod-domain'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { failure, podTool, str, success, text } from '../tools/define.ts'

function ticketOf(pod: PodRuntime, session: PodSession): Task | undefined {
  return pod.tasks.taskOf(pod.registry.get(session.id) ?? session)
}

/** 只读跟进另一个话题：那里的新消息下次开工时带上，只看不接、不叫醒你。 */
export function followTool(pod: PodRuntime, session: PodSession): ToolDefinition {
  return podTool({
    name: 'follow',
    description: '只读跟进另一个话题：给一条消息的 id（跟进它所在的回复串），或者另一个任务的 id（跟进它的任务卡和来由）。那里的新消息下次开工时带给你，只看不接，不会叫醒你。',
    properties: {
      message_id: str('那个话题里任意一条消息的 id'),
      task_id: str('另一个任务的 id'),
    },
    parse: (args) => {
      const messageId = text(args, 'message_id')
      const taskId = text(args, 'task_id')
      return messageId === '' && taskId === '' ? '写消息 id 或任务 id' : { messageId, taskId }
    },
    run: ({ messageId, taskId }) => {
      const task = ticketOf(pod, session)
      if (task === undefined) return failure('这条会话没有对应的任务')
      const topics = pod.engine.topics
      if (messageId !== '') {
        const topic = topics.followMessage(task.id, messageId, 'readonly')
        return topic === undefined ? failure('找不到这条消息') : success('已只读跟进这个话题。')
      }
      const other = pod.tasks.get(taskId)
      if (other === undefined || other.id === task.id) return failure('找不到这个任务')
      const own = topics.follows(other.id).filter((follow) => follow.kind !== 'readonly')
      if (own.length === 0) return failure('这个任务还没有话题可以跟进')
      for (const follow of own) topics.follow(task.id, follow.topicId, 'readonly')
      return success(`已只读跟进「${other.title}」的话题。`)
    },
  })
}

/** 取消跟进：某个话题的消息不再直通给这个任务。 */
export function unfollowTool(pod: PodRuntime, session: PodSession): ToolDefinition {
  return podTool({
    name: 'unfollow',
    description: '取消跟进一条消息所在的话题：之后那里的消息不再送给这个任务。',
    properties: { message_id: str('那个话题里任意一条消息的 id') },
    required: ['message_id'],
    parse: (args) => {
      const messageId = text(args, 'message_id')
      return messageId === '' ? '要写消息 id' : { messageId }
    },
    run: ({ messageId }) => {
      const task = ticketOf(pod, session)
      if (task === undefined) return failure('这条会话没有对应的任务')
      const topic = pod.engine.topics.topicOf(messageId)
      if (topic === undefined) return failure('这条消息不在任何话题里')
      return pod.engine.topics.unfollow(task.id, topic.id) ? success('已取消跟进。') : failure('这个任务没有跟进这个话题')
    },
  })
}
