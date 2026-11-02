import { BOT_PRESETS, TICKET_STAGE_LABELS, TOOL_PROFILES, botLabel, botPreset, groupNameMax, isActive, t, validateDraft, type Bot, type ModelChoice, type PodSession, type ToolProfile } from 'pod-domain'
import { getMessage, listRooms } from 'pod-store'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { bool, failure, flag, oneOf, podTool, str, strList, success, text, texts } from './define.ts'

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

/** Super-agent 前台的组织工具：查人、建 bot、归档、拉群。 */
export function orgTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const findBots = podTool({
    name: 'find_bots',
    description: '按能力查找 dsh-bot 里已有的 bot，返回名片（角色、能力、职责、当前手上的任务数）。派活前先用它看看有没有合适的人。',
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
        return success(bots.length === 0 ? 'dsh-bot 里还没有其他 bot，可以用 create_bot 新建。' : '没有匹配的 bot；可以新建临时 bot，或者自己做。', { bots: [] })
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
      const created = pod.bots.createFromDraft(draft.value, { source: 'lead', actor: session.botId, reason: text(args, 'reason') || t('Super-agent 新建') })
      return success(`已新建「${created.name}」${created.temporary ? '（临时）' : ''}`, { bot: card(pod, created) })
    },
  })

  const archive = podTool({
    name: 'archive',
    description: '归档临时 bot（进回收站，30 天内可恢复）。Super-agent 不能被归档。',
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
      '拉群：把几个 bot 拉进一个新群聊，用户可以在群里 @ 它们分别说话；没点名的话由你判断交给谁。',
      `群名用简短的主题词（最好不超过 ${groupNameMax()} 个字），例如“博客小组”；已经有同名的群就直接用那个群，不重复建。`,
      '用户说“拉个群”“把写手和程序员叫到一起”时用它；要几个人配合干一件事，开任务交给一个负责的 bot，它会开子任务、建任务群。',
    ].join(''),
    properties: {
      name: str(`群名，最好不超过 ${groupNameMax()} 个字`),
      members: strList('拉谁进群：bot 的名字或 id；你会自动在群里'),
      intro: str('开场白：这个群是干什么的，作为群里的第一条消息'),
      to: str('用户在哪条消息里要的（消息 id）：进群的入口放在那条所在的聊天室'),
    },
    required: ['name', 'members'],
    parse: (args) => ({ name: text(args, 'name'), members: texts(args, 'members'), intro: text(args, 'intro'), to: text(args, 'to') }),
    run: ({ name, members, intro, to }) => {
      const resolved = members.map((item) => ({ item, bot: pod.bots.resolve(item) }))
      const missing = resolved.filter((entry) => entry.bot === undefined || entry.bot.archivedAt !== null).map((entry) => entry.item)
      if (missing.length > 0) return failure(`找不到这些 bot：${missing.join('、')}。先用 find_bots 查，或用 create_bot 新建`)
      const before = new Set(listRooms(pod.db, { archived: false }).map((room) => room.id))
      const created = pod.rooms.createGroup({ name, memberIds: resolved.map((entry) => entry.bot?.id ?? '') }, session.botId)
      if (!created.ok) return failure(created.error.message)
      const room = created.value
      if (intro !== '') pod.rooms.post(room.id, { author: session.botId, kind: 'text', body: intro, sessionId: session.id })
      // 进群的入口放在用户要的那个聊天室：写了 to 就是那条所在的；前台不在某个聊天室里，就看它手上还没去向的最后一条。
      const where = (to === '' ? undefined : getMessage(pod.db, to)?.roomId) ?? session.roomId ?? pendingRoom(pod, session)
      if (where !== undefined && where !== room.id) {
        const body = before.has(room.id) ? t('用了已有的群「{title}」', { title: room.title }) : t('拉了群「{title}」', { title: room.title })
        pod.rooms.post(where, { author: session.botId, kind: 'notice', body, data: { roomId: room.id } })
      }
      const names = resolved.map((entry) => entry.bot?.name ?? '').join('、')
      const done = before.has(room.id) ? `已经有同名的群「${room.title}」，直接用它（${names} 都在群里）` : `群「${room.title}」建好了，成员：${names}`
      return success(`${done}。进群的入口已经放在聊天里，用户可以在群里 @ 它们。`, { roomId: room.id })
    },
  })

  return [findBots, createBot, archive, createGroup]
}

/** 前台这一批里还没去向的最后一条消息在哪个聊天室。 */
function pendingRoom(pod: PodRuntime, session: PodSession): string | undefined {
  const topics = pod.engine.topics
  const routes = topics.undecided(session.botId, topics.inFlight(session.botId))
  return routes
    .map((route) => getMessage(pod.db, route.messageId))
    .filter((message) => message !== undefined && message.deletedAt === null)
    .at(-1)?.roomId
}

/** 前台看任务、控制任务：查进度、重试、暂停、继续、停止。 */
export function taskInfoTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
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

  const control = podTool({
    name: 'control_task',
    description: '让失败、受阻的任务再做一次（retry），用户说暂停、继续、停止时直接执行。暂停：停下这次执行；继续：接着做；停止：结束任务，之后用户可以点继续。停止只在用户要求时用。',
    properties: {
      task_id: str('任务 id'),
      action: oneOf('retry 再做一次 / pause 暂停 / resume 继续 / stop 停止', ['retry', 'pause', 'resume', 'stop']),
    },
    required: ['task_id', 'action'],
    parse: (args) => {
      const action = text(args, 'action')
      if (!['retry', 'pause', 'resume', 'stop'].includes(action)) return 'action 只能是 retry、pause、resume、stop'
      return { taskId: text(args, 'task_id'), action: action as 'retry' | 'pause' | 'resume' | 'stop' }
    },
    run: ({ taskId, action }) => {
      const result = pod.tasks.control(taskId, action, session.botId)
      return result.ok ? success(`「${result.value.title}」现在是${result.value.ticketStage === null ? result.value.status : TICKET_STAGE_LABELS[result.value.ticketStage]}`) : failure(result.error.message)
    },
  })

  const diagnose = podTool({
    name: 'diagnose_task',
    description: '问看门狗一个任务为什么卡住、有没有在推进。只读，不会打断任务；回答里引用任务事件的 id（#12）。用户问“怎么还没好”“是不是卡住了”时用。',
    properties: { task_id: str('任务 id') },
    required: ['task_id'],
    parse: (args) => (text(args, 'task_id') === '' ? '要写任务 id' : { taskId: text(args, 'task_id') }),
    concurrent: true,
    timeoutMs: 120_000,
    run: async ({ taskId }) => {
      const task = pod.tasks.get(taskId)
      return task === undefined ? failure('找不到这个任务') : success(await pod.judge.diagnose(task))
    },
  })

  return [taskStatus, control, diagnose]
}
