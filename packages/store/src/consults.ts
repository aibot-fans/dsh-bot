import type { DatabaseSync } from 'node:sqlite'

/** bot 之间的异步咨询（ask_bot）：对方在咨询会话里回答，答复再送回提问的 bot。 */
export interface Consult {
  readonly id: string
  readonly rootId: string | null
  readonly roomId: string | null
  readonly askerSession: string
  readonly askerBot: string
  readonly targetBot: string
  readonly consultSession: string | null
  readonly question: string
  readonly answer: string | null
  readonly status: 'pending' | 'answered' | 'failed'
  readonly createdAt: number
  readonly answeredAt: number | null
}

interface ConsultRow {
  readonly id: string
  readonly root_id: string | null
  readonly room_id: string | null
  readonly asker_session: string
  readonly asker_bot: string
  readonly target_bot: string
  readonly consult_session: string | null
  readonly question: string
  readonly answer: string | null
  readonly status: string
  readonly created_at: number
  readonly answered_at: number | null
}

function toConsult(row: ConsultRow): Consult {
  return {
    id: row.id,
    rootId: row.root_id,
    roomId: row.room_id,
    askerSession: row.asker_session,
    askerBot: row.asker_bot,
    targetBot: row.target_bot,
    consultSession: row.consult_session,
    question: row.question,
    answer: row.answer,
    status: row.status === 'answered' || row.status === 'failed' ? row.status : 'pending',
    createdAt: row.created_at,
    answeredAt: row.answered_at,
  }
}

export function insertConsult(db: DatabaseSync, consult: Omit<Consult, 'answer' | 'status' | 'answeredAt'>): Consult {
  db.prepare(
    `INSERT INTO consults (id, root_id, room_id, asker_session, asker_bot, target_bot, consult_session, question, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    consult.id,
    consult.rootId,
    consult.roomId,
    consult.askerSession,
    consult.askerBot,
    consult.targetBot,
    consult.consultSession,
    consult.question,
    consult.createdAt,
  )
  return { ...consult, answer: null, status: 'pending', answeredAt: null }
}

/** 某条咨询会话里最早一个还没回答的问题：它这一轮说的话就是答复。 */
export function oldestPendingConsult(db: DatabaseSync, consultSession: string): Consult | undefined {
  const row = db
    .prepare("SELECT * FROM consults WHERE consult_session = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1")
    .get(consultSession) as ConsultRow | undefined
  return row === undefined ? undefined : toConsult(row)
}

export function answerConsult(db: DatabaseSync, id: string, answer: string, now: number): void {
  db.prepare("UPDATE consults SET answer = ?, status = 'answered', answered_at = ? WHERE id = ?").run(answer, now, id)
}

export function setConsultSession(db: DatabaseSync, id: string, sessionId: string): void {
  db.prepare('UPDATE consults SET consult_session = ? WHERE id = ?').run(sessionId, id)
}

export function getConsult(db: DatabaseSync, id: string): Consult | undefined {
  const row = db.prepare('SELECT * FROM consults WHERE id = ?').get(id) as ConsultRow | undefined
  return row === undefined ? undefined : toConsult(row)
}
