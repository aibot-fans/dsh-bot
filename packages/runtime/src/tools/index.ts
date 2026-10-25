import { sessionBrowses, sessionMakesPages, type PodSession } from 'pod-domain'
import type { Equipment } from '../agents/binder.ts'
import type { LiveAgent, ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { browserTools } from './browser.ts'
import { coordTools } from './coord.ts'
import { groupTools } from './group.ts'
import { leadTeamTools } from './lead-team.ts'
import { leadTools } from './lead.ts'
import { memoryTools } from './memory.ts'
import { pageTools } from './pages.ts'
import { routineTools } from './routines.ts'
import { skillTools } from './skills.ts'
import { askOwnerTool, taskTools } from './task.ts'
import { teamTools } from './team.ts'

/** 其他插件通过 ctx.pod.registerTool() 加的工具：只出现在 bot 会话里，可以按会话决定给不给。 */
export interface ExtraTool {
  readonly applies: (session: PodSession) => boolean
  readonly create: (session: PodSession) => ToolDefinition
}

/**
 * 按会话决定装哪些 Pod 工具：
 * - 主管的聊天会话：组织工具（委派、组队、团队、评审）；
 * - 群聊里的聊天会话：在群里 @ 成员（mention_member）；
 * - 任务会话：勾验收项、提交、找用户，以及咨询、团队状态、任务板；
 * - 组长的协调会话：任务板、验收、改计划、改派、发说明、交付、要人、找用户；
 * - 咨询会话不给协作工具（咨询不能嵌套），也不做页面；
 * - aibot 的 X 工具：X 情报员、主管、标签里提到 X 或推特的 bot，以及「X 监控」群里的会话；
 * - 其他插件注册的工具（浏览器、记忆、检索……）按各自的条件加上。
 */
export function equipSession(pod: PodRuntime, extras: readonly ExtraTool[], session: PodSession, _agent: LiveAgent): Equipment {
  const bot = pod.bots.get(session.botId)
  const base: ToolDefinition[] = []
  if (session.kind === 'chat' && bot?.role === 'lead') base.push(...leadTools(pod, session), ...leadTeamTools(pod, session), ...routineTools(pod, session))
  if (session.kind === 'chat') base.push(...teamTools(pod, session), ...groupTools(pod, session))
  if (session.kind === 'task') base.push(...taskTools(pod, session), ...teamTools(pod, session))
  if (session.kind === 'coord') base.push(...coordTools(pod, session), askOwnerTool(pod, session), ...teamTools(pod, session))
  base.push(...memoryTools(pod, session))
  if (sessionBrowses(session)) base.push(...browserTools(pod, session))
  if (sessionMakesPages(session)) base.push(...pageTools(pod, session))
  if (session.kind === 'chat' || session.kind === 'task' || session.kind === 'coord') base.push(...skillTools(pod, session))
  base.push(...pod.aibot.toolsFor(session))
  const added = extras.filter((extra) => extra.applies(session)).map((extra) => extra.create(session))
  const names = new Set<string>()
  const tools = [...base, ...added].filter((tool) => {
    if (names.has(tool.name)) return false
    names.add(tool.name)
    return true
  })
  const skills = () =>
    pod.evolutionKit.skills.registrations(session.botId).map((registration) => ({
      name: registration.name,
      key: `${String(registration.metadata?.podSkillId ?? '')}:${String(registration.metadata?.version ?? '')}`,
      registration: registration as unknown as Readonly<Record<string, unknown>>,
    }))
  return { tools, guard: pod.guardFor(session), skills }
}
