import { BOT_PRESETS, GROUP_NAME_MAX, TOOL_PROFILES, botLabel, botPreset, isActive, validateDraft, type Bot, type ModelChoice, type PodSession, type ToolProfile } from 'pod-domain'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { bool, failure, flag, oneOf, podTool, str, strList, success, text, texts } from './define.ts'

/** delegate 先等结果，2 分钟内没完成就自动转成后台任务。 */
const DELEGATE_WAIT_MS = 120_000

const SELF_NAMES = new Set(['自己', '主管', 'me', 'self', 'lead'])

function card(pod: PodRuntime, bot: Bot): Readonly<Record<string, unknown>> {
  const load = pod.tasks.activeLoad(bot.id)
  return {
    id: bot.id,
    name: bot.name,
    title: bot.title,
    capabilities: bot.capabilities,
    duties: bot.card.duties,
    strengths: bot.card.strengths,
    notResponsible: bot.card.notResponsible,
    toolProfile: bot.toolProfile,
    temporary: bot.temporary,
    activeTasks: load,
  }
}

/**
 * 主管给新 bot 选的模型：provider/model（例如 deepseek/deepseek-v4.1-flash），也可以只写模型名。
 * 找不到时把可用的模型列出来，主管换一个再试。
 */
async function resolveModel(pod: PodRuntime, raw: string, effort: string): Promise<{ readonly ok: true; readonly value: ModelChoice | null } | { readonly ok: false; readonly message: string }> {
  if (raw === '') return { ok: true, value: null }
  const catalog = await pod.models.catalog()
  const models = catalog.groups.flatMap((group) =>
    group.models.map((model) => ({ provider: group.id, model: model.id, name: model.name, efforts: model.reasoning?.efforts.map((item) => item.id) ?? [] })),
  )
  const wanted = raw.trim().toLowerCase()
  const match =
    models.find((item) => `${item.provider}/${item.model}`.toLowerCase() === wanted) ??
    models.find((item) => item.model.toLowerCase() === wanted || item.name.toLowerCase() === wanted)
  if (match === undefined) {
    const names = models.slice(0, 20).map((item) => `${item.provider}/${item.model}`)
    return { ok: false, message: `没有叫「${raw}」的模型。可用的：${names.join('、') || '（dsh 里还没有配置模型）'}。不确定就不填，跟随默认。` }
  }
  const reasoningEffort = effort !== '' && match.efforts.includes(effort) ? effort : undefined
  return { ok: true, value: { provider: match.provider, model: match.model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) } }
}

function overlap(left: readonly string[], right: readonly string[]): number {
  const set = new Set(left.map((item) => item.toLowerCase()))
  return right.filter((item) => set.has(item.toLowerCase())).length
}

