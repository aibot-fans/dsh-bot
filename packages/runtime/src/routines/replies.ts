import { isNoChange, type PodSession, type RoomMessage } from 'pod-domain'

interface Draft {
  readonly text: string
  readonly pageId: string | undefined
}

export interface RoutineRepliesDeps {
  /** 把一段话发到例程的房间（挂在页面下面的带上页面 id）。 */
  readonly post: (session: PodSession, text: string, pageId: string | undefined) => RoomMessage | undefined
  /** 例程有结果时提醒你一次。 */
  readonly notify: (session: PodSession, text: string) => void
}

/**
 * 例程会话说的话先攒着，这一轮结束再一起发：有一段是 NO_CHANGE（跟上次比没有新东西），
 * 整轮都不发、不提醒，过程中顺口说的话也跟着不发。
 */
export class RoutineReplies {
  private readonly drafts = new Map<string, readonly Draft[]>()
  private readonly deps: RoutineRepliesDeps

  constructor(deps: RoutineRepliesDeps) {
    this.deps = deps
  }

  hold(sessionId: string, text: string, pageId: string | undefined): void {
    this.drafts.set(sessionId, [...(this.drafts.get(sessionId) ?? []), { text, pageId }])
  }

  /** 这一轮结束：发出攒着的话，返回最后发出的一条；没有要发的返回 undefined。 */
  flush(session: PodSession): RoomMessage | undefined {
    const drafts = this.drafts.get(session.id) ?? []
    this.drafts.delete(session.id)
    if (drafts.length === 0 || drafts.some((draft) => isNoChange(draft.text))) return undefined
    const posted = drafts.map((draft) => this.deps.post(session, draft.text, draft.pageId)).filter((message): message is RoomMessage => message !== undefined)
    const last = drafts.at(-1)
    if (last !== undefined) this.deps.notify(session, last.text)
    return posted.at(-1)
  }
}
