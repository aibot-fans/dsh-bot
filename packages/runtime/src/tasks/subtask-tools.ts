import type { PodSession } from 'pod-domain'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { bool, failure, podTool, str, strList, success, text, texts, flag } from '../tools/define.ts'
import { MAX_REWORKS } from './subtasks.ts'

/** 开子任务时验收项最多几条。 */
const ACCEPTANCE_MAX = 5

/**
 * 组长的工具（根任务的任务会话）：开子任务、验收、给子任务补一句话、停掉、列出子任务。
 * 子任务的汇报 dsh-bot 会送给你，不用盯着。
 */
export function subtaskTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const current = (): PodSession => pod.registry.get(session.id) ?? session

  const open = podTool({
    name: 'subtask',
    description: [
      '把一部分活派出去：开一个子任务交给某个 bot（也可以写“自己”），它在自己的会话和文件夹里做，跟别的子任务同时跑；',
      '群里会显示成你 @ 它说要做什么，不在群里的 bot 会拉进群。写标题、说明（要做什么、交什么、放哪）和 1–5 条验收项；',
      '要等另一个子任务就绪再开工，after 写那个子任务的 id。开完立刻返回，子任务的汇报会送给你；都开好了就报 waiting 结束这一轮。',
    ].join(''),
    properties: {
      title: str('子任务标题，简短'),
      bot: str('交给谁：名字或 id，交给自己写“自己”'),
      brief: str('要做什么、交什么、放在哪；用户的原话 dsh-bot 会带上'),
      acceptance: strList(`验收项，1–${ACCEPTANCE_MAX} 条，就绪时它逐条勾`),
      after: str('等这个子任务（id）就绪再开工，可选'),
    },
    required: ['title', 'bot', 'brief', 'acceptance'],
    parse: (args) => {
      const title = text(args, 'title')
      const acceptance = texts(args, 'acceptance')
      if (title === '') return '要写标题'
      if (text(args, 'brief') === '') return '要写说明'
      if (acceptance.length === 0 || acceptance.length > ACCEPTANCE_MAX) return `验收项写 1–${ACCEPTANCE_MAX} 条`
      return { title, bot: text(args, 'bot'), brief: text(args, 'brief'), acceptance, after: text(args, 'after') }
    },
    run: (args) => {
      const result = pod.subtasks.open(current(), args)
      if (!result.ok) return failure(result.error.message)
      const { task, room, waiting } = result.value
      const start = waiting ? `，等 ${args.after} 就绪再开工` : ''
      return success(`开了子任务 ${task.id}「${task.title}」，交给${pod.bots.get(task.ownerBotId ?? '')?.name ?? 'bot'}${start}；任务群「${room.title}」（${room.id}）。`, { taskId: task.id, roomId: room.id })
    },
  })

  const review = podTool({
    name: 'review_subtask',
    description: `验收交上来的子任务：对照验收项逐条看，研究类结论抽查出处。通过就完成；没通过写清哪一条没达到、要怎么改，它在原会话接着改，最多返工 ${MAX_REWORKS} 次。`,
    properties: { subtask: str('子任务 id'), pass: bool('通过吗'), feedback: str('没通过时写清要改什么；通过时可以不写') },
    required: ['subtask', 'pass'],
    parse: (args) => (text(args, 'subtask') === '' ? '要写子任务 id' : { subtask: text(args, 'subtask'), pass: flag(args, 'pass') === true, feedback: text(args, 'feedback') }),
    run: (args) => {
      const result = pod.subtasks.review(current(), args)
      return result.ok ? success(result.value) : failure(result.error.message)
    },
  })

  const tell = podTool({
    name: 'tell_subtask',
    description: '给子任务补一句话：答复它的问题、改要求、换个做法再试。它在跑就直接送进去，没在跑就开一次执行带上；结束了的会重新打开。',
    properties: { subtask: str('子任务 id'), text: str('要说的话') },
    required: ['subtask', 'text'],
    parse: (args) => (text(args, 'subtask') === '' || text(args, 'text') === '' ? '要写子任务 id 和要说的话' : { subtask: text(args, 'subtask'), text: text(args, 'text') }),
    run: (args) => {
      const result = pod.subtasks.tell(current(), args)
      return result.ok ? success(result.value) : failure(result.error.message)
    },
  })

  const stop = podTool({
    name: 'stop_subtask',
    description: '停掉一个子任务（不要了、改派给别人、你自己做）。',
    properties: { subtask: str('子任务 id') },
    required: ['subtask'],
    parse: (args) => (text(args, 'subtask') === '' ? '要写子任务 id' : { subtask: text(args, 'subtask') }),
    run: ({ subtask }) => {
      const result = pod.subtasks.stop(current(), subtask)
      return result.ok ? success(result.value) : failure(result.error.message)
    },
  })

  const list = podTool({
    name: 'list_subtasks',
    description: '列出这个任务的子任务：id、标题、谁在做、阶段、最近的进度说明。',
    properties: {},
    concurrent: true,
    parse: () => ({}),
    run: () => {
      const leader = pod.subtasks.leaderTask(current())
      return leader.ok ? success(pod.subtasks.board(leader.value)) : failure(leader.error.message)
    },
  })

  return [open, review, tell, stop, list]
}
