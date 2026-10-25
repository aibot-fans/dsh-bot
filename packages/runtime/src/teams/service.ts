import type { DatabaseSync } from 'node:sqlite'
import {
  TEAM_TEMPLATES,
  type TeamTemplate,
  fail,
  newId,
  ok,
  parseModelChoice,
  readBool,
  readEnum,
  readId,
  readObject,
  readString,
  readStringArray,
  truncate,
  type PodResult,
  type Team,
} from 'pod-domain'
import { addRoomMember, getTeam, insertTeam, listTeams, purgeArchivedTeams, setTeamMembers, transaction, updateTeam, type TeamPatch } from 'pod-store'
import type { BotService } from '../bots/service.ts'
import type { Auditor } from '../core/audit.ts'
import type { PodBus } from '../core/bus.ts'
import { RECYCLE_DAYS } from '../core/maintenance.ts'

export interface TeamServiceDeps {
  readonly db: DatabaseSync
  readonly bus: PodBus
  readonly bots: BotService
  readonly audit: Auditor
  readonly now: () => number
}

/** 正式团队：组长、成员、团队记录、团队自己的档位和默认模型。临时小组不建团队，由主管兼任组长。 */
export class TeamService {
  private readonly deps: TeamServiceDeps

  constructor(deps: TeamServiceDeps) {
    this.deps = deps
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  list(): readonly Team[] {
    return listTeams(this.db).filter((team) => team.archivedAt === null)
  }

  all(): readonly Team[] {
    return listTeams(this.db)
  }

  get(id: string): Team | undefined {
    return getTeam(this.db, id)
  }

  /** 按名字或 id 找在用的团队。 */
  resolve(nameOrId: string): Team | undefined {
    const key = nameOrId.trim().toLowerCase()
    return this.list().find((team) => team.id === nameOrId || team.name.toLowerCase() === key)
  }

  /** 某个 bot 所在的团队。 */
  teamsOf(botId: string): readonly Team[] {
    return this.list().filter((team) => team.memberIds.includes(botId))
  }

  private changed(team: Team, kind: string, actor: string): Team {
    this.deps.audit.record(kind, actor, team.id, { name: team.name })
    this.deps.bus.emit({ type: 'teams' })
    return team
  }

  /** 新建团队。团队不再单独建“团队记录”房间：每个任务只有一个群聊，团队的任务各自建群。 */
  createTeam(input: { readonly name: string; readonly description: string; readonly leaderBotId: string; readonly memberIds: readonly string[]; readonly temporary: boolean }, actor: string): PodResult<Team> {
    const name = truncate(input.name.trim(), 24)
    if (name === '') return fail('invalid-input', '团队要有名字')
    if (this.deps.bots.activeBot(input.leaderBotId) === undefined) return fail('not-found', '找不到组长')
    const unknown = input.memberIds.filter((id) => this.deps.bots.activeBot(id) === undefined)
    if (unknown.length > 0) return fail('not-found', `找不到成员：${unknown.join('、')}`)
    if (this.list().some((team) => team.name === name)) return fail('conflict', `已经有叫「${name}」的团队`)
    const now = this.deps.now()
    const team = insertTeam(this.db, { id: newId('team'), name, description: input.description, leaderBotId: input.leaderBotId, memberIds: input.memberIds, temporary: input.temporary, now })
    return ok(this.changed(team, 'team.create', actor))
  }

  /** 页面上的新建：{ name, description, leaderBotId, memberIds }。 */
  create(input: unknown, actor = 'owner'): PodResult<Team> {
    const leaderBotId = readId(input, 'leaderBotId')
    if (leaderBotId === undefined) return fail('invalid-input', '要选一个组长')
    return this.createTeam(
      {
        name: readString(input, 'name'),
        description: readString(input, 'description'),
        leaderBotId,
        memberIds: readStringArray(input, 'memberIds') ?? [],
        temporary: readBool(input, 'temporary') === true,
      },
      actor,
    )
  }

  /** 修改名字、组长、成员、档位、默认模型：{ id, patch }。 */
  update(input: unknown, actor = 'owner'): PodResult<Team> {
    const id = readId(input, 'id')
    if (id === undefined) return fail('invalid-input', '缺少团队 id')
    const current = this.get(id)
    if (current === undefined || current.archivedAt !== null) return fail('not-found', '找不到这个团队')
    const raw = readObject(input, 'patch')
    const leader = readId(raw, 'leaderBotId')
    if (leader !== undefined && this.deps.bots.activeBot(leader) === undefined) return fail('not-found', '找不到新组长')
    const model = parseModelChoice((raw as Readonly<Record<string, unknown>> | undefined)?.model)
    if (!model.ok) return fail('invalid-input', model.message)
    const autonomyRaw = (raw as Readonly<Record<string, unknown>> | undefined)?.autonomy
    const patch: TeamPatch = {
      ...(readString(raw, 'name') === '' ? {} : { name: truncate(readString(raw, 'name'), 24) }),
      ...((raw as Readonly<Record<string, unknown>> | undefined)?.description === undefined ? {} : { description: readString(raw, 'description') }),
      ...(leader === undefined ? {} : { leaderBotId: leader }),
      ...(autonomyRaw === undefined ? {} : { autonomy: readEnum(raw, 'autonomy', ['hands-off', 'careful'] as const) ?? null }),
      ...(model.value === undefined ? {} : { model: model.value }),
      ...(readBool(raw, 'temporary') === undefined ? {} : { temporary: readBool(raw, 'temporary') }),
    }
    const members = readStringArray(raw, 'memberIds')
    const updated = transaction(this.db, () => {
      const next = updateTeam(this.db, id, patch, this.deps.now()) ?? current
      if (members !== undefined || leader !== undefined) {
        setTeamMembers(this.db, id, [next.leaderBotId, ...(members ?? next.memberIds)], this.deps.now())
      }
      return this.get(id) ?? next
    })
    if (updated.roomId !== null) for (const botId of updated.memberIds) addRoomMember(this.db, updated.roomId, botId, this.deps.now())
    return ok(this.changed(updated, 'team.update', actor))
  }

  archive(input: unknown, actor = 'owner'): PodResult<Team> {
    const id = readId(input, 'id')
    if (id === undefined) return fail('invalid-input', '缺少团队 id')
    const archived = updateTeam(this.db, id, { archivedAt: this.deps.now() }, this.deps.now())
    return archived === undefined ? fail('not-found', '找不到这个团队') : ok(this.changed(archived, 'team.archive', actor))
  }

  restore(input: unknown, actor = 'owner'): PodResult<Team> {
    const id = readId(input, 'id')
    if (id === undefined) return fail('invalid-input', '缺少团队 id')
    const restored = updateTeam(this.db, id, { archivedAt: null }, this.deps.now())
    return restored === undefined ? fail('not-found', '找不到这个团队') : ok(this.changed(restored, 'team.restore', actor))
  }

  private extraTemplates: readonly TeamTemplate[] = []

  /** 内置模板加上其他插件注册的模板（ctx.pod.registerTemplate）。 */
  templates(): readonly TeamTemplate[] {
    return [...TEAM_TEMPLATES, ...this.extraTemplates]
  }

  registerTemplate(template: TeamTemplate): () => void {
    if (this.templates().some((item) => item.id === template.id)) throw new Error(`已经有 id 为 ${template.id} 的模板`)
    this.extraTemplates = [...this.extraTemplates, template]
    return () => {
      this.extraTemplates = this.extraTemplates.filter((item) => item !== template)
    }
  }

  /** 按模板一键生成 bot 和团队。 */
  fromTemplate(input: unknown, actor = 'owner'): PodResult<Team> {
    const templateId = readId(input, 'templateId')
    const template = this.templates().find((item) => item.id === templateId)
    if (template === undefined) return fail('not-found', '没有这个模板')
    const name = readString(input, 'name') || template.name
    if (this.list().some((team) => team.name === name)) return fail('conflict', `已经有叫「${name}」的团队，换个名字`)
    const created = template.members.map((member) => {
      const existing = this.deps.bots.active().find((bot) => bot.name === member.name)
      const bot =
        existing ??
        this.deps.bots.createFromDraft(
          {
            name: member.name,
            title: member.title,
            persona: member.persona,
            capabilities: member.capabilities,
            card: { duties: member.duties, strengths: '', notResponsible: '', askWho: '' },
            toolProfile: member.toolProfile,
            temporary: false,
          },
          { source: actor === 'owner' ? 'user' : 'lead', actor, reason: `按「${template.name}」模板新建` },
        )
      return { bot, leader: member.leader === true }
    })
    const leader = created.find((item) => item.leader) ?? created[0]
    if (leader === undefined) return fail('internal', '模板里没有成员')
    return this.createTeam(
      {
        name,
        description: template.description,
        leaderBotId: leader.bot.id,
        memberIds: created.filter((item) => item !== leader).map((item) => item.bot.id),
        temporary: false,
      },
      actor,
    )
  }

  purgeExpired(now: number): number {
    const purged = purgeArchivedTeams(this.db, now - RECYCLE_DAYS * 86_400_000, now)
    if (purged > 0) this.deps.bus.emit({ type: 'teams' })
    return purged
  }
}
