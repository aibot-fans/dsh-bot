/**
 * 密钥打码和填写检查。
 * 打码：用户贴进聊天的密钥不进记忆、日志和搜索索引，统一换成占位符。
 * 填写检查：bot 往网页里填的内容不能是银行卡号、身份证号、密钥这类东西。
 */

export type SecretKind = 'api-key' | 'jwt' | 'private-key' | 'password' | 'bearer'

interface SecretPattern {
  readonly kind: SecretKind
  readonly pattern: RegExp
  /** 只替换某个捕获组（比如“密码：xxx”只打掉 xxx）；不填就替换整段。 */
  readonly group?: number
}

const PATTERNS: readonly SecretPattern[] = [
  { kind: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: 'api-key', pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g },
  { kind: 'api-key', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g },
  { kind: 'api-key', pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}/g },
  { kind: 'api-key', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'api-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'api-key', pattern: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { kind: 'bearer', pattern: /\b(Bearer\s+)([A-Za-z0-9._~+/-]{20,}=*)/g, group: 2 },
  {
    kind: 'password',
    pattern: /((?:password|passwd|pwd|secret|token|api[_-]?key|密码|口令|密钥)\s*[:：=]\s*)(\S{4,})/gi,
    group: 2,
  },
]

export const SECRET_PLACEHOLDER = '‹已打码›'

export interface MaskResult {
  readonly text: string
  readonly kinds: readonly SecretKind[]
}

/** 把文字里的密钥换成占位符，返回打码后的文字和发现的种类。 */
export function maskSecrets(text: string): MaskResult {
  const found = new Set<SecretKind>()
  let masked = text
  for (const { kind, pattern, group } of PATTERNS) {
    masked = masked.replace(pattern, (...args: unknown[]) => {
      found.add(kind)
      if (group === undefined) return SECRET_PLACEHOLDER
      const prefix = typeof args[1] === 'string' && group === 2 ? args[1] : ''
      return `${prefix}${SECRET_PLACEHOLDER}`
    })
  }
  return { text: masked, kinds: [...found] }
}

export function containsSecret(text: string): boolean {
  return maskSecrets(text).kinds.length > 0
}

/** Luhn 校验，用来认银行卡号。 */
function passesLuhn(digits: string): boolean {
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index])
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const
const ID_CHECK = '10X98765432'

/** 18 位居民身份证号校验位。 */
function isChineseIdNumber(value: string): boolean {
  if (!/^\d{17}[\dXx]$/.test(value)) return false
  let sum = 0
  for (let index = 0; index < 17; index += 1) sum += Number(value[index]) * (ID_WEIGHTS[index] ?? 0)
  return ID_CHECK[sum % 11] === value[17]?.toUpperCase()
}

export type SensitiveFill = 'card-number' | 'id-number' | SecretKind

/**
 * 判断一段要填进网页的内容是否属于绝不能由 bot 填写的类别。
 * 密码和验证码要结合输入框类型判断，由浏览器那一侧检查；这里只看值本身。
 */
export function classifySensitiveFill(value: string): SensitiveFill | undefined {
  const compact = value.replace(/[\s-]/g, '')
  if (/^\d{13,19}$/.test(compact) && passesLuhn(compact)) return 'card-number'
  if (isChineseIdNumber(compact)) return 'id-number'
  return maskSecrets(value).kinds[0]
}
