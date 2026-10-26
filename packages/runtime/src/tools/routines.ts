import type { Bot, PodSession } from 'pod-domain'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { bool, failure, int, podTool, str, success, text } from './define.ts'
import { SCHEDULE_PROPS, readSchedule } from './schedule.ts'

/**
 * 建例程和盯网页的工具：“每天 8 点给我整理资讯”“盯着这个价格页，变了告诉我”“半小时后看看结果”。
 * 主管可以交给任何 bot（在群里没写交给谁、群里又只有一个成员时就交给它）；成员只能建在自己名下、只改和删自己的。
 */
export function routineTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const current = (): PodSession => pod.registry.get(session.id) ?? session
  const lead = pod.bots.get(session.botId)?.role === 'lead'

  /** 谁来做：主管写了名字就是它；没写时，群里只有一个成员就是它，不然是主管自己。成员总是自己。 */
  const owner = (name: string): Bot | undefined => {
    const me = current()
    if (lead && name !== '') return pod.bots.resolve(name)
    if (lead) {
      const room = me.roomId === null ? undefined : pod.rooms.get(me.roomId)
      const members = room === undefined || room.kind === 'direct' ? [] : pod.rooms.memberBots(room).filter((bot) => bot.role !== 'lead')
      if (members.length === 1) return members[0]
    }
    return pod.bots.get(me.botId)
  }
  const botParam = (what: string): Readonly<Record<string, Readonly<Record<string, unknown>>>> => (lead ? { bot: str(`${what}：bot 名字。在群里写负责这件事的成员（结果以它的名义发进群）；不写时，群里只有一个成员就交给它，不然是你`) } : {})
  const mine = (botId: string): boolean => lead || botId === current().botId

  /** 发到哪：「这里」是当前房间，「单聊」是负责的 bot 和用户的单聊，别的按群名或 id 找；成员只能发到自己在的群。 */
  const resolveRoom = (name: string, botId: string): { readonly id: string | null } | string => {
    if (name === '这里' || name === '当前房间') return { id: current().roomId }
    if (name === '单聊') return { id: null }
    const rooms = pod.rooms.list({})
    const groups = rooms.ok ? rooms.value.filter((room) => room.kind !== 'direct') : []
    const found = groups.find((room) => room.id === name) ?? groups.find((room) => room.title === name)
    if (found === undefined) return `找不到群「${name}」`
    if (!lead && !found.memberIds.includes(botId)) return `你不在「${found.title}」里，结果发不过去`
    return { id: found.id }
  }
  const where = (roomId: string | null): string => (roomId === null ? '单聊' : roomId === current().roomId ? '这里' : `「${pod.rooms.get(roomId)?.title ?? '已删除的群聊'}」`)

  const create = podTool({
    name: 'create_routine',
    description: [
      `${lead ? '建一个定时例程：到点让负责的 bot 按指令做一次' : '给你自己建一个定时例程：到点由你按指令做一次'}，结果发到当前房间。时间按用户的时区。`,
      '重复的：每天写 time，每周几写 time 和 weekdays，每隔一段时间写 every_minutes，更复杂的写 cron。',
      '只跑一次的：写 at 或 in_minutes，跑完自动删掉。要过一会儿、或者到某个时间看一眼结果，就建只跑一次的例程，不要开后台任务等着。',
      '要定时刷新一个页面（看板、跟踪表）就填 page。',
    ].join(''),
    properties: {
      title: str('例程名字'),
      prompt: str('每次要做什么'),
      ...botParam('谁来做'),
      ...SCHEDULE_PROPS,
      page: str('每次运行都更新这个页面（页面 id）：比如每天刷新的看板。先用 save_page 建好页面再填'),
    },
    required: ['title', 'prompt'],
    parse: (args) => {
      const schedule = readSchedule(args, pod.now())
      if (schedule === undefined) return '要写时间：time、every_minutes、cron、at 或 in_minutes'
      if (typeof schedule === 'string') return schedule
      return { title: text(args, 'title'), prompt: text(args, 'prompt'), bot: text(args, 'bot'), schedule, page: text(args, 'page') }
    },
    run: ({ title, prompt, bot, schedule, page }) => {
      const me = current()
      const target = owner(bot)
      if (target === undefined) return failure(`找不到 bot「${bot}」`)
      const result = pod.routines.create({ kind: 'cron', title, prompt, ...schedule, botId: target.id, roomId: me.roomId, ...(page === '' ? {} : { pageId: page }) }, me.botId)
      if (!result.ok) return failure(result.error.message)
      const routine = result.value
      const who = target.id === me.botId ? '' : `，由${target.name}来做`
      const once = routine.runAt === null ? '' : '，跑完自动删掉'
      return success(`已建好例程「${routine.title}」：${pod.routines.describe(routine)}${who}${once}。${pod.routines.describeNext(routine)}。`, { routineId: routine.id })
    },
  })

  const change = podTool({
    name: 'update_routine',
    description: [
      `改${lead ? '' : '你名下的'}一个例程或盯网页：名字、指令、时间、页面、${lead ? '谁来做、' : ''}结果发到哪，或者暂停、恢复。只写要改的，没写的不变。`,
      '时间的写法和 create_routine 一样；盯网页改 interval_minutes。',
      '返回改好以后的安排和下次运行时间，以它为准，不用再去查库或者另外验证。',
    ].join(''),
    properties: {
      routine: str('例程 id（list_routines 里看）'),
      title: str('新名字'),
      prompt: str('新的指令：每次要做什么'),
      ...SCHEDULE_PROPS,
      interval_minutes: int('盯网页：多久查一次（分钟），5 到 10080'),
      page: str('每次运行都更新这个页面（页面 id）；写 none 不再更新页面'),
      ...(lead ? { bot: str('换成哪个 bot 来做：bot 名字') } : {}),
      room: str('结果发到哪：「这里」是当前房间，「单聊」是负责的 bot 和用户的单聊，也可以写群名'),
      enabled: bool('false 暂停，true 恢复'),
    },
    required: ['routine'],
    parse: (args) => {
      const schedule = readSchedule(args, pod.now())
      if (typeof schedule === 'string') return schedule
      return {
        id: text(args, 'routine'),
        title: text(args, 'title'),
        prompt: text(args, 'prompt'),
        schedule,
        interval: typeof args.interval_minutes === 'number' ? args.interval_minutes : undefined,
        page: text(args, 'page'),
        bot: lead ? text(args, 'bot') : '',
        room: text(args, 'room'),
        enabled: typeof args.enabled === 'boolean' ? args.enabled : undefined,
      }
    },
    run: (args) => {
      const routine = pod.routines.get(args.id)
      if (routine === undefined) return failure(`找不到例程 ${args.id}：用 list_routines 看 id`)
      if (!mine(routine.botId)) return failure(`「${routine.title}」不在你名下，改不了；要改请找主管或者用户。`)
      const target = args.bot === '' ? undefined : pod.bots.resolve(args.bot)
      if (args.bot !== '' && (target === undefined || target.archivedAt !== null)) return failure(`找不到 bot「${args.bot}」`)
      const room = args.room === '' ? undefined : resolveRoom(args.room, target?.id ?? routine.botId)
      if (typeof room === 'string') return failure(room)
      const patch = {
        ...(args.title === '' ? {} : { title: args.title }),
        ...(args.prompt === '' ? {} : { prompt: args.prompt }),
        ...(args.schedule ?? {}),
        ...(args.interval === undefined ? {} : { intervalMinutes: args.interval }),
        ...(args.page === '' ? {} : { pageId: args.page === 'none' ? null : args.page }),
        ...(target === undefined ? {} : { botId: target.id }),
        ...(room === undefined ? {} : { roomId: room.id }),
        ...(args.enabled === undefined ? {} : { enabled: args.enabled }),
      }
      if (Object.keys(patch).length === 0) return failure('没写要改什么')
      const result = pod.routines.update({ id: routine.id, patch }, current().botId)
      if (!result.ok) return failure(result.error.message)
      const updated = result.value
      const who = lead ? `，${pod.bots.get(updated.botId)?.name ?? '已删除的 bot'}来做` : ''
      return success(`已改好「${updated.title}」：${pod.routines.describe(updated)}${who}，结果发到${where(updated.roomId)}。${pod.routines.describeNext(updated)}。`, {
        routineId: updated.id,
        nextRunAt: updated.nextRunAt,
      })
    },
  })

  const watch = podTool({
    name: 'watch_page',
    description: `盯一个网页：定时读取内容，没变化不打扰；变了就让${lead ? '负责的 bot' : '你'}分析并发到当前房间。默认每 60 分钟查一次。`,
    properties: {
      title: str('名字'),
      url: str('网址'),
      what: str('要关注什么变化，例如“价格和套餐”'),
      interval_minutes: int('多久查一次（分钟），5 到 10080'),
      ...botParam('谁来分析'),
    },
    required: ['title', 'url', 'what'],
    parse: (args) => ({
      title: text(args, 'title'),
      url: text(args, 'url'),
      what: text(args, 'what'),
      interval: typeof args.interval_minutes === 'number' ? args.interval_minutes : 60,
      bot: text(args, 'bot'),
    }),
    run: ({ title, url, what, interval, bot }) => {
      const me = current()
      const target = owner(bot)
      if (target === undefined) return failure(`找不到 bot「${bot}」`)
      const result = pod.routines.create({ kind: 'watch', title, prompt: what, url, intervalMinutes: interval, botId: target.id, roomId: me.roomId }, me.botId)
      if (!result.ok) return failure(result.error.message)
      const who = target.id === me.botId ? '' : `，由${target.name}来看`
      return success(`开始盯「${title}」：${pod.routines.describe(result.value)}${who}`, { routineId: result.value.id })
    },
  })

  const list = podTool({
    name: 'list_routines',
    description: lead ? '列出所有例程和盯网页：谁来做、时间表、发到哪、下次什么时候跑、上次运行情况。' : '列出你名下的例程和盯网页：时间表、发到哪、下次什么时候跑、上次运行情况。',
    properties: {},
    concurrent: true,
    parse: () => ({}),
    run: () => {
      const routines = pod.routines.list().filter((routine) => mine(routine.botId))
      if (routines.length === 0) return success(lead ? '还没有例程。' : '你名下还没有例程。')
      const name = (botId: string): string => pod.bots.get(botId)?.name ?? '已删除的 bot'
      return success(
        routines
          .map((routine) => `- ${routine.id}「${routine.title}」${lead ? `${name(routine.botId)} · ` : ''}${pod.routines.describe(routine)} · 发到${where(routine.roomId)} · ${pod.routines.describeNext(routine)}${routine.lastStatus === '' ? '' : ` · 上次：${routine.lastStatus}`}`)
          .join('\n'),
      )
    },
  })

  const remove = podTool({
    name: 'delete_routine',
    description: lead ? '删除一个例程或盯网页。' : '删除你名下的一个例程或盯网页。',
    properties: { routine: str('例程 id（list_routines 里看）') },
    required: ['routine'],
    parse: (args) => ({ id: text(args, 'routine') }),
    run: ({ id }) => {
      const routine = pod.routines.get(id)
      if (routine !== undefined && !mine(routine.botId)) return failure(`「${routine.title}」不在你名下，删不了；要删请找主管或者用户。`)
      const result = pod.routines.remove({ id }, current().botId)
      return result.ok ? success('已删除。') : failure(result.error.message)
    },
  })

  return [create, change, watch, list, remove]
}
