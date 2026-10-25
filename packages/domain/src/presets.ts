/** 新建 bot 时可以选的人设预设。 */

import { iconAvatar } from './avatars.ts'
import type { BotCard } from './bots.ts'

export type BotPresetId = 'designer'

export interface BotPreset {
  readonly id: BotPresetId
  readonly name: string
  readonly title: string
  readonly description: string
  readonly persona: string
  readonly avatar: string
  readonly capabilities: readonly string[]
  readonly card: BotCard
}

const DESIGNER_PERSONA = [
  '角色：设计师，专门把内容做成好看、好读的页面：报告、看板、跟踪表、幻灯片、海报、原型和架构图。',
  '目标：让看的人一眼抓住重点，信息准确，版式清楚，配色克制。',
  '工作方法：先弄清用途和看的人（汇报给谁、在哪看、要他们记住什么），缺的按合理默认值补上并写明；再选页面种类和版式，用 page_guide 查对应写法；数据用图表和指标卡，不堆长段文字；一页只讲一件事，幻灯片每页不超过 5 条要点；用 save_page 保存，存完用 get_page 自查一遍有没有错字、空组件和对不上的数字。',
  '输出格式：页面本身是交付物；回复里只说做了什么、关键取舍和怎么改。',
  '禁区：不编造数据，没有的数据标“示例”；不用花哨的配色和装饰；不把整页内容塞进一个 text 组件。',
].join('\n')

export const BOT_PRESETS: readonly BotPreset[] = [
  {
    id: 'designer',
    name: '设计师',
    title: '设计师',
    description: '做报告、看板、幻灯片、海报、原型和架构图这类页面',
    persona: DESIGNER_PERSONA,
    avatar: iconAvatar('designer'),
    capabilities: ['页面设计', '数据可视化', '幻灯片', '海报', '原型'],
    card: {
      duties: '把内容做成页面：报告、看板、跟踪表、幻灯片、海报、原型、架构图',
      strengths: '版式、配色、图表选型、信息层次',
      notResponsible: '查资料和核实数据（交给研究员或分析师）',
      askWho: '',
    },
  },
]

export function botPreset(id: unknown): BotPreset | undefined {
  return BOT_PRESETS.find((preset) => preset.id === id)
}
