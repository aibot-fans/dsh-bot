import type { Disposer, SystemPrompt } from './dsh.ts'
/** agent 预设读人设用的接口：ctx.pod 上的这一个方法。 */
interface PodPersonaSource {
  personaForSession(sessionId: string | undefined): string
}

/**
 * Pod agent 预设里的一行：在 agent 作用域里注册人设段落，遮蔽部署级人设。
 * 人设按会话动态取：每次组装提示词时，根据会话 id 找到所属 bot，取它的人设。
 * 和 dsh-persona 一样只能挂在预设里；挂到全局会和提示词注册表自己的人设段落撞名。
 */
export const name = 'pod-agent'

export const inject = ['systemPrompt', 'pod']

/** dsh-system-prompt 里部署级人设段落的名字。 */
const PERSONA_PREFIX_SECTION = 'deployment:persona-prefix'
const PERSONA_SUFFIX_SECTION = 'deployment:persona-suffix'

interface AgentContext {
  effect(execute: () => Disposer, label?: string): unknown
  readonly systemPrompt: SystemPrompt
  readonly pod: PodPersonaSource
}

export function apply(ctx: AgentContext): void {
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: PERSONA_PREFIX_SECTION,
        order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
        interpolate: false,
        text: (context) => ctx.pod.personaForSession(context.agent?.session.id),
      }),
    'pod: persona',
  )
  // 空的后缀遮蔽掉部署级后缀，和 dsh-persona 的默认行为一致。
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: PERSONA_SUFFIX_SECTION,
        order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
        text: '',
      }),
    'pod: persona suffix',
  )
}
