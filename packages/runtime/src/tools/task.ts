import { WAIT_KINDS, t, type PodSession, type WaitKind } from 'pod-domain'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { bool, failure, intList, oneOf, podTool, str, strList, success, text, texts, ints, flag } from './define.ts'

/** 任务会话的工具：勾验收项、写进度说明、提交结果、找用户。 */
export function taskTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const current = (): PodSession => pod.registry.get(session.id) ?? session

  const update = podTool({
    name: 'update_task',
    description: '每完成一条验收项就勾上（编号从 1 开始），顺手写一句进度说明；很久没进展时也写一句现在在做什么。这些会实时显示在任务卡上。',
    properties: {
      check: intList('刚完成的验收项编号，从 1 开始'),
      note: str('一句进度说明，例如“国内版价格页已读完，正在找年付折扣”'),
    },
    parse: (args) => ({ check: ints(args, 'check'), note: text(args, 'note') }),
    run: ({ check, note }) => {
      if (check.length === 0 && note === '') return failure('至少勾一条验收项或写一句进度说明')
      const result = pod.tasks.progress(current(), check, note)
      if (!result.ok) return failure(result.error.message)
      const done = result.value.acceptance.filter((item) => item.done).length
      return success(`已更新：验收项 ${done}/${result.value.acceptance.length}`)
    },
  })

  const complete = podTool({
    name: 'complete_task',
    description: '全部做完后提交结果：摘要、产出文件路径，以及交付卡上的“前提和待确认”（做了哪些假设、哪些信息没核实、跳过了什么）。只写摘要和路径，不要把长内容塞进来。提交后这一轮结束。',
    properties: {
      summary: str('结果摘要：要点几条，简洁具体'),
      files: strList('产出文件的路径（相对工作区或绝对路径）'),
      assumptions: strList('你做了哪些假设'),
      unverified: strList('哪些信息没核实'),
      skipped: strList('跳过了什么、为什么'),
      lessons: str('这次学到的做法或教训（可选，会写进你的经验）'),
    },
    required: ['summary'],
    parse: (args) => {
      const summary = text(args, 'summary')
      if (summary === '') return '摘要不能为空'
      return {
        summary,
        files: texts(args, 'files'),
        assumptions: texts(args, 'assumptions'),
        unverified: texts(args, 'unverified'),
        skipped: texts(args, 'skipped'),
        lessons: text(args, 'lessons'),
      }
    },
    run: ({ lessons, ...result }, exec) => {
      const completed = pod.tasks.complete(current(), result)
      if (!completed.ok) return failure(completed.error.message)
      if (lessons !== '') pod.learnFromTask(current(), completed.value, lessons)
      exec.concludeTurn()
      return success('已提交。', { status: completed.value.status })
    },
  })

  const askOwner = askOwnerTool(pod, session)

  return [update, complete, askOwner]
}

/** 找用户：任务会话和组长的协调会话都能用。 */
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
