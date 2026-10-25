import { colorDistance, hexToOklch, oklchToHex, type Oklch } from './oklch.ts'

/**
 * bot 名字的颜色：每个 bot 随机配一种，侧栏、消息里的名字和 @ 都用它，一眼分清是谁。
 * 存的是 #rrggbb。在 OKLCH 里随机取：色相随便，明暗和饱和度限在中间一段，
 * 没有刺眼的荧光色，也不会浅到白底上看不清；界面上再和文字颜色调一调，深色模式下也清楚。
 */

/**
 * 随机取色的范围：再亮在白底上发虚，再暗在黑底上看不清，再艳就刺眼。
 * 界面上和文字颜色按 3:1 调过以后，任何色相在白底和深色底上的对比度都在 4.7 以上。
 */
const LIGHTNESS = { min: 0.56, max: 0.64 } as const
const CHROMA = { min: 0.09, max: 0.16 } as const
/** 接口传进来的颜色拉回这个范围（比随机的宽一点）。 */
const LIMIT = { lMin: 0.54, lMax: 0.66, cMax: 0.18 } as const

/** 名字颜色的配法；换了配法时老 bot 全部重新随机配一次（以前用 12 色色板，现在是随机色）。 */
export const BOT_COLOR_SCHEME = 'oklch-random-1'

/** 以前存的是色板名字，读老数据时换成当时的颜色。 */
const LEGACY: Readonly<Record<string, string>> = {
  blue: '#2f6fe4',
  indigo: '#5150d8',
  violet: '#7c4ddb',
  purple: '#9b45c9',
  pink: '#d23f8f',
  rose: '#de3f5c',
  orange: '#e0661b',
  amber: '#c28a06',
  lime: '#5f9a0e',
  green: '#1c9a4f',
  teal: '#0f9488',
  cyan: '#0f8bb3',
}

const HEX = /^#[0-9a-f]{6}$/i

/** 新 bot 随机几种里挑和在用的颜色差得最远的那个。 */
const CANDIDATES = 8

export function isBotColor(value: unknown): value is string {
  return typeof value === 'string' && (HEX.test(value) || LEGACY[value] !== undefined)
}

function between(range: { readonly min: number; readonly max: number }, fraction: number): number {
  return range.min + fraction * (range.max - range.min)
}

/** 按三个 0 到 1 的数取一种看得清的颜色。 */
function colorAt(light: number, chroma: number, hue: number): string {
  return oklchToHex({ l: between(LIGHTNESS, light), c: between(CHROMA, chroma), h: hue * 360 })
}

/** 随机一种看得清的颜色。 */
export function randomBotColor(random: () => number = Math.random): string {
  return colorAt(random(), random(), random())
}

/** 一批颜色给你挑：色相均匀铺满一圈再各自抖一点，明暗和饱和度随机。 */
export function botColorBatch(count: number, random: () => number = Math.random): readonly string[] {
  const offset = random()
  return Array.from({ length: count }, (_, index) => colorAt(random(), random(), (offset + (index + random() * 0.6) / count) % 1))
}

function pointOf(color: string): Oklch | undefined {
  return hexToOklch(HEX.test(color) ? color : (LEGACY[color] ?? ''))
}

/** 给新 bot 配颜色：随机几种，挑和在用的 bot 差得最远的，尽量不撞色。 */
export function pickBotColor(used: readonly string[], random: () => number = Math.random): string {
  const taken = used.map(pointOf).filter((point): point is Oklch => point !== undefined)
  const candidates = Array.from({ length: CANDIDATES }, () => randomBotColor(random))
  const gap = (color: string): number => {
    const point = hexToOklch(color)
    return point === undefined || taken.length === 0 ? 0 : Math.min(...taken.map((other) => colorDistance(point, other)))
  }
  return candidates.reduce((best, color) => (gap(color) > gap(best) ? color : best))
}

/** 接口传进来的颜色：只认 #rrggbb，太亮、太暗、太艳的拉回看得清的范围；不认识的返回 undefined。 */
export function readableBotColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const point = hexToOklch(value)
  if (point === undefined) return undefined
  if (point.l >= LIMIT.lMin && point.l <= LIMIT.lMax && point.c <= LIMIT.cMax) return value.trim().toLowerCase()
  return oklchToHex({ l: Math.min(LIMIT.lMax, Math.max(LIMIT.lMin, point.l)), c: Math.min(point.c, LIMIT.cMax), h: point.h })
}

/** bot 名字的颜色（#rrggbb）：老数据的色板名字换成对应的颜色，还没配的按 id 算一个，界面上总有颜色。 */
export function botColorHex(bot: { readonly id: string; readonly color?: string }): string {
  const color = bot.color ?? ''
  if (HEX.test(color)) return color
  const legacy = LEGACY[color]
  if (legacy !== undefined) return legacy
  const hash = mixBits([...bot.id].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 7))
  return colorAt(((hash >>> 9) % 101) / 100, ((hash >>> 17) % 101) / 100, (hash % 360) / 360)
}

/** 把哈希的每一位搅匀（murmur3 的收尾），id 只差一个字的 bot 颜色也差得开。 */
function mixBits(value: number): number {
  const a = Math.imul(value ^ (value >>> 16), 0x85ebca6b)
  const b = Math.imul(a ^ (a >>> 13), 0xc2b2ae35)
  return (b ^ (b >>> 16)) >>> 0
}
