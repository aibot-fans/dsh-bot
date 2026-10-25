import { dailyCron, weeklyCron, type PodSession } from 'pod-domain'
import type { ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { failure, int, intList, podTool, str, success, text } from './define.ts'

const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** 主管建例程和盯网页的工具：“每天 8 点给我整理资讯”“盯着这个价格页，变了告诉我”。 */
export function routineTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const current = (): PodSession => pod.registry.get(session.id) ?? session

  const create = podTool({
    name: 'create_routine',
    description: '建一个定时例程：到点让某个 bot 按指令做一次，结果发到指定的房间（默认是当前房间）。时间按用户的时区。每天写 time；每周几写 time 和 weekdays（1=周一…7=周日）；更复杂的写 cron（分 时 日 月 周）。要定时刷新一个页面（看板、跟踪表）就填 page。',
    properties: {
      title: str('例程名字'),
      prompt: str('每次要做什么'),
      bot: str('谁来做：bot 名字；默认是你'),
      time: str('每天几点，HH:MM'),
      weekdays: intList('每周哪几天，1=周一…7=周日'),
      cron: str('五段式 cron，和 time 二选一'),
      page: str('每次运行都更新这个页面（页面 id）：比如每天刷新的看板。先用 save_page 建好页面再填'),
    },
    required: ['title', 'prompt'],
    parse: (args) => {
      const time = text(args, 'time')
      const cron = text(args, 'cron')
      if (cron === '' && !CLOCK.test(time)) return '要写 time（HH:MM）或者 cron'
      const weekdays = Array.isArray(args.weekdays) ? args.weekdays.filter((day): day is number => typeof day === 'number' && day >= 1 && day <= 7) : []
      return {
        title: text(args, 'title'),
        prompt: text(args, 'prompt'),
        bot: text(args, 'bot'),
        cron: cron !== '' ? cron : weekdays.length > 0 ? weeklyCron(time, weekdays) : dailyCron(time),
        page: text(args, 'page'),
      }
    },
    run: ({ title, prompt, bot, cron, page }) => {
      const me = current()
      const target = bot === '' ? pod.bots.get(me.botId) : pod.bots.resolve(bot)
      if (target === undefined) return failure(`找不到 bot「${bot}」`)
      const result = pod.routines.create({ kind: 'cron', title, prompt, cron, botId: target.id, roomId: me.roomId, ...(page === '' ? {} : { pageId: page }) }, me.botId)
      return result.ok ? success(`已建好例程「${result.value.title}」：${pod.routines.describe(result.value)}`, { routineId: result.value.id }) : failure(result.error.message)
    },
  })

  const watch = podTool({
    name: 'watch_page',
    description: '盯一个网页：定时读取内容，没变化不打扰；变了就让 bot 分析并发到当前房间。默认每 60 分钟查一次。',
    properties: {
      title: str('名字'),
      url: str('网址'),
      what: str('要关注什么变化，例如“价格和套餐”'),
      interval_minutes: int('多久查一次（分钟），5 到 10080'),
      bot: str('谁来分析：bot 名字；默认是你'),
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
      const target = bot === '' ? pod.bots.get(me.botId) : pod.bots.resolve(bot)
      if (target === undefined) return failure(`找不到 bot「${bot}」`)
      const result = pod.routines.create({ kind: 'watch', title, prompt: what, url, intervalMinutes: interval, botId: target.id, roomId: me.roomId }, me.botId)
      return result.ok ? success(`开始盯「${title}」：${pod.routines.describe(result.value)}`, { routineId: result.value.id }) : failure(result.error.message)
    },
  })

  const list = podTool({
    name: 'list_routines',
    description: '列出所有例程和盯网页：时间表、上次运行情况。',
    properties: {},
    concurrent: true,
    parse: () => ({}),
    run: () => {
      const routines = pod.routines.list()
      if (routines.length === 0) return success('还没有例程。')
      return success(
        routines
          .map((routine) => `- ${routine.id}「${routine.title}」${pod.routines.describe(routine)}${routine.enabled ? '' : '（已暂停）'}${routine.lastStatus === '' ? '' : ` · 上次：${routine.lastStatus}`}`)
          .join('\n'),
      )
    },
  })

  const remove = podTool({
    name: 'delete_routine',
    description: '删除一个例程或盯网页。',
    properties: { routine: str('例程 id（list_routines 里看）') },
    required: ['routine'],
    parse: (args) => ({ id: text(args, 'routine') }),
    run: ({ id }) => {
      const result = pod.routines.remove({ id }, current().botId)
      return result.ok ? success('已删除。') : failure(result.error.message)
    },
  })

  return [create, watch, list, remove]
}
