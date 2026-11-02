import type { DatabaseSync } from 'node:sqlite'
import { newId, type FollowKind, type MessageRoute, type RouteKind, type Topic, type TopicFollow } from 'pod-domain'
import {
  awaitingFront,
  bindFrontRoutes,
  followTopic,
  frontQueue,
  frontRefsUndecided,
  frontsWithQueue,
  followersOf,
  followsOf,
  getMessage,
  getTopic,
  insertRoute,
  insertTeamTopic,
  insertThreadTopic,
  pendingRoutes,
  rebindRouteRef,
  routesFor,
  teamTopicOf,
  threadRoot,
  topicByRoot,
  transaction,
  undecidedFront,
  unfollowTopic,
} from 'pod-store'

export interface TopicDeps {
  readonly db: DatabaseSync
  readonly now: () => number
}

/**
 * 引擎的话题部分：话题、任务跟进话题（多对多）、每条消息的去向。
 * 回复串的话题挂跟进时才建；建好以后串里的消息都记上它，新的回复写入时继承。
 */
export class Topics {
  private readonly deps: TopicDeps

  constructor(deps: TopicDeps) {
    this.deps = deps
  }

  private get db(): DatabaseSync {
    return this.deps.db
  }

  get(id: string): Topic | undefined {
    return getTopic(this.db, id)
  }

  /** 这条消息所在的话题：写入时继承的，或者顺着回复串找到的；没有任务跟进过的串没有话题。 */
  topicOf(messageId: string): Topic | undefined {
    const message = getMessage(this.db, messageId)
    if (message === undefined) return undefined
    if (message.topicId != null) return getTopic(this.db, message.topicId)
    const root = threadRoot(this.db, messageId)
    return root === undefined ? undefined : topicByRoot(this.db, root)
  }

  /** 这条消息所在回复串的话题，没有就建一个。 */
  ensureThread(messageId: string): Topic | undefined {
    return transaction(this.db, () => {
      const root = threadRoot(this.db, messageId)
      if (root === undefined) return undefined
      const existing = topicByRoot(this.db, root)
      if (existing !== undefined) return existing
      return insertThreadTopic(this.db, { id: newId('topic'), roomId: getMessage(this.db, root)?.roomId ?? null, rootMessage: root, now: this.deps.now() })
    })
  }

  /** 任务群的话题（整个群一个），没有就建一个。 */
  ensureTeam(roomId: string, taskId: string): Topic {
    return transaction(this.db, () => teamTopicOf(this.db, roomId) ?? insertTeamTopic(this.db, { id: newId('topic'), roomId, taskId, now: this.deps.now() }))
  }

  follow(taskId: string, topicId: string, kind: FollowKind): void {
    followTopic(this.db, { topicId, taskId, kind, now: this.deps.now() })
  }

  /** 让任务跟进这条消息所在的回复串，返回那个话题。 */
  followMessage(taskId: string, messageId: string, kind: FollowKind): Topic | undefined {
    return transaction(this.db, () => {
      const topic = this.ensureThread(messageId)
      if (topic !== undefined) this.follow(taskId, topic.id, kind)
      return topic
    })
  }

  unfollow(taskId: string, topicId: string): boolean {
    return unfollowTopic(this.db, topicId, taskId, this.deps.now())
  }

  followers(topicId: string): readonly TopicFollow[] {
    return followersOf(this.db, topicId)
  }

  follows(taskId: string): readonly TopicFollow[] {
    return followsOf(this.db, taskId)
  }

  route(messageId: string, route: RouteKind, taskId: string | null, decidedBy: string, note = '', ref: string | null = null, botId: string | null = null): void {
    insertRoute(this.db, { messageId, route, taskId, decidedBy, note, ref, botId, now: this.deps.now() })
  }

  /** 交给这个 bot 的前台：先记下去向（待送），再由前台合批送出。 */
  toFront(messageId: string, botId: string, note = ''): void {
    this.route(messageId, 'front', null, 'code', note, null, botId)
  }

  /** 前台的判断：记在交给它的那个 bot 名下。 */
  decide(messageId: string, botId: string, route: RouteKind, taskId: string | null = null, note = ''): void {
    this.route(messageId, route, taskId, botId, note, null, botId)
  }

  frontQueue(botId: string): readonly MessageRoute[] {
    return frontQueue(this.db, botId)
  }

  frontsWithQueue(): readonly string[] {
    return frontsWithQueue(this.db)
  }

  bindFront(routeIds: readonly number[], deliveryId: string): void {
    bindFrontRoutes(this.db, routeIds, deliveryId)
  }

  undecided(botId: string, refs: readonly string[]): readonly MessageRoute[] {
    return undecidedFront(this.db, botId, refs)
  }

  /** 送进去了还没去向的那几批（投递 id）。 */
  inFlight(botId: string): readonly string[] {
    return frontRefsUndecided(this.db, botId)
  }

  /** 这条消息交给了这个前台、还没判断。 */
  awaiting(messageId: string, botId: string): boolean {
    return awaitingFront(this.db, messageId, botId)
  }

  routes(messageId: string): readonly MessageRoute[] {
    return routesFor(this.db, messageId)
  }

  /** 送进这个任务、还没确认也没交还的消息。 */
  pending(taskId: string): readonly MessageRoute[] {
    return pendingRoutes(this.db, taskId)
  }

  /** 这个任务交还过这条消息（交还过的不再送给它，前台也不能再转回去）。 */
  handedBack(messageId: string, taskId: string): boolean {
    return this.routes(messageId).some((route) => route.route === 'handed_back' && route.taskId === taskId)
  }

  /** 开工时：记在执行上的消息改记在开工说明那次投递上。 */
  rebind(runId: string, deliveryId: string): void {
    rebindRouteRef(this.db, runId, deliveryId)
  }
}
