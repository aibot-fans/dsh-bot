import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** 屏幕尺寸，加上四边被菜单栏、Dock 或任务栏占掉的宽度（CSS 像素）。 */
export interface ScreenSize {
  readonly width: number
  readonly height: number
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

/** 读不到本机屏幕时用常见的 1920×1080，按平台扣掉菜单栏和 Dock，或者任务栏。 */
function fallback(): ScreenSize {
  const base = { width: 1920, height: 1080, top: 0, bottom: 0, left: 0, right: 0 }
  if (process.platform === 'darwin') return { ...base, top: 30, bottom: 80 }
  if (process.platform === 'win32') return { ...base, bottom: 48 }
  return base
}

// AppKit 的坐标原点在左下角；visibleFrame 是扣掉菜单栏和 Dock 之后的区域。第一块屏幕是带菜单栏的主屏。
const MAC_SCREEN = [
  'ObjC.import("AppKit")',
  'const s = $.NSScreen.screens.objectAtIndex(0), f = s.frame, v = s.visibleFrame',
  'JSON.stringify({ width: f.size.width, height: f.size.height, left: v.origin.x - f.origin.x, right: f.origin.x + f.size.width - v.origin.x - v.size.width, top: f.origin.y + f.size.height - v.origin.y - v.size.height, bottom: v.origin.y - f.origin.y })',
].join('; ')

/** 本机主屏幕：macOS 从 AppKit 读；其他平台、或者读不到（比如没有图形界面）时用常见值。 */
export async function readScreen(): Promise<ScreenSize> {
  if (process.platform !== 'darwin') return fallback()
  try {
    const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', MAC_SCREEN], { timeout: 3000 })
    const raw = JSON.parse(stdout) as Readonly<Record<string, unknown>>
    const size = (key: keyof ScreenSize): number => Math.round(Number(raw[key]))
    const screen: ScreenSize = { width: size('width'), height: size('height'), top: size('top'), bottom: size('bottom'), left: size('left'), right: size('right') }
    const valid = Object.values(screen).every((value) => Number.isFinite(value) && value >= 0) && screen.width > 0 && screen.height > 0
    return valid ? screen : fallback()
  } catch {
    return fallback()
  }
}

/** 无头 Chrome 的屏幕参数：不给的话是 800×600，比 1280×800 的窗口还小，也没有菜单栏和 Dock。 */
export function screenInfoArg(screen: ScreenSize): string {
  return `--screen-info={${screen.width}x${screen.height} workAreaLeft=${screen.left} workAreaRight=${screen.right} workAreaTop=${screen.top} workAreaBottom=${screen.bottom}}`
}
