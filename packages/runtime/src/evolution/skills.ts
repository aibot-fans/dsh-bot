import type { DatabaseSync } from 'node:sqlite'
import { fail, fnv1a, hasScript, looksInjected, newId, ok, skillName, t, truncate, type PodResult, type Skill, type Wait } from 'pod-domain'
import { getSkill, listSkills, saveSkill, setSkillStatus, skillVersions, type SkillVersion } from 'pod-store'
import type { Auditor } from '../core/audit.ts'
import type { PodBus } from '../core/bus.ts'

export interface SkillInput {
  readonly name: string
  readonly title: string
  /** 什么时候用。 */
  readonly description: string
  readonly content: string
  readonly scopeKind: 'bot' | 'team'
  readonly scopeId: string
}

/** 交给 dsh 技能注册表的一条技能。 */
export interface SkillRegistration {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly content: string
  readonly source: string
  readonly provider: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface SkillServiceDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly audit: Auditor
  readonly now: () => number
  readonly teamsOf: (botId: string) => readonly string[]
}

const MAX_CONTENT = 20_000

/**
 * 技能：把做成功的流程沉淀下来，写明何时用、步骤、容易出错的地方、输出模板。直接生效、留版本；
 * 带脚本的技能要你批准后才启用。技能按 bot 和团队交给 dsh 的技能注册表，bot 用 dsh 自带的 skill 工具加载。
 */
export class SkillService {
  private listeners: readonly ((botIds: readonly string[] | 'all') => void)[] = []
  private readonly deps: SkillServiceDeps

  constructor(deps: SkillServiceDeps) {
    this.deps = deps
  }

  onChange(listener: (botIds: readonly string[] | 'all') => void): () => void {
    this.listeners = [...this.listeners, listener]
    return () => {
      this.listeners = this.listeners.filter((item) => item !== listener)
    }
  }

  private changed(skill: Skill): void {
    this.deps.bus.emit({ type: 'skills' })
    const targets = skill.scopeKind === 'bot' ? [skill.scopeId] : 'all'
    for (const listener of this.listeners) listener(targets)
  }

  list(): readonly Skill[] {
    return listSkills(this.deps.db)
  }

  get(id: string): Skill | undefined {
    return getSkill(this.deps.db, id)
  }

  versions(id: string): readonly SkillVersion[] {
    return skillVersions(this.deps.db, id)
  }

  /** bot 能用的技能：自己的和所在团队的，只算已启用的。 */
  forBot(botId: string): readonly Skill[] {
    const teams = new Set(this.deps.teamsOf(botId))
    return listSkills(this.deps.db, { statuses: ['active'] }).filter((skill) => (skill.scopeKind === 'bot' ? skill.scopeId === botId : teams.has(skill.scopeId)))
  }

  registrations(botId: string): readonly SkillRegistration[] {
    return this.forBot(botId).map((skill) => ({
      name: skill.name,
      description: t('{title}：{truncate}', { title: skill.title, truncate: truncate(skill.description, 300) }),
      whenToUse: skill.description,
      content: `# ${skill.title}\n\n${skill.content}`,
      source: 'custom',
      provider: 'pod',
      metadata: { podSkillId: skill.id, version: skill.version },
    }))
  }

  /** 新建或更新技能。用户写的技能 bot 不能覆盖；带指令腔的内容（多半来自网页）一律拒绝。 */
  save(input: SkillInput, actor: string, source: Skill['source'], sourceRef: string | null, reason: string): PodResult<Skill> {
    const title = truncate(input.title.trim(), 40)
    const description = input.description.trim()
    const content = input.content.trim()
    if (title === '' || description === '' || content === '') return fail('invalid-input', t('技能要有名字、什么时候用和具体步骤'))
    if (content.length > MAX_CONTENT) return fail('invalid-input', t('技能内容太长（最多 {MAX_CONTENT} 字），只写步骤、易错点和模板', { MAX_CONTENT }))
    if (looksInjected(`${title}\n${description}\n${content}`)) return fail('forbidden', t('技能里有像是网页注入的指令（比如“忽略之前的规则”），不能保存'))
    const name = skillName(input.name) ?? skillName(title) ?? `skill-${fnv1a(`${input.scopeId}:${title}`).slice(0, 8)}`
    const existing = listSkills(this.deps.db, { scopeKind: input.scopeKind, scopeId: input.scopeId }).find((skill) => skill.name === name)
    if (existing !== undefined && existing.source === 'owner' && source !== 'owner') return fail('forbidden', t('技能「{title}」是用户写的，bot 不能改；可以另起一个名字', { title: existing.title }))
    const script = hasScript(content)
    const skill = saveSkill(this.deps.db, {
      id: existing?.id ?? newId('skill'),
      name,
      title,
      scopeKind: input.scopeKind,
      scopeId: input.scopeId,
      description,
      content,
      hasScript: script,
      status: script && source !== 'owner' ? 'pending' : 'active',
      source,
      sourceRef,
      createdBy: actor,
      now: this.deps.now(),
      reason,
    })
    this.deps.audit.record('skill.save', actor, skill.id, { name, version: skill.version, script, source })
    this.changed(skill)
    return ok(skill)
  }

  setStatus(id: string, status: Skill['status'], actor: string): PodResult<Skill> {
    const skill = setSkillStatus(this.deps.db, id, status, this.deps.now())
    if (skill === undefined) return fail('not-found', t('找不到这个技能'))
    this.deps.audit.record('skill.status', actor, id, { status })
    this.changed(skill)
    return ok(skill)
  }

  /** 回到某个旧版本：内容恢复，版本号继续往上加。 */
  rollback(id: string, version: number, actor: string): PodResult<Skill> {
    const skill = this.get(id)
    const target = this.versions(id).find((item) => item.version === version)
    if (skill === undefined || target === undefined) return fail('not-found', t('找不到这个版本'))
    return this.save(
      { name: skill.name, title: target.title, description: target.description, content: target.content, scopeKind: skill.scopeKind, scopeId: skill.scopeId },
      actor,
      skill.source,
      skill.sourceRef,
      `回到第 ${version} 版`,
    )
  }

  /** 带脚本的技能等你批准：答复里有“批准”就启用，否则停用。 */
  resolveApproval(wait: Wait, answer: string): boolean {
    const id = typeof wait.data.skillId === 'string' ? wait.data.skillId : undefined
    if (id === undefined) return false
    const approved = /^(批准|同意|可以|启用|approve|yes|ok)/i.test(answer.trim())
    this.setStatus(id, approved ? 'active' : 'archived', 'owner')
    return false
  }
}
