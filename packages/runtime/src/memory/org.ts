import type { DatabaseSync } from 'node:sqlite'
import { t, truncate, type Bot, type Room } from 'pod-domain'

/** 目录里最多列多少个群、多少个 bot。 */
const LISTED = 20

export interface OrgDeps {
  readonly db: DatabaseSync
  readonly now: () => number
  readonly groups: () => readonly Room[]
  readonly leaderName: (room: Room) => string | undefined
  readonly bots: () => readonly Bot[]
}

interface Ended {
  readonly title: string
  readonly bot: string | null
  readonly room: string | null
  readonly reason: string | null
}

/**
 * 组织目录里系统算的那一段：每个群管什么、谁是组长，每个群和每个 bot 近 30 天做完几件、被你停掉几件、被组长打回几次，最近做完的是什么。
 * 只记任务结果里的事实，不给 bot 打分。Super-agent 交活时看；“哪类事交给谁”的经验由夜里的整理另写在后面。
 */
export function orgFacts(deps: OrgDeps): string {
  const since = deps.now() - 30 * 86_400_000
  const ended = deps.db
    .prepare('SELECT title, owner_bot_id AS bot, COALESCE(conversation_id, room_id) AS room, end_reason AS reason FROM tasks WHERE parent_id IS NULL AND deleted_at IS NULL AND ended_at > ? ORDER BY ended_at DESC LIMIT 500')
    .all(since) as unknown as readonly Ended[]
  const redo = deps.db
    .prepare("SELECT t.owner_bot_id AS bot, COUNT(*) AS n FROM task_runs r JOIN tasks t ON t.id = r.task_id WHERE r.reason = 'review' AND r.queued_at > ? GROUP BY 1")
    .all(since) as unknown as readonly { readonly bot: string | null; readonly n: number }[]
  const tally = (rows: readonly Ended[]): string => {
    if (rows.length === 0) return t('近 30 天没有结束的任务')
    const done = rows.filter((row) => row.reason === 'done')
    const stopped = rows.filter((row) => row.reason === 'stopped').length
    const recent = done.slice(0, 3).map((row) => `「${truncate(row.title, 20)}」`).join('、')
    return `${t('做完 {done} 件、被停掉 {stopped} 件', { done: done.length, stopped })}${recent === '' ? '' : t('；最近做完：{recent}', { recent })}`
  }
  const groups = deps.groups().slice(0, LISTED).map((room) => {
    const leader = deps.leaderName(room)
    return `- 「${room.title}」${room.topic === '' ? '' : `：${truncate(room.topic, 40)}`}${leader === undefined ? '' : t('；组长 {leader}', { leader })}；${tally(ended.filter((row) => row.room === room.id))}`
  })
  const bots = deps.bots().filter((bot) => bot.role !== 'lead').slice(0, LISTED).map((bot) => {
    const back = redo.find((row) => row.bot === bot.id)?.n ?? 0
    return `- ${bot.name}：${tally(ended.filter((row) => row.bot === bot.id))}${back > 0 ? t('；被组长打回 {back} 次', { back }) : ''}`
  })
  return [groups.length === 0 ? '' : `${t('群（近 30 天）：')}\n${groups.join('\n')}`, bots.length === 0 ? '' : `${t('bot（近 30 天）：')}\n${bots.join('\n')}`].filter((part) => part !== '').join('\n')
}
