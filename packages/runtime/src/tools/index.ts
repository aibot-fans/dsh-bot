import { sessionBrowses, sessionMakesPages, type PodSession } from 'pod-domain'
import type { Equipment } from '../agents/binder.ts'
import type { LiveAgent, ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { frontTools } from '../front/tools.ts'
import { browserTools } from './browser.ts'
import { coordTools } from './coord.ts'
import { groupTools } from './group.ts'
import { orgTools, taskInfoTools } from './lead.ts'
import { memoryTools } from './memory.ts'
import { pageTools } from './pages.ts'
import { readTool } from './read.ts'
import { routineTools } from './routines.ts'
import { skillTools } from './skills.ts'
import { askOwnerTool, taskTools } from './task.ts'
import { teamTools } from './team.ts'
import { xTools } from './x.ts'

/** 其他插件通过 ctx.pod.registerTool() 加的工具：只出现在 bot 会话里，可以按会话决定给不给。 */
export interface ExtraTool {
  readonly applies: (session: PodSession) => boolean
  readonly create: (session: PodSession) => ToolDefinition
}

/** 前台只读 dsh-bot 自己的东西：不搜网页存档，页面只读不写。 */
const FRONT_SKIPS = new Set(['search_web_archive', 'save_page', 'page_guide'])

/** 前台：分派、回复、读、看和控制任务、记忆、读页面、例程（到触发器上线为止）、在群里点名；Super-agent 另有组织工具。不碰外部。 */
function frontEquipment(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const lead = pod.bots.get(session.botId)?.role === 'lead'
  return [
    ...frontTools(pod, session),
    readTool(pod, session),
    ...taskInfoTools(pod, session),
    ...(lead ? orgTools(pod, session) : []),
    ...memoryTools(pod, session),
    ...pageTools(pod, session),
    ...routineTools(pod, session),
    ...groupTools(pod, session),
  ].filter((tool) => !FRONT_SKIPS.has(tool.name))
}

/**
 * 按会话决定装哪些 Pod 工具：
 * - 前台（每个 bot 一个）：见 frontEquipment，不装浏览器、X 和其他插件的工具；
 * - 聊天会话（改成前台以前的，现在只用来写每日简报）：记忆和页面；
 * - 任务会话：汇报、确认、交还、跟进，以及读、咨询、团队状态、任务板；
 * - 组长的协调会话：任务板、验收、改计划、改派、发说明、交付、要人、找用户；
 * - 咨询会话不给协作工具（咨询不能嵌套），也不做页面；
 * - aibot 的 X 工具：X 情报员、主管、标签里提到 X 或推特的 bot，以及「X 监控」群里的会话；
 * - x_ 工具（用 dsh-bot 浏览器里登录的 X 账号读写 X、读加密聊天）：范围同上，不管 aibot 开没开；
 * - 其他插件注册的工具（浏览器、记忆、检索……）按各自的条件加上。
 */
export function equipSession(pod: PodRuntime, extras: readonly ExtraTool[], session: PodSession, _agent: LiveAgent): Equipment {
  const skills = () =>
    pod.evolutionKit.skills.registrations(session.botId).map((registration) => ({
      name: registration.name,
      key: `${String(registration.metadata?.podSkillId ?? '')}:${String(registration.metadata?.version ?? '')}`,
      registration: registration as unknown as Readonly<Record<string, unknown>>,
    }))
  if (session.kind === 'front') return { tools: frontEquipment(pod, session), guard: pod.guardFor(session), skills }
  const base: ToolDefinition[] = []
  if (session.kind === 'task') base.push(...taskTools(pod, session), readTool(pod, session), ...teamTools(pod, session))
  if (session.kind === 'coord') base.push(...coordTools(pod, session), askOwnerTool(pod, session), ...teamTools(pod, session))
  base.push(...memoryTools(pod, session))
  if (sessionBrowses(session)) base.push(...browserTools(pod, session))
  if (sessionMakesPages(session)) base.push(...pageTools(pod, session))
  if (session.kind === 'task' || session.kind === 'coord') base.push(...skillTools(pod, session))
  base.push(...pod.aibot.toolsFor(session))
  if (pod.aibot.coversX(session)) base.push(...xTools(pod, session))
  const added = extras.filter((extra) => extra.applies(session)).map((extra) => extra.create(session))
  const names = new Set<string>()
  const tools = [...base, ...added].filter((tool) => {
    if (names.has(tool.name)) return false
    names.add(tool.name)
    return true
  })
  return { tools, guard: pod.guardFor(session), skills }
}
