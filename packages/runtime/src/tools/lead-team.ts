import { MIN_GOOD_SCORE, scoreAssignment, type PodSession } from 'pod-domain'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { bool, failure, flag, oneOf, podTool, str, strList, success, text, texts } from './define.ts'

const SUBTASK_SCHEMA = {
  type: 'object',
  properties: {
    id: str('子任务编号，例如 s1'),
    title: str('标题'),
    brief: str('说明'),
    kind: str('类型：调研、写作、分析、开发……'),
    deliverable: str('交付物，例如 tasks/xxx/A.md'),
    acceptance: strList('2–5 条验收项'),
    dependsOn: strList('依赖的子任务编号'),
    needs: { type: 'object', properties: { browser: bool('需要浏览器'), shell: bool('需要 shell') } },
    owner: str('负责人：bot 的名字或 id，或新建草稿的 draftId'),
  },
}

/** 主管组队用的工具：提交团队计划、转达需求变更、组建团队、内部评审、按子任务打分找人。 */
export function leadTeamTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const current = (): PodSession => pod.registry.get(session.id) ?? session

  const scoreBots = podTool({
    name: 'score_bots',
    description: '为一个子任务给每个 bot 打分（0–1：能力匹配、当前负载、上下文连续、模型价格），作为分配参考。最高分低于 0.5 说明没有合适的人，可以新建临时 bot 或自己做；不按分数分要在开工说明里写明理由。',
    properties: {
      kind: str('子任务类型，例如“调研”'),
      title: str('子任务标题'),
      brief: str('子任务说明'),
      browser: bool('需要浏览器'),
      shell: bool('需要 shell'),
    },
    required: ['title'],
    concurrent: true,
    parse: (args) => ({
      kind: text(args, 'kind'),
      title: text(args, 'title'),
      brief: text(args, 'brief'),
      needs: { browser: flag(args, 'browser') === true, shell: flag(args, 'shell') === true },
    }),
    run: (input) => {
      const scores = pod.bots
        .active()
        .map((bot) => ({ bot, score: scoreAssignment(bot, input, { load: pod.tasks.activeLoad(bot.id), continuity: false, ...pod.scorecardStats(bot.id) }) }))
        .sort((left, right) => right.score.score - left.score.score)
      const best = scores[0]?.score.score ?? 0
      return success(best < MIN_GOOD_SCORE ? '没有合适的人（最高分低于 0.5），可以新建临时 bot，或者自己做。' : '按分数从高到低：', {
        scores: scores.map(({ bot, score }) => ({ name: bot.name, score: score.score, eligible: score.eligible, load: pod.tasks.activeLoad(bot.id) })),
      })
    },
  })

  const createTask = podTool({
    name: 'create_task',
    description: [
      '提交团队计划（L2 临时小组由你兼任组长；L3 交给正式团队）。dsh-bot 校验通过就建一个群聊、发开工说明、按依赖派活；不通过会把问题退回给你修改。一个任务只有一个群。',
      '每个子任务只有一个负责人、一个交付物、2–5 条验收项；能并行的不串行。写清任务约定（表格的列、文件命名、货币和日期格式、出处写法），汇总时才能直接拼起来。',
      '前提写进 assumptions 并挂上依赖它的子任务（affects），用户纠正前提时只重做那些。需要新 bot 时写进 drafts，owner 填 draftId。',
    ].join(''),
    properties: {
      goal: str('目标'),
      group_name: str('群名：不超过 8 个字的主题词，例如“竞品定价”；不填就从目标里取'),
      level: oneOf('L2 临时小组 / L3 正式团队', ['L2', 'L3']),
      team: str('L3 时交给哪个团队（名字或 id）'),
      deliverables: strList('最终交付物'),
      assumptions: { type: 'array', items: { type: 'object', properties: { id: str('前提编号，例如 a1'), text: str('前提'), affects: strList('依赖它的子任务编号') } } },
      reasons: strList('为什么这样分'),
      conventions: strList('任务约定'),
      subtasks: { type: 'array', items: SUBTASK_SCHEMA, description: '子任务' },
      integration: { type: 'object', properties: { owner: str('谁汇总'), method: str('怎么汇总') } },
      review: { type: 'object', properties: { owner: str('谁抽查'), sampling: str('抽查方式') } },
      drafts: {
        type: 'array',
        items: { type: 'object', properties: { draftId: str('草稿编号，例如 d1'), name: str('名字'), title: str('角色'), persona: str('人设'), capabilities: strList('能力标签'), toolProfile: oneOf('工具档案', ['talk', 'research', 'exec']) } },
        description: '需要新建的临时 bot',
      },
    },
    required: ['goal', 'subtasks'],
    parse: (args) => args,
    run: async (raw) => {
      const result = await pod.coordinator.submit(current(), raw)
      if (!result.ok) return failure(result.error.message)
      return success(
        result.value.pending
          ? '计划已建好，等用户在开工说明上点“开始”（谨慎档）。'
          : '已开工：群聊和开工说明建好了，依赖满足的子任务已经派出去。之后由组长按事件验收，你可以先回复用户。',
        { taskId: result.value.rootId, roomId: result.value.roomId },
      )
    },
  })

  const proposeChange = podTool({
    name: 'propose_change',
    description: '用户要改正在进行的团队任务的需求或纠正前提时，把用户的原话转给组长，由组长出新版计划。必须原样引用用户的话。',
    properties: { task_id: str('根任务 id'), owner_quote: str('用户的原话'), message: str('你的说明（可选）') },
    required: ['task_id', 'owner_quote'],
    parse: (args) => ({ taskId: text(args, 'task_id'), quote: text(args, 'owner_quote'), message: text(args, 'message') }),
    run: ({ taskId, quote, message }) => {
      const result = pod.coordinator.proposeChange(current(), taskId, quote, message)
      return result.ok ? success('已转给组长，出新版计划后记录里会写明改了什么。') : failure(result.error.message)
    },
  })

  const createTeam = podTool({
    name: 'create_team',
    description: '组建正式团队（用户说了“每周”“以后”“长期”，或同类请求反复出现时）：一个组长加若干成员，有自己的团队记录。也可以用模板：research 调研组、writing 写作组、dev 开发组、review 评审团。',
    properties: {
      name: str('团队名字'),
      leader: str('组长：bot 名字'),
      members: strList('成员：bot 名字'),
      description: str('团队负责什么'),
      template: oneOf('用模板一键生成 bot 和团队', ['research', 'writing', 'dev', 'review']),
    },
    parse: (args) => ({ name: text(args, 'name'), leader: text(args, 'leader'), members: texts(args, 'members'), description: text(args, 'description'), template: text(args, 'template') }),
    run: ({ name, leader, members, description, template }) => {
      if (template !== '') {
        const created = pod.teams.fromTemplate({ templateId: template, name }, current().botId)
        return created.ok ? success(`已按模板组建「${created.value.name}」`, { teamId: created.value.id }) : failure(created.error.message)
      }
      const leaderBot = pod.bots.resolve(leader)
      if (leaderBot === undefined) return failure(`找不到组长「${leader}」`)
      const memberBots = members.map((member) => pod.bots.resolve(member))
      const missing = members.filter((_, index) => memberBots[index] === undefined)
      if (missing.length > 0) return failure(`找不到成员：${missing.join('、')}`)
      const created = pod.teams.createTeam(
        { name, description, leaderBotId: leaderBot.id, memberIds: memberBots.flatMap((bot) => (bot === undefined ? [] : [bot.id])), temporary: false },
        current().botId,
      )
      return created.ok ? success(`已组建「${created.value.name}」`, { teamId: created.value.id }) : failure(created.error.message)
    },
  })

  const updateTeam = podTool({
    name: 'update_team',
    description: '调整正式团队：增减成员、更换组长。',
    properties: { team: str('团队名字或 id'), leader: str('新组长'), add: strList('加入的成员'), remove: strList('移出的成员') },
    required: ['team'],
    parse: (args) => ({ team: text(args, 'team'), leader: text(args, 'leader'), add: texts(args, 'add'), remove: texts(args, 'remove') }),
    run: ({ team, leader, add, remove }) => {
      const target = pod.teams.resolve(team)
      if (target === undefined) return failure(`找不到团队「${team}」`)
      const leaderBot = leader === '' ? undefined : pod.bots.resolve(leader)
      if (leader !== '' && leaderBot === undefined) return failure(`找不到「${leader}」`)
      const added = add.map((name) => pod.bots.resolve(name)?.id).filter((id): id is string => id !== undefined)
      const removed = new Set(remove.map((name) => pod.bots.resolve(name)?.id).filter((id): id is string => id !== undefined))
      const members = [...target.memberIds, ...added].filter((id) => !removed.has(id))
      const result = pod.teams.update({ id: target.id, patch: { memberIds: members, ...(leaderBot === undefined ? {} : { leaderBotId: leaderBot.id }) } }, current().botId)
      return result.ok ? success(`已调整「${result.value.name}」`) : failure(result.error.message)
    },
  })

  const review = podTool({
    name: 'internal_review',
    description: '需要多方意见时（用户问“你们怎么看”“评估一下”，或你自己判断需要）：挑 2–4 个相关的 bot 做一次内部评审。round 轮流发言，后面的能看到前面的；free 自由讨论，没话说的回 PASS。原文折叠在记录里，你拿到全部发言后写结论和分歧。',
    properties: { topic: str('评审主题'), question: str('要大家回答的问题'), bots: strList('参加的 bot（2–4 个）'), format: oneOf('round 轮流 / free 自由讨论', ['round', 'free']) },
    required: ['topic', 'question', 'bots'],
    timeoutMs: 20 * 60_000,
    parse: (args) => ({ topic: text(args, 'topic'), question: text(args, 'question'), bots: texts(args, 'bots'), format: text(args, 'format') === 'free' ? ('free' as const) : ('round' as const) }),
    run: async (input, exec) => {
      const result = await pod.consults.review(current(), input, exec.signal)
      if (!result.ok) return failure(result.error.message)
      return success('评审结束，原文已折叠在记录里。请把结论和分歧写成一条消息；需要动手的直接转成任务。', { statements: result.value })
    },
  })

  return [scoreBots, createTask, proposeChange, createTeam, updateTeam, review]
}
