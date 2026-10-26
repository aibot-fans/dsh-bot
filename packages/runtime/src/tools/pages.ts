import { PAGE_ACCENTS, PAGE_KINDS, PAGE_KIND_LABELS, compactDoc, readPageKind, type PageKind, type PodSession } from 'pod-domain'
import type { JsonSchema, ToolDefinition } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { failure, int, oneOf, podTool, str, success, text } from './define.ts'
import { pageGuide } from './page-guide.ts'

const objects = (description: string): JsonSchema => ({ type: 'array', items: { type: 'object' }, description })

/** 模型有时把数组或对象写成 JSON 字符串，这里认一下。 */
function jsonish(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return value
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value
  }
}

function kindArg(value: unknown): PageKind | undefined | 'invalid' {
  if (value === undefined || value === null || value === '') return undefined
  return readPageKind(value) ?? 'invalid'
}

/**
 * 页面工具：save_page 新建或整份更新页面（存一版，对话里发卡片），get_page 读当前内容（改之前先读），
 * list_pages 看有哪些页面，page_guide 看每种页面的写法和模板。咨询会话不装。
 */
export function pageTools(pod: PodRuntime, session: PodSession): readonly ToolDefinition[] {
  const current = (): PodSession => pod.registry.get(session.id) ?? session
  const me = () => pod.bots.get(current().botId)

  const save = podTool({
    name: 'save_page',
    description:
      '把报告、看板、跟踪表、幻灯片、海报、原型或架构图做成页面：你只填组件数据，dsh-bot 负责排版、配色和交互，保存后对话里会出现页面卡片。不写 id 是新建；写 id 是整份更新（先 get_page 读出来再改），每次保存都是新的一版。第一次做某种页面先看 page_guide。',
    properties: {
      id: str('要更新的页面 id；新建时不写'),
      title: str('标题；更新时不写就沿用'),
      kind: oneOf(`种类：${PAGE_KINDS.map((kind) => `${kind} ${PAGE_KIND_LABELS[kind]}`).join('、')}；更新时不写就沿用`, PAGE_KINDS),
      note: str('这一版做了什么（一句话，出现在版本记录里）'),
      subtitle: str('副标题'),
      accent: oneOf('主色，默认 blue', PAGE_ACCENTS),
      blocks: objects('组件列表：报告、看板、跟踪表、图示必填，海报可选。每项写 type 和数据，格式见 page_guide'),
      slides: objects('幻灯片的每一页 {layout, title, subtitle, blocks, right, notes}（kind=slides）'),
      screens: objects('原型的每一屏 {id, title, blocks}（kind=prototype）'),
      device: oneOf('原型的设备，默认 phone', ['phone', 'tablet', 'desktop']),
      poster: {
        type: 'object',
        description: '海报的版式和文字（kind=poster）',
        properties: {
          size: oneOf('尺寸', ['a4', 'portrait', 'square', 'landscape', 'story']),
          eyebrow: str('顶上的小字'),
          headline: str('大标题'),
          subheadline: str('副标题，时间地点等'),
          footer: str('底部一行'),
          background: oneOf('背景', ['accent', 'light', 'dark', 'gradient']),
        },
      },
    },
    timeoutMs: 60_000,
    parse: (args) => {
      const id = text(args, 'id')
      const kind = kindArg(args.kind)
      if (kind === 'invalid') return `kind 只能是 ${PAGE_KINDS.join(' / ')}`
      if (id === '' && kind === undefined) return `新建页面要写 kind（${PAGE_KINDS.join(' / ')}）`
      if (id === '' && text(args, 'title') === '') return '新建页面要写 title'
      const content = {
        subtitle: args.subtitle,
        accent: args.accent,
        blocks: jsonish(args.blocks),
        slides: jsonish(args.slides),
        screens: jsonish(args.screens),
        device: args.device,
        poster: jsonish(args.poster),
      }
      return { id: id === '' ? undefined : id, title: text(args, 'title'), kind, note: text(args, 'note'), content }
    },
    run: async (input) => {
      const result = await pod.pages.save(current(), input)
      if (!result.ok) return failure(result.error.message)
      const { page, created, summary } = result.value
      return success(
        `${created ? '已新建' : '已更新'}${PAGE_KIND_LABELS[page.kind]}「${page.title}」，第 ${page.version} 版（${summary}），页面卡片已经发到对话里。之后要改：get_page 读出来，改好用 save_page 带上 id 保存。`,
        { id: page.id, version: page.version },
      )
    },
  })

  const read = podTool({
    name: 'get_page',
    description: '读一个页面的内容（组件数据）。改页面之前先读最新一版，改好后用 save_page 带上 id 整份保存。',
    properties: { id: str('页面 id'), version: int('第几版；不写是最新一版') },
    required: ['id'],
    concurrent: true,
    parse: (args) => (text(args, 'id') === '' ? '要写页面 id' : { id: text(args, 'id'), version: typeof args.version === 'number' ? args.version : undefined }),
    run: ({ id, version }) => {
      const bot = me()
      const page = pod.pages.get(id)
      if (bot === undefined || page === undefined || page.deletedAt !== null || !pod.pages.canSee(bot, page)) return failure(`没有 id 为 ${id} 的页面，或者你看不到它（list_pages 看你能用的页面）`)
      const found = pod.pages.version(page, version)
      if (found === undefined) return failure(`这个页面没有第 ${version ?? page.version} 版（一共 ${page.version} 版）`)
      return success(`${PAGE_KIND_LABELS[found.kind]}「${found.title}」第 ${found.version} 版（最新是第 ${page.version} 版）`, {
        id: page.id,
        title: found.title,
        kind: found.kind,
        version: found.version,
        latest: page.version,
        content: compactDoc(found.kind, found.doc),
      })
    },
  })

  const list = podTool({
    name: 'list_pages',
    description: '列出你能看到的页面（你做的、你所在对话里的）：id、标题、种类、第几版、更新时间。',
    properties: { query: str('按标题筛') },
    concurrent: true,
    parse: (args) => ({ query: text(args, 'query').toLowerCase() }),
    run: ({ query }) => {
      const bot = me()
      if (bot === undefined) return failure('找不到你自己')
      const pages = pod.pages.visibleTo(bot).filter((page) => query === '' || page.title.toLowerCase().includes(query))
      if (pages.length === 0) return success(query === '' ? '还没有页面。' : '没有标题里带这个词的页面。')
      return success(
        pages
          .slice(0, 60)
          .map((page) => `- ${page.id}「${page.title}」${PAGE_KIND_LABELS[page.kind]} · 第 ${page.version} 版 · ${pod.pages.stamp(page.updatedAt)}${page.botId === bot.id ? '' : ` · ${pod.bots.get(page.botId)?.name ?? '别的 bot'}做的`}`)
          .join('\n'),
      )
    },
  })

  const guide = podTool({
    name: 'page_guide',
    description: '看页面的写法：组件清单和字段、每种页面（报告、看板、跟踪表、幻灯片、海报、原型、图示）的结构建议和可以直接改的模板。',
    properties: { kind: oneOf('想做的种类；不写给总览和组件清单', PAGE_KINDS) },
    concurrent: true,
    parse: (args) => {
      const kind = kindArg(args.kind)
      return kind === 'invalid' ? `kind 只能是 ${PAGE_KINDS.join(' / ')}` : { kind }
    },
    run: ({ kind }) => success(pageGuide(kind)),
  })

  return [save, read, list, guide]
}
