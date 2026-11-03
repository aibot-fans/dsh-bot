import type { DatabaseSync } from 'node:sqlite'
import { t, type PodSession, type Task, type Wait } from 'pod-domain'
import { readState, writeState } from 'pod-store'
import { APPROVE } from '../browser/approvals.ts'
import type { Auditor } from '../core/audit.ts'
import type { WaitService } from '../waits/service.ts'
import { normalizeApp } from './actions.ts'

/** 一个任务（整棵树）批准过的应用：任务结束就作废，关掉“用电脑”时全部收回。 */
interface Grant {
  readonly rootId: string
  readonly apps: readonly string[]
  readonly at: number
}

const GRANTS_KEY = 'computer.grants'

export interface ComputerGrantsDeps {
  readonly db: DatabaseSync
  readonly waits: WaitService
  readonly audit: Auditor
  readonly now: () => number
  readonly task: (taskId: string) => Task | undefined
  readonly botName: (botId: string) => string
}

/**
 * 用电脑的审批：每个任务第一次要用某些应用时问你一次（像参考项目开始用电脑前要你点头那样），
 * 批准后这个任务里这些应用随便用，不再一步步问。答复照常转回任务，bot 看到批准再开始。
 */
export class ComputerGrants {
  private readonly deps: ComputerGrantsDeps

  constructor(deps: ComputerGrantsDeps) {
    this.deps = deps
  }

  /** 还算数的授权：任务还在、没结束。顺手把作废的删掉。 */
  private live(): readonly Grant[] {
    const all = readState<readonly Grant[]>(this.deps.db, GRANTS_KEY, [])
    const kept = all.filter((grant) => {
      const root = this.deps.task(grant.rootId)
      return root !== undefined && root.endedAt === null
    })
    if (kept.length !== all.length) writeState(this.deps.db, GRANTS_KEY, kept)
    return kept
  }

  appsFor(rootId: string): readonly string[] {
    return this.live().find((grant) => grant.rootId === rootId)?.apps ?? []
  }

  covers(rootId: string, apps: readonly string[]): boolean {
    const granted = this.appsFor(rootId)
    return apps.every((app) => granted.includes(normalizeApp(app)))
  }

  /** 同一个任务已经在等你批准这些应用了。 */
  pending(rootId: string, apps: readonly string[]): Wait | undefined {
    const wanted = apps.map(normalizeApp)
    return this.deps.waits.open().find((wait) => {
      if (wait.kind !== 'write' || wait.data.channel !== 'computer' || wait.rootId !== rootId || wait.status !== 'open') return false
      const asked = Array.isArray(wait.data.apps) ? wait.data.apps.map((app) => normalizeApp(String(app))) : []
      return wanted.every((app) => asked.includes(app))
    })
  }

  request(session: PodSession, apps: readonly string[], reason: string): Wait {
    const names = apps.join('、')
    return this.deps.waits.ask({
      session,
      kind: 'write',
      title: t('批准：让 {bot} 在这台电脑上用 {apps}', { bot: this.deps.botName(session.botId), apps: names }),
      detail: t('为什么要用：{reason}', { reason }),
      bypassed: false,
      data: { channel: 'computer', apps, reason, description: t('在这台电脑上用 {apps}', { apps: names }) },
    })
  }

  /** 你批准了就记下授权；返回 false，答复照常转回任务。 */
  resolve(wait: Wait, answer: string): boolean {
    const apps = Array.isArray(wait.data.apps) ? wait.data.apps.map((app) => normalizeApp(String(app))) : []
    if (!APPROVE.test(answer.trim()) || wait.rootId === null || apps.length === 0) return false
    const rootId = wait.rootId
    const current = this.live()
    const before = current.find((grant) => grant.rootId === rootId)?.apps ?? []
    const merged: Grant = { rootId, apps: [...new Set([...before, ...apps])], at: this.deps.now() }
    writeState(this.deps.db, GRANTS_KEY, [...current.filter((grant) => grant.rootId !== rootId), merged])
    this.deps.audit.record('computer.grant', 'owner', rootId, { apps: merged.apps })
    return false
  }

  /** 关掉“用电脑”时全部收回。 */
  clear(): void {
    writeState(this.deps.db, GRANTS_KEY, [])
  }
}
