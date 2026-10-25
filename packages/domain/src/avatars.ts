/** bot 的头像：内置的鲸鱼图标（按角色配，30 种），或者你上传的图片。 */

import type { BotCard, BotRole } from './bots.ts'

/**
 * 内置图标的种类，每种一张鲸鱼图：小头像用头部特写，详情和选图标时用全身图。
 * lead（领导）只给主管；member 是万能助手，给看不出定位的 bot。
 * 旧版的七种（lead、writer、coder、researcher、analyst、tester、member）名字不变，存着的头像照常能用。
 */
export type BotIconKind =
  | 'lead'
  | 'coder'
  | 'researcher'
  | 'analyst'
  | 'writer'
  | 'translator'
  | 'assistant'
  | 'product'
  | 'project'
  | 'hr'
  | 'finance'
  | 'legal'
  | 'marketing'
  | 'sales'
  | 'designer'
  | 'operations'
  | 'data'
  | 'admin'
  | 'ceo'
  | 'sysadmin'
  | 'secretary'
  | 'tester'
  | 'engineer'
  | 'support'
  | 'reception'
  | 'intern'
  | 'devops'
  | 'architect'
  | 'broadcast'
  | 'member'

export const BOT_ICON_LABELS: Readonly<Record<BotIconKind, string>> = {
  lead: '领导',
  coder: '程序员',
  researcher: '研究员',
  analyst: '分析师',
  writer: '写作',
  translator: '翻译',
  assistant: '助理',
  product: '产品经理',
  project: '项目经理',
  hr: 'HR',
  finance: '财务会计',
  legal: '法务',
  marketing: '市场营销',
  sales: '销售',
  designer: '设计师',
  operations: '运营',
  data: '数据分析',
  admin: '行政',
  ceo: 'CEO',
  sysadmin: '系统管理员',
  secretary: '秘书',
  tester: '测试工程师',
  engineer: '研发工程师',
  support: '客服',
  reception: '前台',
  intern: '实习生',
  devops: '运维工程师',
  architect: '架构师',
  broadcast: '通知播报',
  member: '万能助手',
}

/** 成员能选的图标：除了只给主管的“领导”都能选；选图标时按这个顺序排。 */
export const MEMBER_ICONS: readonly BotIconKind[] = [
  'member',
  'coder',
  'engineer',
  'architect',
  'tester',
  'devops',
  'sysadmin',
  'researcher',
  'analyst',
  'data',
  'writer',
  'translator',
  'designer',
  'product',
  'project',
  'operations',
  'marketing',
  'sales',
  'support',
  'broadcast',
  'assistant',
  'secretary',
  'admin',
  'reception',
  'hr',
  'finance',
  'legal',
  'ceo',
  'intern',
]

export const BOT_ICONS: readonly BotIconKind[] = ['lead', ...MEMBER_ICONS]

const ICON_PREFIX = 'icon:'

/** 上传的头像图片：img: 加 Pod 存下的文件名。 */
const AVATAR_IMAGE = /^img:[a-z0-9-]+\.(png|jpg|jpeg|webp|gif)$/

export function isAvatarImage(avatar: string): boolean {
  return AVATAR_IMAGE.test(avatar)
}

/** 头像里存的内置图标（icon:种类）；不是内置图标时返回 undefined。 */
export function avatarIcon(avatar: string): BotIconKind | undefined {
  if (!avatar.startsWith(ICON_PREFIX)) return undefined
  const kind = avatar.slice(ICON_PREFIX.length)
  return BOT_ICONS.find((item) => item === kind)
}

export function iconAvatar(kind: BotIconKind): string {
  return `${ICON_PREFIX}${kind}`
}

/** 头像定好了没有：上传的图片或选好的内置图标。空串和旧版的一个字都算没定。 */
export function hasAvatar(avatar: string): boolean {
  return isAvatarImage(avatar) || avatarIcon(avatar) !== undefined
}

/** 在用的 bot 占着哪些图标。 */
export function takenIcons(bots: readonly { readonly avatar: string; readonly archivedAt: number | null }[]): ReadonlySet<BotIconKind> {
  return new Set(
    bots
      .filter((bot) => bot.archivedAt === null)
      .flatMap((bot) => {
        const kind = avatarIcon(bot.avatar)
        return kind === undefined ? [] : [kind]
      }),
  )
}

/** 猜图标时看的字段。 */
export interface IconSubject {
  readonly role: BotRole
  readonly name: string
  readonly title?: string
  readonly capabilities?: readonly string[]
  readonly card?: Pick<BotCard, 'duties' | 'strengths'>
}

/**
 * 每种图标的线索词。分数相同时排在前面的赢，所以越具体的越靠前：
 * “数据分析师”算数据分析不算分析师，“测试工程师”“运维工程师”不算研发工程师，“行情监控”“监控播报”算播报。
 */
