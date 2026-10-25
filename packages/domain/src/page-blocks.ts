/**
 * 页面内容的结构：bot 只填数据和文字，Pod 按组件排版。
 * 这里是校验之后的形状，可选项都补成了默认值；bot 写的时候可以省略。
 */

export type PageAccent = 'blue' | 'teal' | 'green' | 'orange' | 'red' | 'purple' | 'gray'
export const PAGE_ACCENTS: readonly PageAccent[] = ['blue', 'teal', 'green', 'orange', 'red', 'purple', 'gray']

export type BlockWidth = 'full' | 'half' | 'third' | 'two-thirds' | 'quarter'
export const BLOCK_WIDTHS: readonly BlockWidth[] = ['full', 'half', 'third', 'two-thirds', 'quarter']

export type Tone = 'info' | 'ok' | 'warn' | 'danger'
export const TONES: readonly Tone[] = ['info', 'ok', 'warn', 'danger']

export type ChartType = 'line' | 'bar' | 'area' | 'pie'
export const CHART_TYPES: readonly ChartType[] = ['line', 'bar', 'area', 'pie']

export type ColumnType = 'text' | 'number' | 'money' | 'percent' | 'date' | 'status' | 'progress' | 'tag'
export const COLUMN_TYPES: readonly ColumnType[] = ['text', 'number', 'money', 'percent', 'date', 'status', 'progress', 'tag']

export type NodeShape = 'box' | 'round' | 'database' | 'person' | 'cloud' | 'start' | 'end' | 'decision'
export const NODE_SHAPES: readonly NodeShape[] = ['box', 'round', 'database', 'person', 'cloud', 'start', 'end', 'decision']

export type StepStatus = 'done' | 'active' | 'todo' | 'risk'
export const STEP_STATUSES: readonly StepStatus[] = ['done', 'active', 'todo', 'risk']

export type Direction = 'right' | 'down'

interface Base {
  /** 看板网格里占多宽。 */
  readonly width: BlockWidth
  /** 原型里点它跳到哪一屏（屏的 id），空串表示不跳。 */
  readonly goto: string
}

export interface HeadingBlock extends Base {
  readonly type: 'heading'
  readonly text: string
  readonly level: 1 | 2 | 3
}

/** 正文：简单的 Markdown（段落、粗体、斜体、行内代码、链接、列表、小标题、引用）。 */
export interface TextBlock extends Base {
  readonly type: 'text'
  readonly text: string
}

export interface Metric {
  readonly label: string
  readonly value: string
  readonly unit: string
  /** 变化，比如 +3.2%、-120。 */
  readonly delta: string
  /** 涨好还是跌好；none 表示不标色。 */
  readonly good: 'up' | 'down' | 'none'
  readonly trend: readonly number[]
  readonly note: string
}

export interface MetricsBlock extends Base {
  readonly type: 'metrics'
  readonly items: readonly Metric[]
}

export interface Series {
  readonly name: string
  readonly values: readonly (number | null)[]
}

export interface ChartBlock extends Base {
  readonly type: 'chart'
  readonly chart: ChartType
  readonly title: string
  readonly labels: readonly string[]
  readonly series: readonly Series[]
  readonly unit: string
  readonly stacked: boolean
  readonly horizontal: boolean
  readonly note: string
}

export interface TableColumn {
  readonly label: string
  readonly type: ColumnType
}

export type Cell = string | number | null

export interface TableBlock extends Base {
  readonly type: 'table'
  readonly title: string
  readonly columns: readonly TableColumn[]
  readonly rows: readonly (readonly Cell[])[]
  readonly note: string
}

export interface GraphNode {
  readonly id: string
  readonly label: string
  readonly shape: NodeShape
  readonly group: string
  readonly note: string
}

export interface GraphEdge {
  readonly from: string
  readonly to: string
  readonly label: string
  readonly dashed: boolean
}

export interface GraphGroup {
  readonly id: string
  readonly label: string
}

