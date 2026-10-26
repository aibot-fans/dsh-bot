import { oneLine, truncate, type Bot, type RoomMessage } from 'pod-domain'
import type { LiteLlm } from '../core/lite.ts'

/** 分派器最多等多久；超时就按默认的人来接。 */
const ROUTE_TIMEOUT_MS = 12_000

/** 给分派器看的最近几条群消息。 */
const ROUTE_RECENT = 8

export interface RouteInput {
  readonly roomTitle: string
  readonly lead: Bot
  /** 群里除主管以外的成员。 */
  readonly members: readonly Bot[]
  /** 最近的群聊，旧的在前，每条“- 谁：说了什么”。 */
  readonly recent: readonly string[]
  readonly text: string
}

/** 按分工挑人：挑不出来（模型不可用、出错、超时、答的不是群成员）返回 undefined。 */
export type Route = (input: RouteInput) => Promise<Bot | undefined>

const SYSTEM = '你是群聊里的分派器：用户在群里说了一句没有点名的话，你按群成员的分工挑一个最合适的来接。只输出 JSON，不要解释。'

function memberLine(bot: Bot): string {
  const parts = [
    bot.title !== '' && bot.title !== bot.name ? bot.title : '',
    bot.card.duties === '' ? '' : `职责：${bot.card.duties}`,
    bot.card.notResponsible === '' ? '' : `不负责：${bot.card.notResponsible}`,
    bot.capabilities.length === 0 ? '' : `能力：${bot.capabilities.join('、')}`,
  ].filter((part) => part !== '')
  return `- ${bot.name}${parts.length === 0 ? '' : `：${truncate(parts.join('；'), 240)}`}`
}

/** 交给分派器的说明：成员的分工、主管在群里管什么、最近的群聊和用户的新消息。 */
export function routePrompt(input: RouteInput): string {
  const lead = input.lead.name
  return [
    `群聊「${input.roomTitle}」的成员：`,
    ...input.members.map(memberLine),
    `- ${lead}：主管，在群里只管分派和组织：新建或调整 bot、拉人进群、要几个成员配合的大任务、关于 Pod 本身怎么用的问题。具体的活不归主管。`,
    ...(input.recent.length === 0 ? [] : ['', '最近的群聊（旧的在前）：', ...input.recent]),
    '',
    '用户的新消息：',
    truncate(input.text, 1200),
    '',
    '怎么挑：',
    '- 选职责最对口的成员。接着刚才的话题说的（比如“好的”“继续”“那就这么办”），交给刚才在回答的成员。',
    `- 要新建 bot、拉人、几个成员一起配合的大任务、问 Pod 本身，或者没有一个成员对口时，选${lead}。`,
    '只输出：{"to": "名字"}',
  ].join('\n')
}

function readRoute(value: unknown, candidates: readonly Bot[]): Bot | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = (value as { readonly to?: unknown }).to
  if (typeof raw !== 'string') return undefined
  const name = raw.replace(/^[@＠\s]+/, '').trim()
  return candidates.find((bot) => bot.name === name)
}

/** 用轻量模型挑人。 */
export function liteRoute(lite: LiteLlm, warn: (message: string) => void): Route {
  return async (input) => {
    if (!lite.available) return undefined
    try {
      return await lite.completeJson(
        { purpose: 'group-route', system: SYSTEM, prompt: routePrompt(input), signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) },
        (value) => readRoute(value, [...input.members, input.lead]),
      )
    } catch (error) {
      warn(`群聊分派没挑出人，按默认的人来接：${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }
}

/** 给分派器看的最近几条群消息：说过的话（不含卡片和里程碑），正在分派的这条不算。 */
export function routeRecent(messages: readonly RoomMessage[], nameOf: (author: string) => string, skipId: string | undefined): readonly string[] {
  return messages
    .filter((message) => message.id !== skipId && (message.kind === 'text' || message.kind === 'kickoff'))
    .slice(-ROUTE_RECENT)
    .map((message) => `- ${nameOf(message.author)}：${truncate(oneLine(message.body), 120)}`)
}

/**
 * 群里没点名的话谁来接：引用了哪个成员的消息就交给它；不然让分派器按分工挑；
 * 挑不出来时，群里只有一个成员就是它，不然是主管。群里没有别的成员时是主管。
 */
export async function pickResponder(input: RouteInput & { readonly quoted: RoomMessage | undefined; readonly route: Route | undefined }): Promise<Bot> {
  const { lead, members, quoted } = input
  if (members.length === 0) return lead
  const quotedBot = quoted === undefined ? undefined : members.find((bot) => bot.id === quoted.author)
  if (quotedBot !== undefined) return quotedBot
  const routed = input.route === undefined ? undefined : await input.route(input)
  return routed ?? (members.length === 1 ? (members[0] ?? lead) : lead)
}