/** 主管的组织工具：查人、建 bot、委派、查进度、转达、控制任务、归档。 */
export function leadTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const findBots = podTool({
    name: 'find_bots',
    description: '按能力查找 Pod 里已有的 bot，返回名片（角色、能力、职责、当前手上的任务数）。派活前先用它看看有没有合适的人。',
    properties: { query: str('想找的能力或关键词，例如“调研”“写作”；留空列出全部') },
    parse: (args) => ({ query: text(args, 'query') }),
    concurrent: true,
    run: ({ query }) => {
      const bots = pod.bots.active().filter((bot) => bot.id !== session.botId)
      const words = query.toLowerCase().split(/[\s,，、]+/).filter(Boolean)
      const scored = bots
        .map((bot) => {
          const haystack = [bot.name, bot.title, bot.card.duties, bot.card.strengths, ...bot.capabilities].join(' ').toLowerCase()
          return { bot, score: words.length === 0 ? 1 : words.filter((word) => haystack.includes(word)).length / words.length }
        })
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)
      if (scored.length === 0) {
        return success(bots.length === 0 ? 'Pod 里还没有其他 bot，可以用 create_bot 新建。' : '没有匹配的 bot；可以新建临时 bot，或者自己做。', { bots: [] })
      }
      return success(`找到 ${scored.length} 个`, { bots: scored.map((item) => ({ ...card(pod, item.bot), match: Number(item.score.toFixed(2)) })) })
    },
  })

  const createBot = podTool({
    name: 'create_bot',
    description: [
      '新建一个 bot。先用 find_bots 查有没有相似的；有相似的会提示你，确实要新建就设 force=true 并在说明里写明理由。',
      '人设写清：角色、目标、专长、工作方法、输出格式、禁区；不要写“你是某某专家”这种空话。默认是临时 bot，任务结束就归档，30 天内可恢复。',
      '要做页面（报告、看板、幻灯片、海报、原型、架构图）可以设 preset=designer：名字、角色、人设、能力和头像按设计师预设填好，你另外写了的字段以你写的为准。',
    ].join(''),
    properties: {
      preset: oneOf('用预设新建：designer 是设计师（做页面）。用了预设，名字和人设可以不写', BOT_PRESETS.map((item) => item.id)),
      name: str('名字，最多 24 个字'),
      title: str('角色，例如“研究员”'),
      persona: str('人设正文'),
      capabilities: strList('能力标签，例如 ["调研", "数据分析"]'),
      duties: str('职责：负责什么'),
      not_responsible: str('不负责什么'),
      tool_profile: oneOf('工具档案：talk 只聊天；research 加 web 搜索和工作区读写；exec 再加沙箱 shell', TOOL_PROFILES),
      model: str('模型：写成 provider/model，例如 deepseek/deepseek-v4.1-flash；不填跟随默认。写代码、做研究这类难的活可以选强一些的，整理、闲聊用便宜的'),
      reasoning_effort: str('思考强度，例如 low、medium、high；不填跟随模型默认'),
      temporary: bool('是否临时 bot，默认 true；用预设新建的默认常驻'),
      force: bool('已有相似 bot 时仍要新建'),
      reason: str('为什么要新建（写进决策记录）'),
    },
    parse: (args) => args,
    run: async (args) => {
      const preset = botPreset(text(args, 'preset'))
      const given = texts(args, 'capabilities')
      const capabilities = given.length > 0 ? given : (preset?.capabilities ?? [])
      const model = await resolveModel(pod, text(args, 'model'), text(args, 'reasoning_effort'))
      if (!model.ok) return failure(model.message)
      const draft = validateDraft({
        name: text(args, 'name') || (preset?.name ?? ''),
        title: text(args, 'title') || (preset?.title ?? ''),
        persona: text(args, 'persona') || (preset?.persona ?? ''),
        ...(preset === undefined ? {} : { avatar: preset.avatar }),
        capabilities,
        card: {
          duties: text(args, 'duties') || (preset?.card.duties ?? ''),
          strengths: preset?.card.strengths ?? '',
          notResponsible: text(args, 'not_responsible') || (preset?.card.notResponsible ?? ''),
          askWho: '',
        },
        toolProfile: (TOOL_PROFILES as readonly string[]).includes(text(args, 'tool_profile')) ? (text(args, 'tool_profile') as ToolProfile) : 'research',
        temporary: flag(args, 'temporary') ?? preset === undefined,
        model: model.value,
      })
      if (!draft.ok) return failure(draft.error.message)
      const similar = pod.bots
        .active()
        .filter((bot) => bot.name === draft.value.name || overlap(bot.capabilities, capabilities) >= Math.max(1, Math.ceil(capabilities.length / 2)))
      if (similar.length > 0 && flag(args, 'force') !== true) {
        return failure(`已有相似的 bot：${similar.map(botLabel).join('、')}。先考虑复用；确实要新建就设 force=true，并在开工说明里写明为什么不用它们。`)
      }
      const created = pod.bots.createFromDraft(draft.value, { source: 'lead', actor: session.botId, reason: text(args, 'reason') || '主管新建' })
      return success(`已新建「${created.name}」${created.temporary ? '（临时）' : ''}`, { bot: card(pod, created) })
    },
  })

  const delegate = podTool({
    name: 'delegate',
    description: [
      '把一件事交给一个 bot（L1），或者交给你自己在后台做（bot 填“主管”）。Pod 会建任务、开任务会话，并在对话里放一张实时刷新的任务卡。',
      '默认先等结果：2 分钟内完成就直接返回结果；没完成就转成后台任务，完成时任务卡会变成交付卡，并通知你。',
      '要写清任务说明（目标、范围、约束）、交付物、2–5 条验收项，以及你定下的前提。',
      '只用于要连续多步的实际工作：不要用它（包括交给你自己）来等待、验证或者轮询；改了设置或例程，工具的返回就是结果；到点看一眼用只跑一次的例程（create_routine 的 in_minutes 或 at）。',
    ].join(''),
    properties: {
      bot: str('交给谁：bot 的名字或 id；交给自己写“主管”'),
      title: str('任务标题，简短'),
      brief: str('任务说明：目标、范围、约束、注意事项'),
      deliverable: str('交付物，例如“shared/纪要.md”'),
      acceptance: strList('验收项，2–5 条，每条是可检查的标准'),
      assumptions: strList('你替用户定下的前提'),
      reason: str('为什么交给它（写进决策记录）'),
      urgent: bool('用户说了急'),
      wait: bool('是否先等结果，默认 true'),
    },
    required: ['bot', 'title', 'brief', 'acceptance'],
    parse: (args) => {
      const acceptance = texts(args, 'acceptance')
      if (acceptance.length === 0) return '至少写一条验收项'
      if (acceptance.length > 8) return '验收项最多 8 条，太多就拆成几个任务'
      if (text(args, 'title') === '' || text(args, 'brief') === '') return '标题和任务说明都要写'
      return {
        bot: text(args, 'bot'),
        title: text(args, 'title'),
        brief: text(args, 'brief'),
        deliverable: text(args, 'deliverable'),
        acceptance,
        assumptions: texts(args, 'assumptions'),
        reason: text(args, 'reason'),
        urgent: flag(args, 'urgent') === true,
        wait: flag(args, 'wait') !== false,
      }
    },
    run: async (args, exec) => {
      const target = SELF_NAMES.has(args.bot.toLowerCase()) ? pod.bots.get(session.botId) : pod.bots.resolve(args.bot)
      if (target === undefined) return failure(`找不到 bot「${args.bot}」，先用 find_bots 查，或用 create_bot 新建`)
      const requester = pod.registry.get(session.id) ?? session
      const created = await pod.tasks.delegate({
        requester,
        bot: target,
        title: args.title,
        brief: args.brief,
        deliverable: args.deliverable,
        acceptance: args.acceptance,
        assumptions: args.assumptions,
        urgent: args.urgent,
        reason: args.reason,
      })
      if (!created.ok) return failure(created.error.message)
      const task = created.value
      if (!args.wait) return success('已交出去，任务卡已经放进对话。完成时会通知你。', { taskId: task.id })
      const finished = await pod.tasks.awaitResult(task.id, DELEGATE_WAIT_MS, exec.signal)
      if (finished === undefined) {
        return success('2 分钟内没完成，已转成后台任务；任务卡在对话里实时刷新，完成后会通知你。你现在可以先回复用户。', {
          taskId: task.id,
          status: 'background',
        })
      }
      if (finished.status !== 'done') return failure(`任务「${finished.title}」${finished.status === 'cancelled' ? '被取消了' : '没有完成'}：${finished.note}`)
      return success('任务完成。任务卡已经变成交付卡；你只需用一两句话告诉用户要点，不必重复交付卡上的内容。', {
        taskId: finished.id,
        status: 'done',
        summary: finished.result?.summary ?? '',
        files: finished.result?.files ?? [],
        assumptions: finished.result?.assumptions ?? [],
        unverified: finished.result?.unverified ?? [],
      })
    },
  })

  const taskStatus = podTool({
    name: 'task_status',
    description: '查看任务的进度快照（阶段、子任务、验收项、最近动作、等你的事）。回答用户“做到哪了”时用它，不会打断任务。不填 task_id 列出进行中的任务。',
    properties: { task_id: str('任务 id；留空看全部进行中的任务') },
    parse: (args) => ({ taskId: text(args, 'task_id') }),
    concurrent: true,
    run: ({ taskId }) => {
      if (taskId !== '') {
        const snapshot = pod.tasks.snapshotTextFor(taskId)
        return snapshot === undefined ? failure('找不到这个任务') : success(snapshot)
      }
      const active = pod.tasks.roots(30).filter((task) => isActive(task.status) || task.status === 'paused' || task.status === 'stopped')
      if (active.length === 0) return success('现在没有进行中的任务。')
      return success(active.map((task) => pod.tasks.snapshotTextFor(task.id) ?? task.title).join('\n\n'))
    },
  })

  const relay = podTool({
    name: 'relay_to_task',
    description: '把用户的纠正或补充转达给正在进行的任务，下一步生效，不重启任务。必须原样引用用户的话（owner_quote）；不能自己编指令转达。',
    properties: {
      task_id: str('任务 id'),
      owner_quote: str('用户的原话，一字不改'),
      message: str('你的补充说明（可选）'),
    },
    required: ['task_id', 'owner_quote'],
    parse: (args) => ({ taskId: text(args, 'task_id'), quote: text(args, 'owner_quote'), message: text(args, 'message') }),
    run: ({ taskId, quote, message }) => {
      const result = pod.tasks.relay(taskId, quote, message, session)
      return result.ok ? success(`已转达给「${result.value.title}」，下一步生效。`) : failure(result.error.message)
    },
  })

  const control = podTool({
    name: 'control_task',
    description: '用户说暂停、继续、停止、取消时直接执行。暂停：下一步前停住；停止：立刻停下，已完成的保留，之后可以继续；取消：放弃，文件留在工作区。',
    properties: {
      task_id: str('任务 id'),
      action: oneOf('pause 暂停 / resume 继续 / stop 停止 / cancel 取消', ['pause', 'resume', 'stop', 'cancel']),
    },
    required: ['task_id', 'action'],
    parse: (args) => {
      const action = text(args, 'action')
      if (!['pause', 'resume', 'stop', 'cancel'].includes(action)) return 'action 只能是 pause、resume、stop、cancel'
      return { taskId: text(args, 'task_id'), action: action as 'pause' | 'resume' | 'stop' | 'cancel' }
    },
    run: ({ taskId, action }) => {
      const result = pod.tasks.control(taskId, action, session.botId)
      return result.ok ? success(`「${result.value.title}」现在是${result.value.status}`) : failure(result.error.message)
    },
  })

  const archive = podTool({
    name: 'archive',
    description: '归档临时 bot（进回收站，30 天内可恢复）。主管不能被归档。',
    properties: { bot: str('bot 的名字或 id') },
    required: ['bot'],
    parse: (args) => ({ bot: text(args, 'bot') }),
    run: ({ bot }) => {
      const target = pod.bots.resolve(bot)
      if (target === undefined) return failure(`找不到 bot「${bot}」`)
      const result = pod.bots.archiveById(target.id, session.botId)
      return result.ok ? success(`已归档「${target.name}」，30 天内可以在回收站恢复`) : failure(result.error.message)
    },
  })

  const createGroup = podTool({
    name: 'create_group',
    description: [
      '拉群：把几个 bot 拉进一个新群聊，用户可以在群里 @ 它们分别说话；没点名的话，Pod 按分工交给对口的成员来接。',
      `群名用不超过 ${GROUP_NAME_MAX} 个字的主题词，例如“博客小组”；已经有同名的群就直接用那个群，不重复建。`,
      '用户说“拉个群”“把写手和程序员叫到一起”时用它；要正式分工、按计划干活用 create_task，那会自己建群。',
    ].join(''),
    properties: {
      name: str(`群名，不超过 ${GROUP_NAME_MAX} 个字`),
      members: strList('拉谁进群：bot 的名字或 id；你会自动在群里'),
      intro: str('开场白：这个群是干什么的，作为群里的第一条消息'),
    },
    required: ['name', 'members'],
    parse: (args) => ({ name: text(args, 'name'), members: texts(args, 'members'), intro: text(args, 'intro') }),
    run: ({ name, members, intro }) => {
      const resolved = members.map((item) => ({ item, bot: pod.bots.resolve(item) }))
      const missing = resolved.filter((entry) => entry.bot === undefined || entry.bot.archivedAt !== null).map((entry) => entry.item)
      if (missing.length > 0) return failure(`找不到这些 bot：${missing.join('、')}。先用 find_bots 查，或用 create_bot 新建`)
      const created = pod.rooms.createGroup({ name, memberIds: resolved.map((entry) => entry.bot?.id ?? ''), max: GROUP_NAME_MAX }, session.botId)
      if (!created.ok) return failure(created.error.message)
      const room = created.value
      if (intro !== '') pod.rooms.post(room.id, { author: session.botId, kind: 'text', body: intro, sessionId: session.id })
      if (session.roomId !== null && session.roomId !== room.id) {
        pod.rooms.post(session.roomId, { author: session.botId, kind: 'notice', body: `拉了群「${room.title}」`, data: { roomId: room.id } })
      }
      return success(`群「${room.title}」建好了，成员：${resolved.map((entry) => entry.bot?.name ?? '').join('、')}。用户可以在群里 @ 它们。`, { roomId: room.id })
    },
  })

  return [findBots, createBot, delegate, taskStatus, relay, control, archive, createGroup]
}
