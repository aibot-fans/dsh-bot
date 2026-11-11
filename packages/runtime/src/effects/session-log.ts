import type { SessionEvent, SessionPersistenceLike } from '../dsh.ts'
import { release } from './ledger.ts'

/** 一次读多少条会话事件。 */
const PAGE = 512

/**
 * 读一段会话在 from 到 to 之间的日志（只读）。dsh 没有这个接口、会话读不了都返回空的。
 * 夜里整理记忆时回放任务会话用：常开任务一段会话很长，只留要的那一段时间里的事件。
 */
export async function readSessionEvents(
  service: SessionPersistenceLike | undefined,
  sessionId: string,
  from: number,
  to: number,
  warn: (message: string, error?: unknown) => void,
): Promise<readonly SessionEvent[]> {
  if (service === undefined || typeof service.open !== 'function') return []
  const kept: SessionEvent[] = []
  try {
    if (typeof service.flush === 'function') await service.flush()
    const handle = await service.open(sessionId, 'read')
    try {
      for (let offset = 0; ; ) {
        const { events } = await handle.read(offset, PAGE)
        if (events.length === 0) break
        for (const event of events) if (event.time <= 0 || (event.time >= from && event.time <= to)) kept.push(event)
        offset += events.length
      }
    } finally {
      await release(handle)
    }
  } catch (error) {
    warn(`读会话 ${sessionId} 的日志没成`, error)
  }
  return kept
}