/** 流程图和图示共用一套节点、连线和自动排版；流程图的节点默认是步骤，图示默认是方框。 */
export interface GraphBlock extends Base {
  readonly type: 'flow' | 'diagram'
  readonly title: string
  readonly direction: Direction
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly groups: readonly GraphGroup[]
}

export interface TimelineItem {
  readonly date: string
  readonly title: string
  readonly note: string
  readonly status: StepStatus
}

export interface TimelineBlock extends Base {
  readonly type: 'timeline'
  readonly title: string
  readonly items: readonly TimelineItem[]
}

export interface HeatmapBlock extends Base {
  readonly type: 'heatmap'
  readonly title: string
  readonly rows: readonly string[]
  readonly columns: readonly string[]
  readonly values: readonly (readonly (number | null)[])[]
  readonly unit: string
  readonly note: string
}

export interface BoardCard {
  readonly title: string
  readonly note: string
  readonly tag: string
  readonly owner: string
  readonly status: string
}

export interface BoardColumn {
  readonly title: string
  readonly cards: readonly BoardCard[]
}

/** 分栏看板（待办、进行中、完成……）。 */
export interface BoardBlock extends Base {
  readonly type: 'board'
  readonly title: string
  readonly columns: readonly BoardColumn[]
}

export interface ProgressItem {
  readonly label: string
  readonly value: number
  readonly max: number
  readonly note: string
}

export interface ProgressBlock extends Base {
  readonly type: 'progress'
  readonly title: string
  readonly items: readonly ProgressItem[]
}

export interface CalloutBlock extends Base {
  readonly type: 'callout'
  readonly tone: Tone
  readonly title: string
  readonly text: string
}

export interface ListItem {
  readonly text: string
  readonly done: boolean
}

export interface ListBlock extends Base {
  readonly type: 'list'
  readonly style: 'bullet' | 'number' | 'check'
  readonly items: readonly ListItem[]
}

export interface QuoteBlock extends Base {
  readonly type: 'quote'
  readonly text: string
  readonly by: string
}

export interface CodeBlock extends Base {
  readonly type: 'code'
  readonly code: string
  readonly language: string
}

/** 图片：src 是 asset:哈希（保存时从工作区路径转来的）；没有图时画一个占位框。 */
export interface ImageBlock extends Base {
  readonly type: 'image'
  readonly src: string
  readonly alt: string
  readonly caption: string
  /** 高度（像素），0 表示按图片比例。 */
  readonly height: number
}

export interface DividerBlock extends Base {
  readonly type: 'divider'
}

/** 组件表达不了的版式：一段 HTML 片段，保存时清洗，显示时 CSP 再兜底。 */
export interface HtmlBlock extends Base {
  readonly type: 'html'
  readonly html: string
}

// ---------- 原型用的界面组件 ----------

export interface AppBarBlock extends Base {
  readonly type: 'appbar'
  readonly title: string
  /** 返回按钮跳到哪一屏，空串表示没有返回按钮。 */
  readonly back: string
  readonly actions: readonly string[]
}

export interface TabBarItem {
  readonly label: string
  readonly goto: string
  readonly active: boolean
}

export interface TabBarBlock extends Base {
  readonly type: 'tabbar'
  readonly items: readonly TabBarItem[]
}

export interface ButtonBlock extends Base {
  readonly type: 'button'
  readonly label: string
  readonly variant: 'primary' | 'secondary' | 'ghost' | 'danger'
}

export interface InputBlock extends Base {
  readonly type: 'input'
  readonly label: string
  readonly placeholder: string
  readonly value: string
  readonly multiline: boolean
}

export interface ToggleBlock extends Base {
  readonly type: 'toggle'
  readonly label: string
  readonly on: boolean
  readonly note: string
}

export interface CardBlock extends Base {
  readonly type: 'card'
  readonly title: string
  readonly text: string
  readonly meta: string
  readonly tag: string
}

