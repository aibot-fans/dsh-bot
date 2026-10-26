import { PRIORITY, type PodSession } from 'pod-domain'
import { relaySource } from '../agents/messages.ts'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { bool, failure, podTool, str, strList, success, text, texts, flag } from './define.ts'

/** 组长协调会话的工具：看任务板、验收、改计划、改派、发说明、交付、要人。 */
export function coordTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const current = (): PodSession => pod.registry.get(session.id) ?? session
  const root = () => pod.coordinator.rootFor(current())

  const board = podTool({
    name: 'task_board',
    description: '查看任务板：每个子任务的负责人、状态、验收项进度和依赖。',
    properties: {},
    concurrent: true,
    parse: () => ({}),
    run: () => {
      const task = root()
      return task === undefined ? failure('这条会话不是协调会话') : success(pod.coordinator.board(task.id))
    },
  })

  const review = podTool({
    name: 'review_task',
    description: '验收一个已提交的子任务：通过（下游自动开工），或者打回（写清哪一条没达到、要怎么改）。研究类结论先抽查出处再通过。',
    properties: {
      subtask: str('子任务编号（计划里的 s1、s2……）或任务 id'),
      pass: bool('是否通过'),
      feedback: str('打回时必填：哪一条没达到、要怎么改'),
    },
    required: ['subtask', 'pass'],
    parse: (args) => ({ key: text(args, 'subtask'), pass: flag(args, 'pass') === true, feedback: text(args, 'feedback') }),
    run: async ({ key, pass, feedback }) => {
      const result = await pod.coordinator.review(current(), key, pass, feedback)
      return result.ok ? success(result.value.hint, { status: result.value.task.status }) : failure(result.error.message)
    },
  })

  const revise = podTool({
    name: 'revise_plan',
    description: [
      '出新版计划：新增、取消、修改或重做子任务。用户纠正前提时，用 assumption_changes 改那条前提，dsh-bot 只重做依赖它的子任务及下游；已完成且不受影响的保留。',
      'add 里每个新子任务写 id、title、brief、kind、deliverable、acceptance、dependsOn、owner，和 create_task 的子任务格式一样。',
    ].join(''),
    properties: {
      reason: str('为什么改，例如“你纠正了前提：只看中国区”'),
      assumption_changes: { type: 'array', items: { type: 'object', properties: { id: str('前提 id'), text: str('新的前提') } }, description: '改动的前提' },
      redo: strList('要重做的子任务编号'),
      drop: strList('取消的子任务编号'),
      add: { type: 'array', items: { type: 'object' }, description: '新增的子任务' },
      modify: { type: 'array', items: { type: 'object', properties: { subtask: str('子任务编号'), brief: str('新的说明'), acceptance: strList('新的验收项') } }, description: '修改说明或验收项' },
    },
    required: ['reason'],
    parse: (args) => {
      const changes = Array.isArray(args.assumption_changes) ? args.assumption_changes : []
      const modify = Array.isArray(args.modify) ? args.modify : []
      return {
        reason: text(args, 'reason'),
        assumptionChanges: changes
          .filter((item): item is Readonly<Record<string, unknown>> => typeof item === 'object' && item !== null)
          .map((item) => ({ id: text(item, 'id'), text: text(item, 'text') }))
          .filter((item) => item.id !== '' && item.text !== ''),
        redo: texts(args, 'redo'),
        drop: texts(args, 'drop'),
        add: Array.isArray(args.add) ? args.add : [],
        modify: modify
          .filter((item): item is Readonly<Record<string, unknown>> => typeof item === 'object' && item !== null)
          .map((item) => {
            const acceptance = texts(item, 'acceptance')
            const brief = text(item, 'brief')
            return { key: text(item, 'subtask'), ...(brief === '' ? {} : { brief }), ...(acceptance.length === 0 ? {} : { acceptance }) }
          })
          .filter((item) => item.key !== ''),
      }
    },
    run: async (input) => {
      const result = await pod.coordinator.revise(current(), input)
      return result.ok ? success(`已出第 ${result.value.version} 版计划，记录里写明了改动。`, { version: result.value.version }) : failure(result.error.message)
    },
  })

  const reassign = podTool({
    name: 'reassign_task',
    description: '把一个子任务改派给另一个 bot：原负责人的会话停下，新负责人带着交接说明（进度、已完成的验收项、文件位置）重新开工。',
    properties: { subtask: str('子任务编号'), bot: str('新负责人的名字或 id'), note: str('给新负责人的说明') },
    required: ['subtask', 'bot'],
    parse: (args) => ({ key: text(args, 'subtask'), bot: text(args, 'bot'), note: text(args, 'note') }),
    run: async ({ key, bot, note }) => {
      const result = await pod.coordinator.reassign(current(), key, bot, note)
      return result.ok ? success(`已改派给 ${pod.coordinator.nameOf(result.value.ownerBotId)}。`) : failure(result.error.message)
    },
  })

  const post = podTool({
    name: 'post_message',
    description: '在任务的群聊里发一条消息：结论、阶段性说明、评审总结。不要用来闲聊或刷进度，进度会自动显示在任务卡上。',
    properties: { text: str('消息正文，支持 Markdown') },
    required: ['text'],
    parse: (args) => (text(args, 'text') === '' ? '消息不能为空' : { body: text(args, 'text') }),
    run: ({ body }) => {
      const task = root()
      if (task === undefined || task.roomId === null) return failure('这条会话没有对应的群聊')
      pod.rooms.post(task.roomId, { author: current().botId, kind: 'text', body, sessionId: current().id })
      return success('已发到群聊。')
    },
  })

  const deliver = podTool({
    name: 'deliver_task',
    description: '全部子任务通过、结果合并好以后交付：最终产物放进 shared/，写要点、文件，以及“前提和待确认”（做了哪些假设、哪些没核实、跳过了什么）。交付就是完成，不需要用户点验收。',
    properties: {
      summary: str('交付要点，几条，简洁具体'),
      files: strList('最终产物的路径'),
      assumptions: strList('做了哪些假设'),
      unverified: strList('哪些信息没核实'),
      skipped: strList('跳过了什么'),
    },
    required: ['summary'],
    parse: (args) =>
      text(args, 'summary') === ''
        ? '交付要点不能为空'
        : {
            summary: text(args, 'summary'),
            files: texts(args, 'files'),
            assumptions: texts(args, 'assumptions'),
            unverified: texts(args, 'unverified'),
            skipped: texts(args, 'skipped'),
          },
    run: (result, exec) => {
      const delivered = pod.coordinator.deliver(current(), result)
      if (!delivered.ok) return failure(delivered.error.message)
      exec.concludeTurn()
      return success('已交付，任务卡变成了交付卡。')
    },
  })

  const requestStaff = podTool({
    name: 'request_staff',
    description: '人手不够时向主管要人：说明需要什么能力、做哪个子任务。主管会新建或调配 bot，之后你用 reassign_task 派给它。',
    properties: { need: str('需要什么样的人、做什么') },
    required: ['need'],
    parse: (args) => (text(args, 'need') === '' ? '要写清需要什么样的人' : { need: text(args, 'need') }),
    run: ({ need }) => {
      const task = root()
      if (task === undefined || task.requesterSession === null) return failure('找不到可以要人的主管会话')
      pod.dispatcher.enqueue({
        sessionId: task.requesterSession,
        mode: 'followup',
        priority: PRIORITY.task,
        text: `[组长要人] 任务「${task.title}」的组长说：${need}\n可以用 create_bot 新建，或从现有 bot 里挑一个，告诉组长名字。`,
        source: relaySource(current().id),
      })
      return success('已经告诉主管。')
    },
  })

  return [board, review, revise, reassign, post, deliver, requestStaff]
}
