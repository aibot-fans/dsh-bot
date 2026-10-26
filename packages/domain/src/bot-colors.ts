import { colorDistance, contrastRatio, hexToOklch, oklchToHex, type Oklch } from './oklch.ts'

/**
 * bot 名字的颜色：每个 bot 随机配一种，侧栏、消息里的名字和 @ 都用它，一眼分清是谁。
 * 存的是 #rrggbb。在 OKLCH 里随机取：色相随便，明暗和饱和度限在中间一段，没有刺眼的荧光色。
 * 界面上只取它的色相，浅色和深色背景各按一套明暗和饱和度画（nameColors），对比度不够就自动调。
 */

/**
 * 随机取色的范围：再亮在白底上发虚，再暗在黑底上看不清，再艳就刺眼。
 * 界面上和文字颜色按 3:1 调过以后，任何色相在白底和深色底上的对比度都在 4.7 以上。
 */
const LIGHTNESS = { min: 0.56, max: 0.64 } as const
const CHROMA = { min: 0.09, max: 0.16 } as const
/** 接口传进来的颜色拉回这个范围（比随机的宽一点）。 */
const LIMIT = { lMin: 0.54, lMax: 0.66, cMax: 0.18 } as const

/**
 * 名字在两种背景上的画法：浅色背景暗一点、艳一点，深色背景亮一点。以 l、c 为中心，保留一点 bot 自己颜色的明暗和饱和度差别
 * （色相相近的两个 bot 靠它分开），限在 lRange、cRange 里；屏幕显示不了的饱和度往下收。
 * 和背景的对比度不到 4.5 就往远离背景的方向一点点调明暗。
 */
interface NameScheme {
  readonly l: number
  readonly lRange: readonly [number, number]
  readonly chroma: number
  readonly cRange: readonly [number, number]
  readonly background: string
  readonly step: number
}
const NAME_ON_LIGHT: NameScheme = { l: 0.56, lRange: [0.5, 0.6], chroma: 1.35, cRange: [0.11, 0.19], background: '#ffffff', step: -0.01 }
const NAME_ON_DARK: NameScheme = { l: 0.78, lRange: [0.72, 0.84], chroma: 1.2, cRange: [0.1, 0.17], background: '#232324', step: 0.01 }
const NAME_CONTRAST = 4.5
/** 随机取色时明暗的中点：bot 颜色比它亮多少，名字就亮 0.8 倍那么多。 */
const LIGHTNESS_MID = (LIGHTNESS.min + LIGHTNESS.max) / 2

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

/** 名字实际画出来的样子（浅色背景上）：比较撞不撞色看这个，不看存的颜色。 */
function shownPoint(color: string): Oklch | undefined {
  return pointOf(color) === undefined ? undefined : hexToOklch(nameColors({ id: '', color }).light)
}

/** 给新 bot 配颜色：随机几种，挑画出来和在用的 bot 差得最远的，尽量不撞色。 */
export function pickBotColor(used: readonly string[], random: () => number = Math.random): string {
  const taken = used.map(shownPoint).filter((point): point is Oklch => point !== undefined)
  const candidates = Array.from({ length: CANDIDATES }, () => randomBotColor(random))
  const gap = (color: string): number => {
    const point = shownPoint(color)
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

export interface NameColors {
  readonly light: string
  readonly dark: string
}

function clamp(value: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, value))
}

function readableOn(point: Oklch, scheme: NameScheme): string {
  const l = clamp(scheme.l + (point.l - LIGHTNESS_MID) * 0.8, scheme.lRange)
  const c = clamp(point.c * scheme.chroma, scheme.cRange)
  const candidates = Array.from({ length: 26 }, (_, step) => oklchToHex({ l: l + step * scheme.step, c, h: point.h }))
  return candidates.find((color) => contrastRatio(color, scheme.background) >= NAME_CONTRAST) ?? candidates.at(-1) ?? '#808080'
}

/** 名字在浅色、深色背景上的颜色（#rrggbb）：色相是 bot 自己的，明暗和饱和度按背景定。 */
export function nameColors(bot: { readonly id: string; readonly color?: string }): NameColors {
  const point = hexToOklch(botColorHex(bot)) ?? { l: LIGHTNESS_MID, c: 0.12, h: 0 }
  return { light: readableOn(point, NAME_ON_LIGHT), dark: readableOn(point, NAME_ON_DARK) }
}

/** 把哈希的每一位搅匀（murmur3 的收尾），id 只差一个字的 bot 颜色也差得开。 */
function mixBits(value: number): number {
  const a = Math.imul(value ^ (value >>> 16), 0x85ebca6b)
  const b = Math.imul(a ^ (a >>> 13), 0xc2b2ae35)
  return (b ^ (b >>> 16)) >>> 0
}
