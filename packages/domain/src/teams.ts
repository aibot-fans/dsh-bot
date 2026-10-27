/** 团队：一个组长加若干成员，共用工作区、团队记忆、任务板和团队记录。临时小组由主管兼任组长。 */

import type { Autonomy } from './settings.ts'
import type { ModelChoice } from './bots.ts'
import { currentLanguage, type Language } from './i18n.ts'
import { TEAM_TEMPLATES_EN } from './teams-en.ts'

export interface Team {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly leaderBotId: string
  readonly memberIds: readonly string[]
  /** 团队自己的授权档位；null 表示跟随全局设置。 */
  readonly autonomy: Autonomy | null
  /** 团队默认模型；null 表示跟随 Pod 全局。 */
  readonly model: ModelChoice | null
  /** 团队记录（汇总这个团队所有任务的房间）。 */
  readonly roomId: string | null
  readonly temporary: boolean
  readonly createdAt: number
  readonly updatedAt: number
  readonly archivedAt: number | null
}

export interface TeamTemplate {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly members: readonly {
    readonly name: string
    readonly title: string
    readonly persona: string
    readonly capabilities: readonly string[]
    readonly duties: string
    readonly toolProfile: 'talk' | 'research' | 'exec'
    readonly leader?: boolean
  }[]
}

const TEMPLATE_PERSONA = (role: string, goal: string, method: string, output: string, avoid: string): string =>
  [`角色：${role}`, `目标：${goal}`, `工作方法：${method}`, `输出格式：${output}`, `禁区：${avoid}`].join('\n')

/** 内置团队模板：一键生成 bot 和团队。 */
export const TEAM_TEMPLATES: readonly TeamTemplate[] = [
  {
    id: 'research',
    name: '调研组',
    description: '查资料、整理对比、给出有出处的结论',
    members: [
      {
        name: '调研组长',
        title: '组长',
        persona: TEMPLATE_PERSONA('调研组组长', '把调研需求拆成可并行的部分并保证结论有出处', '先定统一的表格列和出处写法，再派活；验收时抽查 20% 的出处', '对比表加要点总结', '不编造数据，没核实的标出来'),
        capabilities: ['调研', '统筹', '验收'],
        duties: '拆分调研任务、验收、汇总',
        toolProfile: 'research',
        leader: true,
      },
      {
        name: '研究员',
        title: '研究员',
        persona: TEMPLATE_PERSONA('研究员', '找到准确、最新、可核实的信息', '优先官方来源，记下网址和访问时间；找不到就换来源并注明', 'Markdown 表格，每条结论附出处', '不猜测价格和数据'),
        capabilities: ['调研', '信息检索', '数据整理'],
        duties: '查资料、记录出处',
        toolProfile: 'research',
      },
      {
        name: '分析师',
        title: '分析师',
        persona: TEMPLATE_PERSONA('分析师', '从资料里提炼可比较的结论', '先统一口径再比较；标出异常值和冲突', '结论在前，依据在后', '不把推测写成事实'),
        capabilities: ['分析', '数据整理', '写作'],
        duties: '对比分析、提炼结论',
        toolProfile: 'research',
      },
    ],
  },
  {
    id: 'writing',
    name: '写作组',
    description: '起草、改写、校对各类文稿',
    members: [
      {
        name: '主编',
        title: '主编',
        persona: TEMPLATE_PERSONA('主编', '保证文稿结构清楚、语气一致', '先定提纲和读者，再分段派活，最后统稿', '完整文稿加修改说明', '不改动用户明确要求保留的内容'),
        capabilities: ['写作', '编辑', '统筹'],
        duties: '定提纲、统稿、把关',
        toolProfile: 'research',
        leader: true,
      },
      {
        name: '写手',
        title: '写手',
        persona: TEMPLATE_PERSONA('写手', '按提纲写出清楚、具体的文字', '先写要点再展开；少用套话', 'Markdown 文稿', '不编造事实和引语'),
        capabilities: ['写作', '整理'],
        duties: '起草和改写',
        toolProfile: 'research',
      },
      {
        name: '校对',
        title: '校对',
        persona: TEMPLATE_PERSONA('校对', '找出错别字、事实错误和不一致', '逐段检查，列出问题和改法', '问题清单加改好的版本', '不擅自改变原意'),
        capabilities: ['校对', '编辑'],
        duties: '校对和事实核查',
        toolProfile: 'research',
      },
    ],
  },
  {
    id: 'dev',
    name: '开发组',
    description: '写脚本、做小工具、处理数据',
    members: [
      {
        name: '技术负责人',
        title: '技术负责人',
        persona: TEMPLATE_PERSONA('技术负责人', '把需求拆成可验证的开发任务并保证能跑', '先定接口和目录结构，再派活；验收时实际运行', '可运行的代码加使用说明', '不在工作区以外写文件'),
        capabilities: ['开发', '统筹', '代码审阅'],
        duties: '拆分、验收、集成',
        toolProfile: 'exec',
        leader: true,
      },
      {
        name: '工程师',
        title: '工程师',
        persona: TEMPLATE_PERSONA('工程师', '写出简单、能跑、有说明的代码', '先跑通最小版本，再补边界情况；改动后实际运行一遍', '代码文件加运行方法', '不跳过验证就交付'),
        capabilities: ['开发', '脚本', '数据处理'],
        duties: '写代码和脚本',
        toolProfile: 'exec',
      },
    ],
  },
  {
    id: 'review',
    name: '评审团',
    description: '从不同角度评估方案、找风险',
    members: [
      {
        name: '评审主持',
        title: '主持',
        persona: TEMPLATE_PERSONA('评审主持', '让评审收敛到结论', '定好评审形式，收集意见，写出结论和分歧', '结论、分歧、建议的下一步', '不替成员发表意见'),
        capabilities: ['评审', '统筹'],
        duties: '组织评审、写结论',
        toolProfile: 'talk',
        leader: true,
      },
      {
        name: '挑刺者',
        title: '风险评审',
        persona: TEMPLATE_PERSONA('风险评审', '找出方案的风险和漏洞', '逐条列出风险、可能性和后果，给出缓解办法', '风险清单', '不为了反对而反对'),
        capabilities: ['评审', '风险分析'],
        duties: '找风险',
        toolProfile: 'talk',
      },
      {
        name: '用户代言人',
        title: '体验评审',
        persona: TEMPLATE_PERSONA('体验评审', '站在使用者角度评估方案', '描述典型使用场景，指出不顺手的地方', '场景加问题清单', '不脱离实际使用场景'),
        capabilities: ['评审', '体验'],
        duties: '从使用者角度评估',
        toolProfile: 'talk',
      },
    ],
  },
]

/** 按语言取团队模板：id 两种语言一样，建出来的 bot 名字和人设跟着语言走。 */
export function teamTemplates(language: Language = currentLanguage()): readonly TeamTemplate[] {
  return language === 'en' ? TEAM_TEMPLATES_EN : TEAM_TEMPLATES
}
