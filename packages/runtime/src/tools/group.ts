import type { PodSession } from 'pod-domain'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { failure, podTool, str, strList, success, text, texts } from './define.ts'

/**
 * 群聊里的工具：在群里 @ 成员，只给前台。前台跨聊天室，要写明在哪个群。
 * 文字里写 @名字 只是提到，不通知任何人；要别人当众答一句，就用这个工具。
 */
export function groupTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const current = (): PodSession => pod.registry.get(session.id) ?? session

  const mention = podTool({
    name: 'mention_member',
    description:
      '在群里 @ 群成员，请他们当众答一句、接着说。你的话以你的名义发在群里，被 @ 的成员会收到并在群里回复。' +
      '用户让你“@ 一下某某”“问问某某”“跟某某说”时用它；要别人干活用 dispatch 开任务。在文字里写 @名字 不会通知任何人；只能 @ 那个群里的成员。' +
      '被别的成员 @ 时直接用 reply 回就行，不要 @ 回去应声。',
    properties: {
      room: str('哪个群（room id）'),
      members: strList('要 @ 的群成员的名字，一个或几个'),
      message: str('要对他们说的话，写清楚想让对方做什么；不用再写 @名字'),
    },
    required: ['room', 'members', 'message'],
    parse: (args) => {
      const members = texts(args, 'members')
      if (members.length === 0) return '要写明 @ 谁'
      const message = text(args, 'message')
      if (message === '') return '要写明想对他们说什么'
      const room = text(args, 'room')
      return room === '' ? '要写明在哪个群（room id）' : { room, members, message }
    },
    run: async ({ room, members, message }) => {
      const result = await pod.rooms.mentionFromBot(current(), room, members, message)
      if (!result.ok) return failure(result.error.message)
      const { called, skipped } = result.value
      const note = skipped.length === 0 ? '' : `${skipped.join('、')}刚 @ 了你，看得到你的回复，没有再 @ 它。`
      return success(`已经在群里 @ 了${called.join('、')}，他们会在群里回答。${note}`)
    },
  })

  return [mention]
}