export interface RowItem {
  readonly title: string
  readonly subtitle: string
  readonly meta: string
  readonly goto: string
}

/** 原型里的列表行（设置项、消息列表……）。 */
export interface RowsBlock extends Base {
  readonly type: 'rows'
  readonly items: readonly RowItem[]
}

export interface SegmentedBlock extends Base {
  readonly type: 'segmented'
  readonly items: readonly string[]
  readonly active: number
}

export type PageBlock =
  | HeadingBlock
  | TextBlock
  | MetricsBlock
  | ChartBlock
  | TableBlock
  | GraphBlock
  | TimelineBlock
  | HeatmapBlock
  | BoardBlock
  | ProgressBlock
  | CalloutBlock
  | ListBlock
  | QuoteBlock
  | CodeBlock
  | ImageBlock
  | DividerBlock
  | HtmlBlock
  | AppBarBlock
  | TabBarBlock
  | ButtonBlock
  | InputBlock
  | ToggleBlock
  | CardBlock
  | RowsBlock
  | SegmentedBlock

export type BlockType = PageBlock['type']

export const BLOCK_TYPES: readonly BlockType[] = [
  'heading',
  'text',
  'metrics',
  'chart',
  'table',
  'flow',
  'diagram',
  'timeline',
  'heatmap',
  'board',
  'progress',
  'callout',
  'list',
  'quote',
  'code',
  'image',
  'divider',
  'html',
  'appbar',
  'tabbar',
  'button',
  'input',
  'toggle',
  'card',
  'rows',
  'segmented',
]

export type SlideLayout = 'title' | 'section' | 'content' | 'two-column' | 'quote' | 'end'
export const SLIDE_LAYOUTS: readonly SlideLayout[] = ['title', 'section', 'content', 'two-column', 'quote', 'end']

export interface Slide {
  readonly layout: SlideLayout
  readonly title: string
  readonly subtitle: string
  readonly blocks: readonly PageBlock[]
  /** 左右两栏版式的右栏；左栏用 blocks。 */
  readonly right: readonly PageBlock[]
  /** 演讲备注。 */
  readonly notes: string
}

export interface Screen {
  readonly id: string
  readonly title: string
  readonly blocks: readonly PageBlock[]
}

export type Device = 'phone' | 'tablet' | 'desktop'
export const DEVICES: readonly Device[] = ['phone', 'tablet', 'desktop']

export type PosterSize = 'a4' | 'portrait' | 'square' | 'landscape' | 'story'
export const POSTER_SIZES: readonly PosterSize[] = ['a4', 'portrait', 'square', 'landscape', 'story']

/** 海报画幅（CSS 像素）。 */
export const POSTER_DIMENSIONS: Readonly<Record<PosterSize, { readonly width: number; readonly height: number }>> = {
  a4: { width: 794, height: 1123 },
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
  landscape: { width: 1600, height: 900 },
  story: { width: 1080, height: 1920 },
}

export type PosterBackground = 'accent' | 'light' | 'dark' | 'gradient'
export const POSTER_BACKGROUNDS: readonly PosterBackground[] = ['accent', 'light', 'dark', 'gradient']

export interface Poster {
  readonly size: PosterSize
  readonly eyebrow: string
  readonly headline: string
  readonly subheadline: string
  readonly footer: string
  readonly background: PosterBackground
}

export interface PageDoc {
  readonly subtitle: string
  readonly accent: PageAccent
  /** 报告、看板、跟踪表、图示的正文；海报的主体。 */
  readonly blocks: readonly PageBlock[]
  readonly slides: readonly Slide[]
  readonly screens: readonly Screen[]
  readonly device: Device
  readonly poster: Poster | null
}

export const EMPTY_PAGE_DOC: PageDoc = {
  subtitle: '',
  accent: 'blue',
  blocks: [],
  slides: [],
  screens: [],
  device: 'phone',
  poster: null,
}
