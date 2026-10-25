/**
 * 中文全文检索的文字处理：在 node:sqlite 的 FTS5（unicode61 分词器）上做中文逐字索引。
 * 入库时把每个汉字（以及假名、韩文）拆成单独的词，查询时用短语查询要求这些字相邻，
 * 任意长度的中文词都能搜到；英文和数字照常按词匹配，支持前缀。
 */

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const CJK_GLOBAL = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu

export function hasCjk(text: string): boolean {
  return CJK.test(text)
}

/** 入库：每个中日韩字前后加空格，压掉多余空白。 */
export function toIndexText(text: string): string {
  return text.replace(CJK_GLOBAL, (char) => ` ${char} `).replace(/\s+/g, ' ').trim()
}

/** 显示：把索引里拆开的字拼回去（只去掉中日韩字之间的空格，英文词之间的保留）。 */
export function fromIndexText(text: string): string {
  return text
    .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\]\[]) (?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\[\]])/gu, '$1')
    .replace(/\[ /g, '[')
    .replace(/ \]/g, ']')
}

function quote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`
}

/** 一个查询词变成 FTS5 表达式：含中文的拆成逐字短语，英文数字用前缀匹配。 */
function termExpression(term: string): string | undefined {
  const cleaned = term.replace(/["()*:^{}]/g, ' ').trim()
  if (cleaned === '') return undefined
  if (hasCjk(cleaned)) return quote(toIndexText(cleaned))
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 0) return undefined
  return words.map((word) => `${quote(word.toLowerCase())}*`).join(' ')
}

/**
 * 把用户输入的查询变成 FTS5 MATCH 表达式：空白分开的多个词都要出现（AND）。
 * 返回 undefined 表示查询里没有可搜的内容。
 */
export function toMatchQuery(query: string): string | undefined {
  const terms = query
    .trim()
    .split(/\s+/)
    .map(termExpression)
    .filter((term): term is string => term !== undefined)
  return terms.length === 0 ? undefined : terms.join(' AND ')
}

/**
 * 宽松一点的查询：用 Intl.Segmenter 把长的中文词切成几个词，各自成短语，词之间不要求相邻。
 * 精确短语没结果时退一步用它。
 */
export function toLooseMatchQuery(query: string): string | undefined {
  const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('zh', { granularity: 'word' }) : undefined
  if (segmenter === undefined) return undefined
  const words: string[] = []
  for (const part of query.trim().split(/\s+/)) {
    if (!hasCjk(part)) {
      if (part !== '') words.push(part)
      continue
    }
    for (const segment of segmenter.segment(part)) if (segment.isWordLike === true) words.push(segment.segment)
  }
  const terms = words.map(termExpression).filter((term): term is string => term !== undefined)
  if (terms.length <= 1) return undefined
  return terms.join(' AND ')
}

/** 搜索结果的种类。 */
export type SearchKind = 'message' | 'task' | 'memory' | 'file' | 'web'

export const SEARCH_KIND_LABELS: Readonly<Record<SearchKind, string>> = {
  message: '聊天记录',
  task: '任务',
  memory: '记忆',
  file: '文件',
  web: '网页存档',
}

export interface SearchDoc {
  /** 全局唯一：种类加原始 id，例如 message:msg_xxx。 */
  readonly ref: string
  readonly kind: SearchKind
  readonly title: string
  readonly body: string
  readonly roomId: string | null
  readonly botId: string | null
  readonly teamId: string | null
  readonly taskId: string | null
  readonly time: number
  /** 排序加权：你的消息、最终产物、置顶内容排前面。 */
  readonly boost: number
}

export interface SearchFilters {
  readonly kinds?: readonly SearchKind[]
  readonly roomId?: string
  readonly botId?: string
  readonly teamId?: string
  readonly taskId?: string
  readonly since?: number
  readonly until?: number
  /** 只在这些房间里搜（bot 只能搜到它有权看的）。 */
  readonly roomIds?: readonly string[]
  readonly limit?: number
}

export interface SearchHit {
  readonly ref: string
  readonly kind: SearchKind
  readonly title: string
  readonly snippet: string
  readonly roomId: string | null
  readonly botId: string | null
  readonly taskId: string | null
  readonly time: number
  readonly score: number
}

/** 相关度为主，再按时间和来源加权；bm25 越小越相关。 */
export function rankScore(bm25: number, boost: number, time: number, now: number): number {
  const relevance = -bm25
  const days = Math.max(0, (now - time) / 86_400_000)
  const recency = days < 7 ? 0.15 : days < 30 ? 0.05 : 0
  return relevance * (1 + boost + recency)
}

/** 抽关键词时跳过的常用词。 */
const STOP_WORDS = new Set([
  '我们', '你们', '他们', '这个', '那个', '一下', '什么', '怎么', '可以', '帮我', '需要', '一个', '还是', '就是', '现在', '然后', '因为', '所以',
  '如果', '没有', '不是', '是不是', '知道', '觉得', '时候', '问题', '东西', '谢谢', '好的', '请问', '能不能', '一些', '这样', '那样',
])

/**
 * 从一段话里抽几个关键词：中文用 Intl.Segmenter 分词，取两个字以上的词，去掉常用词；英文取三个字母以上的词。
 * 给“投递消息时顺便查记忆”用，不调用模型。
 */
export function keywords(text: string, max = 6): readonly string[] {
  const found: string[] = []
  const add = (word: string): void => {
    const cleaned = word.trim().toLowerCase()
    if (cleaned === '' || STOP_WORDS.has(cleaned) || found.includes(cleaned)) return
    found.push(cleaned)
  }
  const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('zh', { granularity: 'word' }) : undefined
  for (const part of text.split(/[\s\p{P}\p{S}]+/u)) {
    if (part === '') continue
    if (!hasCjk(part)) {
      if (part.length >= 3) add(part)
      continue
    }
    if (segmenter === undefined) {
      if ([...part].length >= 2) add(part)
      continue
    }
    for (const segment of segmenter.segment(part)) {
      if (segment.isWordLike === true && [...segment.segment].length >= 2) add(segment.segment)
    }
  }
  return found.slice(0, max)
}
