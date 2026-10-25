/**
 * 等你处理的事：只有四种情况会出现——接管登录、批准写操作、安全拦截、没有默认值的歧义；
 * 另外两种是 Pod 自己产生的：崩溃时状态未知的写操作、带脚本的技能等你批准。
 */

export type WaitKind = 'login' | 'write' | 'security' | 'ambiguity' | 'unknown-state' | 'approval'

/** open 还卡着；bypassed 已先绕过（交付时移到前提和待确认）；suspended 任务停止时挂起；resolved 你处理了；closed 任务取消时自动关闭。 */
export type WaitStatus = 'open' | 'bypassed' | 'suspended' | 'resolved' | 'closed'

export interface Wait {
  readonly id: string
  readonly kind: WaitKind
  readonly status: WaitStatus
  readonly title: string
  readonly detail: string
  readonly data: Readonly<Record<string, unknown>>
  readonly taskId: string | null
  readonly rootId: string | null
  readonly sessionId: string | null
  readonly botId: string | null
  readonly roomId: string | null
  readonly answer: string | null
  readonly createdAt: number
  readonly resolvedAt: number | null
}

export const WAIT_KIND_LABELS: Readonly<Record<WaitKind, string>> = {
  login: '需要登录或验证',
  write: '批准写操作',
  security: '安全拦截',
  ambiguity: '需要你拿主意',
  'unknown-state': '状态未知',
  approval: '等你批准',
}

export const WAIT_KINDS: readonly WaitKind[] = ['login', 'write', 'security', 'ambiguity', 'unknown-state', 'approval']

export function isOpenWait(wait: Pick<Wait, 'status'>): boolean {
  return wait.status === 'open' || wait.status === 'bypassed'
}
