import type { PodSession } from 'pod-domain'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { failure, podTool, str, strList, success, text, texts } from './define.ts'

/**
 * 群聊里的工具：在群里 @ 成员。只给群聊里的聊天会话。
 * 文字里写 @名字 只是提到，不通知任何人；要别人在群里回答，就用这个工具。
 */
export function groupTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const room = session.roomId === null ? undefined : pod.rooms.get(session.roomId)
  if (room === undefined || room.kind === 'direct') return []
  const current = (): PodSession => pod.registry.get(session.id) ?? session

  const mention = podTool({
    name: 'mention_member',
    description:
      '在当前群聊里 @ 群成员，请他们在群里回答、接着说或帮忙。你的话以你的名义发在群里，被 @ 的成员会收到并在群里回复。' +
      '用户让你“@ 一下某某”“问问某某”“跟某某说”时用它。在文字里写 @名字 不会通知任何人；只能 @ 这个群里的成员，群外的 bot 用 ask_bot 私下问。' +
      '点名是你这一轮的最后一步：调用以后这一轮就结束了，想对用户说的话放在调用之前说，不用再补一句“已经 @ 了”。' +
      '被别的成员 @ 时直接回复就行，不要 @ 回去应声。',
    properties: { members: strList('要 @ 的群成员的名字，一个或几个'), message: str('要对他们说的话，写清楚想让对方做什么；不用再写 @名字') },
    required: ['members', 'message'],
    parse: (args) => {
      const members = texts(args, 'members')
      if (members.length === 0) return '要写明 @ 谁'
      const message = text(args, 'message')
      return message === '' ? '要写明想对他们说什么' : { members, message }
    },
    run: async ({ members, message }, exec) => {
      const result = await pod.rooms.mentionFromBot(current(), members, message)
      if (!result.ok) return failure(result.error.message)
      // 点完名这一轮就结束：话头交给了被 @ 的成员，不再补一句“已经 @ 了”。
      exec.concludeTurn()
      const { called, skipped } = result.value
      const note = skipped.length === 0 ? '' : `${skipped.join('、')}刚 @ 了你，看得到你的回复，没有再 @ 它。`
      return success(`已经在群里 @ 了${called.join('、')}，他们会在群里回答。${note}这一轮到这里结束。`)
    },
  })

  return [mention]
}
