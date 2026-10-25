import type { PageAccent } from 'pod-domain'

/**
 * 页面的样式变量：浅色和深色各一套，跟着 dsh 切换（外层用地址参数和消息告诉页面），
 * 直接打开时跟系统设置走。图表的八个分类色、热力图的顺序色和发散色取自校验过的配色（浅深各自选定，不是自动反色）。
 */

type Tokens = Readonly<Record<string, string>>

const LIGHT: Tokens = {
  page: '#f7f7f5',
  surface: '#ffffff',
  'surface-2': '#f3f2ef',
  ink: '#0b0b0b',
  'ink-2': '#52514e',
  'ink-3': '#898781',
  line: '#e6e5df',
  axis: '#c3c2b7',
  ring: 'rgba(11,11,11,.10)',
  ok: '#067647',
  warn: '#b54708',
  bad: '#b42318',
  info: '#3b5bdb',
  'ok-mark': '#0ca30c',
  'warn-mark': '#fab219',
  'bad-mark': '#d03b3b',
  c1: '#2a78d6',
  c2: '#eb6834',
  c3: '#1baf7a',
  c4: '#eda100',
  c5: '#e87ba4',
  c6: '#008300',
  c7: '#6250d6',
  c8: '#e34948',
}

const DARK: Tokens = {
  page: '#0d0d0d',
  surface: '#1a1a19',
  'surface-2': '#242422',
  ink: '#f0efec',
  'ink-2': '#c3c2b7',
  'ink-3': '#898781',
  line: '#2c2c2a',
  axis: '#45453f',
  ring: 'rgba(255,255,255,.10)',
  ok: '#2fb170',
  warn: '#f0a03c',
  bad: '#f06a5f',
  info: '#7b96f2',
  'ok-mark': '#0ca30c',
  'warn-mark': '#fab219',
  'bad-mark': '#d03b3b',
  c1: '#3987e5',
  c2: '#d95926',
  c3: '#199e70',
  c4: '#c98500',
  c5: '#d55181',
  c6: '#008300',
  c7: '#9085e9',
  c8: '#e66767',
}

/** 顺序色（热力图）：从接近底色到最深，9 档；深色模式从暗到亮。 */
const HEAT_LIGHT = ['#eef4fc', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#2a78d6', '#1c5cab', '#184f95', '#0d366b']
const HEAT_DARK = ['#1c2430', '#1d3452', '#214775', '#245a99', '#2a6dc0', '#3987e5', '#5598e7', '#86b6ef', '#b7d3f6']
/** 发散色：负数红、正数蓝，中间是灰，9 档（第 5 档是中点）。 */
const DIVERGE_LIGHT = ['#b42318', '#d9534a', '#ec8e86', '#f6c8c3', '#f0efec', '#c6daf7', '#8fb8ee', '#4f8fe0', '#1c5cab']
const DIVERGE_DARK = ['#f06a5f', '#c9473f', '#8e3a35', '#4f2a28', '#383835', '#233a5c', '#2a5591', '#3a78cf', '#86b6ef']

const ACCENTS: Readonly<Record<PageAccent, readonly [string, string]>> = {
  blue: ['#3b5bdb', '#7b96f2'],
  teal: ['#0f7f7c', '#2bb3ae'],
  green: ['#067647', '#2fb170'],
  orange: ['#c4510f', '#f08a4b'],
  red: ['#b42318', '#f06a5f'],
  purple: ['#6a4bd6', '#9a86f0'],
  gray: ['#52514e', '#c3c2b7'],
}

/** 格子上的字：w 白字、k 黑字、i 跟正文同色（按格子深浅选，保证看得清）。 */
type Ink = 'w' | 'k' | 'i'
const HEAT_TEXT_LIGHT: readonly Ink[] = ['i', 'i', 'i', 'i', 'w', 'w', 'w', 'w', 'w']
const HEAT_TEXT_DARK: readonly Ink[] = ['i', 'i', 'i', 'i', 'i', 'k', 'k', 'k', 'k']
const DIVERGE_TEXT_LIGHT: readonly Ink[] = ['w', 'w', 'i', 'i', 'i', 'i', 'i', 'w', 'w']
const DIVERGE_TEXT_DARK: readonly Ink[] = ['k', 'w', 'i', 'i', 'i', 'i', 'i', 'w', 'k']
const INK_COLORS: Readonly<Record<Ink, string>> = { w: '#fff', k: '#111', i: 'var(--ink)' }

function vars(tokens: Tokens): string {
  return Object.entries(tokens)
    .map(([key, value]) => `--${key}:${value}`)
    .join(';')
}

function bins(prefix: string, colors: readonly string[]): string {
  return colors.map((color, index) => `--${prefix}${index}:${color}`).join(';')
}

function accentRules(index: 0 | 1, scope: string): string {
  return (Object.entries(ACCENTS) as [PageAccent, readonly [string, string]][]).map(([name, pair]) => `${scope}[data-accent="${name}"]{--accent:${pair[index]}}`).join('')
}

function textRules(prefix: string, inks: readonly Ink[], scope: string): string {
  return inks.map((ink, index) => `${scope} .${prefix}${index}{color:${INK_COLORS[ink]}}`).join('')
}

const lightBlock = `color-scheme:light;${vars(LIGHT)};${bins('h', HEAT_LIGHT)};${bins('d', DIVERGE_LIGHT)}`
const darkBlock = `color-scheme:dark;${vars(DARK)};${bins('h', HEAT_DARK)};${bins('d', DIVERGE_DARK)}`

/** 样式变量：默认浅色；系统深色且没强制浅色时、或者强制深色时用深色。 */
export const TOKENS_CSS = [
  `:root{${lightBlock};--accent:${ACCENTS.blue[0]}}`,
  accentRules(0, ':root'),
  textRules('h', HEAT_TEXT_LIGHT, ':root'),
  textRules('d', DIVERGE_TEXT_LIGHT, ':root'),
  `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${darkBlock};--accent:${ACCENTS.blue[1]}}${accentRules(1, ':root:not([data-theme="light"])')}${textRules('h', HEAT_TEXT_DARK, ':root:not([data-theme="light"])')}${textRules('d', DIVERGE_TEXT_DARK, ':root:not([data-theme="light"])')}}`,
  `:root[data-theme="dark"]{${darkBlock};--accent:${ACCENTS.blue[1]}}`,
  accentRules(1, ':root[data-theme="dark"]'),
  textRules('h', HEAT_TEXT_DARK, ':root[data-theme="dark"]'),
  textRules('d', DIVERGE_TEXT_DARK, ':root[data-theme="dark"]'),
].join('\n')

/** 海报自己定底色，不跟深浅色走：在海报范围里换一套变量。 */
export const POSTER_TOKENS_CSS = [
  `.poster.bg-light{${vars(LIGHT)};--accent:var(--poster-accent)}`,
  `.poster.bg-dark{${vars(DARK)};--accent:var(--poster-accent-dark)}`,
  `.poster.bg-accent,.poster.bg-gradient{${vars(DARK)};--surface:rgba(255,255,255,.12);--surface-2:rgba(255,255,255,.08);--ink:#ffffff;--ink-2:rgba(255,255,255,.86);--ink-3:rgba(255,255,255,.66);--line:rgba(255,255,255,.22);--axis:rgba(255,255,255,.35)}`,
].join('\n')

export function accentPair(accent: PageAccent): readonly [string, string] {
  return ACCENTS[accent]
}

export const HEAT_BINS = HEAT_LIGHT.length
