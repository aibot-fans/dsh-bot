import { WAIT_KINDS, t, type PodSession, type WaitKind } from 'pod-domain'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { isTicket } from '../engine/index.ts'
import { ackTool, handbackTool } from '../tasks/ack.ts'
import { followTool, unfollowTool } from '../tasks/follow.ts'
import { reportTool } from '../tasks/report.ts'
import { subtaskTools } from '../tasks/subtask-tools.ts'
import { bool, oneOf, podTool, str, success, text, flag } from './define.ts'

/**
 * 任务会话的工具：汇报（进展、等消息、就绪、受阻、失败、无需处理）；工单还能确认、交还直通进来的消息，
 * 跟进、取消跟进话题；根任务的会话还能开子任务、验收（组长）。
 */
export function taskTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const task = pod.tasks.taskOf(session)
  if (task === undefined || !isTicket(task)) return [reportTool(pod, session)]
  const base = [reportTool(pod, session), ackTool(pod, session), handbackTool(pod, session), followTool(pod, session), unfollowTool(pod, session)]
  return task.parentId === null ? [...base, ...subtaskTools(pod, session)] : base
}

/** 找用户：组长的协调会话用（任务会话改用 report 的 blocked）。 */
export function askOwnerTool(pod: PodRuntime, session: PodSession): ToolDefinition {
  const current = (): PodSession => pod.registry.get(session.id) ?? session
  return podTool({
    name: 'ask_owner',
    description: [
      '只在四种必须用户出面的情况下找用户：login 需要登录/验证码/两步验证；write 要做不可撤回的对外操作；security 被安全规则拦下；ambiguity 会让结果方向完全不同、又没有合理默认值的歧义。',
      '能绕过的先绕过（比如换数据来源），设 bypassed=true 并写明怎么绕过的，然后继续做其余部分；绕不过才让任务等用户。用户的答复会转回给你。',
    ].join(''),
    properties: {
      kind: oneOf('login / write / security / ambiguity', ['login', 'write', 'security', 'ambiguity']),
      question: str('要用户处理的事，一句话说清'),
      detail: str('背景和选项；歧义要列出几种可能和你倾向的默认'),
      bypassed: bool('是否已经先绕过去继续做了'),
      how_bypassed: str('怎么绕过的，例如“先用了第三方报价”'),
    },
    required: ['kind', 'question'],
    parse: (args) => {
      const kind = text(args, 'kind')
      if (!(WAIT_KINDS as readonly string[]).includes(kind)) return 'kind 只能是 login、write、security、ambiguity'
      const question = text(args, 'question')
      if (question === '') return '要写清找用户做什么'
      return {
        kind: kind as WaitKind,
        question,
        detail: [text(args, 'detail'), text(args, 'how_bypassed') === '' ? '' : t('已先绕过：{how}', { how: text(args, 'how_bypassed') })].filter(Boolean).join('\n'),
        bypassed: flag(args, 'bypassed') === true,
      }
    },
    run: ({ kind, question, detail, bypassed }) => {
      const wait = pod.waits.ask({ session: current(), kind, title: question, detail, bypassed })
      return success(
        bypassed
          ? '已记下，交付时会列进“前提和待确认”。继续做其余部分。'
          : '已经交给用户处理。先做不依赖这件事的部分；都做不了就结束这一轮，用户处理后答复会转给你。',
        { waitId: wait.id },
      )
    },
  })
}