const HINTS: readonly (readonly [BotIconKind, RegExp])[] = [
  ['devops', /运维|部署|服务监控|系统监控|告警|容器|集群|DevOps|docker|k8s|kubernetes|CI\/CD/i],
  ['broadcast', /播报|广播|通知|简报|早报|日报|周报|快讯|新闻|推送|盯盘|监控/],
  ['translator', /翻译|译者|口译|笔译|英语|英文|日语|外语|多语|本地化/],
  ['tester', /测试|评审|审查|审核|核查|检验|质检|校对|挑错|找问题|QA|bug|review/i],
  ['architect', /架构|系统设计|技术方案|技术选型/],
  ['sysadmin', /系统管理|网管|权限|账号管理|服务器管理|网络管理|IT支持/],
  ['designer', /设计师|设计|美术|视觉|插画|海报|配色|排版|剪辑|视频|动画|UI|UX|Figma/],
  ['legal', /法务|法律|合同|律师|合规|条款|知识产权|诉讼/],
  ['finance', /财务|会计|报销|记账|账目|税|预算|成本|发票|出纳/],
  ['hr', /HR|人事|招聘|人力|面试|简历|培训|绩效考核|员工关系/],
  ['sales', /销售|商务|BD|报价|签单|渠道|客户开发|成交/],
  ['marketing', /市场|营销|推广|品牌|广告|宣传|投放|SEO|增长|种草/i],
  ['operations', /运营|社群|社区|活动策划|用户运营|小红书|抖音/],
  ['support', /客服|售后|答疑|工单|投诉|用户支持|在线咨询/],
  ['reception', /前台|接待|访客|迎宾|总机/],
  ['intern', /实习|新人|学徒|练手/],
  ['secretary', /秘书|纪要|会议记录|公文|起草/],
  ['assistant', /助理|日程|待办|行程|私人/],
  ['ceo', /CEO|总裁|老板|创始人|董事|总经理/i],
  ['admin', /行政|后勤|采购|办公|物资|档案/],
  ['writer', /写手|写作|撰稿|文案|编辑|作者|文章|博客|润色|改稿|小说|公众号|内容创作|稿/],
  ['product', /产品经理|产品|需求|PRD|原型|用户体验/i],
  ['project', /项目经理|项目管理|排期|里程碑|进度跟踪|PMO/i],
  ['data', /数据|爬虫|抓取|清洗|ETL|SQL|数据库|可视化|图表|BI|报表/i],
  ['analyst', /分析|统计|指标|量化|洞察|评估|研判|绩效|财报/],
  ['researcher', /研究|调研|文献|资料|情报|学术|检索|论文|科研/],
  ['coder', /程序|代码|编程|前端|后端|全栈|脚本|重构|python|javascript|typescript|java|code|coder/i],
  ['engineer', /研发|工程师|开发|技术|算法|实现|嵌入式|硬件/],
]

/** 名字最要紧，其次是角色，再是每个能力标签；职责和擅长只算一次。 */
function iconScore(subject: IconSubject, pattern: RegExp): number {
  const tags = (subject.capabilities ?? []).filter((tag) => pattern.test(tag)).length
  const card = subject.card === undefined ? '' : `${subject.card.duties} ${subject.card.strengths}`
  return (pattern.test(subject.name) ? 3 : 0) + (pattern.test(subject.title ?? '') ? 2 : 0) + tags + (pattern.test(card) ? 1 : 0)
}

/** 有线索的图标和得分，从高到低；分数相同时保持 HINTS 里的先后。 */
export function rankBotIcons(subject: IconSubject): readonly (readonly [BotIconKind, number])[] {
  return HINTS.map(([kind, pattern]) => [kind, iconScore(subject, pattern)] as const)
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1])
}

/** 按名字、角色和能力猜一个图标：主管固定“领导”，没有线索时用万能助手。 */
export function guessBotIcon(subject: IconSubject): BotIconKind {
  if (subject.role === 'lead') return 'lead'
  return rankBotIcons(subject)[0]?.[0] ?? 'member'
}

/** 新 bot 的图标：挑最合适又没被占的；合适的都被占了就用万能助手，万能助手也被占了才重样。 */
export function pickBotIcon(subject: IconSubject, taken: ReadonlySet<BotIconKind>): BotIconKind {
  if (subject.role === 'lead') return 'lead'
  const ranked = rankBotIcons(subject).map(([kind]) => kind)
  const free = ranked.find((kind) => !taken.has(kind))
  if (free !== undefined) return free
  return taken.has('member') ? (ranked[0] ?? 'member') : 'member'
}

/**
 * 给一批还没定头像的 bot 一起配图标：线索最强的先挑，尽量谁也不和谁撞。
 * taken 是已经定了图标的 bot 占着的种类；分数相同时排在前面（建得早）的 bot 先挑。
 */
export function assignBotIcons(subjects: readonly (IconSubject & { readonly id: string })[], taken: ReadonlySet<BotIconKind>): ReadonlyMap<string, BotIconKind> {
  const used = new Set(taken)
  const chosen = new Map<string, BotIconKind>()
  const choose = (id: string, kind: BotIconKind): void => {
    chosen.set(id, kind)
    used.add(kind)
  }
  for (const subject of subjects) if (subject.role === 'lead') choose(subject.id, 'lead')
  const pairs = subjects
    .flatMap((subject, order) => (subject.role === 'lead' ? [] : rankBotIcons(subject).map(([kind, score]) => ({ id: subject.id, kind, score, order }))))
    .sort((left, right) => right.score - left.score || left.order - right.order)
  for (const pair of pairs) if (!chosen.has(pair.id) && !used.has(pair.kind)) choose(pair.id, pair.kind)
  for (const subject of subjects) if (!chosen.has(subject.id)) choose(subject.id, pickBotIcon(subject, used))
  return chosen
}

/** 内置图标换成鲸鱼图那一版的标记：老 bot 的小图标按新的 30 种重新配一次。 */
export const BOT_ICON_SET = 'whale-30'
