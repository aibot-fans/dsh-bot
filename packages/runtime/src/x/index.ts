import type { DatabaseSync } from 'node:sqlite'
import type { PodSession, PodSettings } from 'pod-domain'
import type { Dispatcher } from '../agents/dispatcher.ts'
import type { SessionRegistry } from '../agents/registry.ts'
import type { SharedBrowser } from '../browser/browser.ts'
import type { Auditor } from '../core/audit.ts'
import type { WaitService } from '../waits/service.ts'
import { XAccount } from './account.ts'
import type { XMeter } from './meter.ts'
import { XResponses } from './responses.ts'
import { XWrites } from './writes.ts'

export interface XKitDeps {
  readonly db: DatabaseSync
  readonly browser: SharedBrowser
  readonly waits: WaitService
  readonly registry: SessionRegistry
  readonly dispatcher: Dispatcher
  readonly audit: Auditor
  readonly settings: () => PodSettings
  readonly now: () => number
  readonly exposed: () => string | undefined
  readonly exfiltration: (session: PodSession, key: string, candidate: string, title: string) => string | undefined
  readonly meter: XMeter
}

export interface XKit {
  readonly account: XAccount
  readonly responses: XResponses
  readonly writes: XWrites
  readonly meter: XMeter
}

/** 用 dsh-bot 浏览器里登录的 X 账号读写 X：账号、存下的响应、写操作审批和扣次数。 */
export function createXKit(deps: XKitDeps): XKit {
  const account = new XAccount({ db: deps.db, browser: deps.browser, now: deps.now })
  const responses = new XResponses()
  const writes = new XWrites({
    db: deps.db,
    account,
    responses,
    waits: deps.waits,
    registry: deps.registry,
    dispatcher: deps.dispatcher,
    audit: deps.audit,
    settings: deps.settings,
    now: deps.now,
    exposed: deps.exposed,
    exfiltration: deps.exfiltration,
    meter: deps.meter,
  })
  return { account, responses, writes, meter: deps.meter }
}
