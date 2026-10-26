/**
 * OKLCH 和 sRGB 十六进制互转。OKLCH 的 L 是人眼感觉到的明暗：同一个 L 下换色相，深浅看起来差不多，
 * 适合批量生成“都看得清”的颜色。公式来自 Björn Ottosson 的 OKLab。
 */

export interface Oklch {
  /** 明暗，0 到 1。 */
  readonly l: number
  /** 饱和度，0 起，屏幕上能显示的一般不超过 0.37。 */
  readonly c: number
  /** 色相，0 到 360 度。 */
  readonly h: number
}

type Rgb = readonly [number, number, number]

const HEX = /^#([0-9a-f]{6})$/i

function toGamma(value: number): number {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
}

function toLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function labOf(color: Oklch): readonly [number, number] {
  const rad = (color.h * Math.PI) / 180
  return [color.c * Math.cos(rad), color.c * Math.sin(rad)]
}

/** OKLCH 换成线性 sRGB，超出屏幕能显示的范围时会小于 0 或大于 1。 */
function linearRgb(color: Oklch): Rgb {
  const [a, b] = labOf(color)
  const l = (color.l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (color.l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (color.l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function inGamut(rgb: Rgb): boolean {
  return rgb.every((value) => value >= -1e-4 && value <= 1 + 1e-4)
}

/** 超出屏幕能显示的范围时，明暗和色相不变，饱和度往下二分到刚好能显示。 */
function fitChroma(color: Oklch): Oklch {
  if (inGamut(linearRgb(color))) return color
  const [low] = Array.from({ length: 20 }).reduce<readonly [number, number]>(
    ([lo, hi]) => {
      const mid = (lo + hi) / 2
      return inGamut(linearRgb({ ...color, c: mid })) ? [mid, hi] : [lo, mid]
    },
    [0, color.c],
  )
  return { ...color, c: low }
}

function channelHex(value: number): string {
  const gamma = toGamma(Math.min(1, Math.max(0, value)))
  return Math.round(Math.min(1, Math.max(0, gamma)) * 255)
    .toString(16)
    .padStart(2, '0')
}

/** 转成 #rrggbb。 */
export function oklchToHex(color: Oklch): string {
  return `#${linearRgb(fitChroma(color)).map(channelHex).join('')}`
}

/** #rrggbb 转成 OKLCH；不是这个写法返回 undefined。 */
export function hexToOklch(hex: string): Oklch | undefined {
  const digits = HEX.exec(hex.trim())?.[1]
  if (digits === undefined) return undefined
  const value = Number.parseInt(digits, 16)
  const r = toLinear((value >> 16) / 255)
  const g = toLinear(((value >> 8) & 255) / 255)
  const b = toLinear((value & 255) / 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const labA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const labB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    c: Math.hypot(labA, labB),
    h: ((Math.atan2(labB, labA) * 180) / Math.PI + 360) % 360,
  }
}

/** WCAG 的相对亮度，0 到 1；不是 #rrggbb 当成黑色。 */
function luminance(hex: string): number {
  const digits = HEX.exec(hex.trim())?.[1]
  if (digits === undefined) return 0
  const value = Number.parseInt(digits, 16)
  return 0.2126 * toLinear((value >> 16) / 255) + 0.7152 * toLinear(((value >> 8) & 255) / 255) + 0.0722 * toLinear((value & 255) / 255)
}

/** 两种颜色的对比度（WCAG），1 到 21：正文要 4.5 以上。 */
export function contrastRatio(x: string, y: string): number {
  const [light, dark] = [luminance(x), luminance(y)].sort((left, right) => right - left)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

/** 两种颜色看起来差多少（OKLab 里的距离）：0.1 以上一眼能分开。 */
export function colorDistance(x: Oklch, y: Oklch): number {
  const [ax, bx] = labOf(x)
  const [ay, by] = labOf(y)
  return Math.hypot(x.l - y.l, ax - ay, bx - by)
}
