import { compareVersions, isRecord, isReleaseVersion, type ReleaseNote } from 'pod-domain'

/** 先问 npm 官方源，连不上再问国内镜像。POD_UPDATE_REGISTRY 换成别的（逗号分隔），开发时指到本机的假注册表。 */
const DEFAULT_REGISTRIES = ['https://registry.npmjs.org/', 'https://registry.npmmirror.com/']

const TIMEOUT_MS = 10_000

export function updateRegistries(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const custom = (env.POD_UPDATE_REGISTRY ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//.test(item))
  return (custom.length > 0 ? custom : DEFAULT_REGISTRIES).map((url) => (url.endsWith('/') ? url : `${url}/`))
}

export interface Published {
  /** dist-tags 里的 latest。 */
  readonly latest: string
  /** 不晚于 latest 的正式版，新的在前；标了弃用的不算。 */
  readonly releases: readonly ReleaseNote[]
}

function host(registry: string): string {
  try {
    return new URL(registry).host
  } catch {
    return registry
  }
}

function reason(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return '超时'
  return `连不上（${error instanceof Error ? error.message : String(error)}）`
}

/** 读注册表给的整份包信息（packument）。发包时 releaseNotes 字段带上 CHANGELOG 里那一版的说明。 */
export function parsePackument(raw: unknown): Published {
  const doc = isRecord(raw) ? raw : {}
  const tags = isRecord(doc['dist-tags']) ? doc['dist-tags'] : {}
  const latest = typeof tags.latest === 'string' ? tags.latest : ''
  if (!isReleaseVersion(latest)) throw new Error('注册表没给出最新版本')
  const versions = isRecord(doc.versions) ? doc.versions : {}
  const times = isRecord(doc.time) ? doc.time : {}
  const releases = Object.entries(versions)
    .flatMap(([version, manifest]) => {
      if (!isReleaseVersion(version) || compareVersions(version, latest) > 0) return []
      const fields = isRecord(manifest) ? manifest : {}
      if (typeof fields.deprecated === 'string' && fields.deprecated !== '') return []
      const time = times[version]
      const publishedAt = typeof time === 'string' ? Date.parse(time) : Number.NaN
      const notes = typeof fields.releaseNotes === 'string' && fields.releaseNotes.trim() !== '' ? fields.releaseNotes.trim() : null
      return [{ version, publishedAt: Number.isFinite(publishedAt) ? publishedAt : null, notes }]
    })
    .sort((a, b) => compareVersions(b.version, a.version))
  return { latest, releases }
}

/** 按顺序问注册表，第一个答上来的为准；都没答上来就报每个的原因。 */
export async function fetchPublished(name: string, registries: readonly string[]): Promise<Published> {
  const problems: string[] = []
  for (const registry of registries) {
    try {
      const response = await fetch(`${registry}${name.replace('/', '%2F')}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!response.ok) {
        problems.push(`${host(registry)} 回了 ${response.status}`)
        continue
      }
      return parsePackument(await response.json())
    } catch (error) {
      problems.push(`${host(registry)} ${reason(error)}`)
    }
  }
  throw new Error(`没查到新版本：${problems.join('；')}`)
}
