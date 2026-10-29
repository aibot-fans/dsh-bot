import { fail, ok, readId, readInt, readString, t } from 'pod-domain'
import { ratingsInRoom } from 'pod-store'
import type { PodRuntime } from '../pod.ts'
import { get, post, type RouteSpec } from './router.ts'

/** 自我优化的接口：评分卡、进化日志和回滚、本周变化、技能、消息评分。 */
export function evolutionRoutes(pod: PodRuntime): readonly RouteSpec[] {
  const kit = pod.evolutionKit
  return [
    get('/scorecards', () => ok(pod.bots.active().map((bot) => ({ botId: bot.id, name: bot.name, temporary: bot.temporary, card: kit.feedback.scorecard(bot.id) })))),
    get('/evolution', (query) => ok(kit.evolution.list(readInt(query, 'since') ?? Number(readString(query, 'since') || 0)))),
    post('/evolution/revert', (body) => {
      const id = readId(body, 'id')
      return id === undefined ? fail('invalid-input', t('缺少 id')) : kit.evolution.revert(id)
    }),
    get('/weekly', (query) => ok(kit.evolution.weekly(Number(readString(query, 'since') || 0) || pod.now() - 7 * 86_400_000))),
    get('/skills', () =>
      ok(
        kit.skills.list().map((skill) => ({
          ...skill,
          scopeName: skill.scopeKind === 'bot' ? (pod.bots.get(skill.scopeId)?.name ?? t('已归档的 bot')) : (pod.teams.get(skill.scopeId)?.name ?? t('团队')),
        })),
      ),
    ),
    get('/skill/versions', (query) => {
      const id = readId(query, 'id')
      return id === undefined ? fail('invalid-input', t('缺少 id')) : ok(kit.skills.versions(id))
    }),
    post('/skill/save', (body) => {
      const scopeKind = readString(body, 'scopeKind') === 'team' ? 'team' : 'bot'
      const scopeId = readId(body, 'scopeId')
      if (scopeId === undefined) return fail('invalid-input', t('要选给哪个 bot 或团队用'))
      return kit.skills.save(
        { name: readString(body, 'name'), title: readString(body, 'title'), description: readString(body, 'description'), content: readString(body, 'content'), scopeKind, scopeId },
        'owner',
        'owner',
        null,
        t('你在页面上编辑'),
      )
    }),
    post('/skill/status', (body) => {
      const id = readId(body, 'id')
      const status = readString(body, 'status')
      if (id === undefined || (status !== 'active' && status !== 'archived')) return fail('invalid-input', t('只能启用或停用'))
      return kit.skills.setStatus(id, status, 'owner')
    }),
    post('/skill/rollback', (body) => {
      const id = readId(body, 'id')
      const version = readInt(body, 'version')
      return id === undefined || version === undefined ? fail('invalid-input', t('缺少 id 或版本')) : kit.skills.rollback(id, version, 'owner')
    }),
    /** 立即跑一次：复盘队列、夜间调整（人设、档位、分寸、自动退回）、本周变化卡。 */
    post('/evolution/run', async (body) => {
      const job = readString(body, 'job')
      if (job === 'retro') await kit.retro.tick()
      else if (job === 'nightly') {
        await kit.feedback.checkEdits()
        const reverted = kit.evolution.autoRevert()
        await kit.tuner.nightly()
        return ok({ reverted })
      } else if (job === 'weekly') kit.evolution.sendWeekly(pod.now() - 7 * 86_400_000)
      else return fail('invalid-input', t('只能是 retro、nightly 或 weekly'))
      return ok(null)
    }),
    post('/message/rate', (body) => kit.feedback.rate(body)),
    post('/message/regenerate', (body) => pod.chat.regenerate(body)),
    post('/message/retry', (body) => pod.chat.retry(body)),
    post('/room/upload', (body) => pod.chat.attach(body)),
    get('/ratings', (query) => {
      const roomId = readId(query, 'roomId')
      return roomId === undefined ? fail('invalid-input', t('缺少房间 id')) : ok(Object.fromEntries(ratingsInRoom(pod.db, roomId)))
    }),
  ]
}

