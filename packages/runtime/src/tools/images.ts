import type { ContentBlock, LiveAgent, LlmService, ToolRunContext } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import type { ToolValue } from './define.ts'

export interface ImageRef {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly width: number
  readonly height: number
}

interface AttachmentStore {
  saveImage(input: { readonly data: Uint8Array; readonly mediaType: string; readonly name?: string }): Promise<ImageRef>
}

/**
 * 看到截图的是下一步的模型：dsh 0.2.2 起问 agent.model（会话中途换了模型也算上），
 * 旧版本没有它，就看这一步的请求头，再不行看 agent 的选项。
 */
function nextRoute(agent: LiveAgent | undefined): { readonly provider: string; readonly model: string } | undefined {
  const selected = agent?.model?.current()
  if (selected !== undefined) return selected
  const loose = agent as unknown as { readonly session?: { readonly requestHeader?: () => { readonly config?: { readonly provider?: string; readonly model?: string } } | undefined }; readonly options?: { readonly provider?: string; readonly model?: string } } | undefined
  const routed = loose?.session?.requestHeader?.()?.config
  const provider = routed?.provider ?? loose?.options?.provider
  const model = routed?.model ?? loose?.options?.model
  return provider === undefined || model === undefined ? undefined : { provider, model }
}

/** 当前模型能不能看图：只有声明了图片输入的模型才把截图交给它。 */
async function seesImages(pod: PodRuntime, agent: LiveAgent | undefined, signal: AbortSignal): Promise<boolean> {
  const route = nextRoute(agent)
  const llm = pod.ctx.get('llm') as LlmService | undefined
  if (route === undefined || llm === undefined) return false
  const info = await llm.resolveModelInfo(route.provider, route.model, signal).catch(() => undefined)
  return info?.inputModalities?.includes('image') === true
}

/**
 * 截图存成附件交给模型：模型不能看图时返回 blind（只给文字），存不下时返回 undefined。
 * 结果里放在 image 字段，工具用 renderWithImage 渲染。
 */
export async function attachImage(pod: PodRuntime, exec: ToolRunContext, image: { readonly data: Uint8Array; readonly mediaType: string; readonly name: string }): Promise<ImageRef | 'blind' | undefined> {
  const store = pod.ctx.get('attachments') as AttachmentStore | undefined
  if (store === undefined || !(await seesImages(pod, exec.agent, exec.signal))) return 'blind'
  return store.saveImage(image).catch(() => undefined)
}

export function renderWithImage(value: ToolValue): ContentBlock[] {
  const { image, ...rest } = value as ToolValue & { readonly image?: ImageRef }
  const blocks: ContentBlock[] = [{ type: 'text', text: JSON.stringify(rest) }]
  return image === undefined ? blocks : [...blocks, { type: 'image', attachment: image }]
}
