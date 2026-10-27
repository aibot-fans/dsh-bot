import { AIBOT_CSS } from './aibot.ts'
import { BASE_CSS } from './base.ts'
import { BROWSER_CSS } from './browser.ts'
import { BUTTONS_CSS } from './buttons.ts'
import { CARDS_CSS } from './cards.ts'
import { CHAT_CSS } from './chat.ts'
import { EDITOR_CSS } from './editor.ts'
import { LAYOUT_CSS } from './layout.ts'
import { MOBILE_CSS } from './mobile.ts'
import { PAGES_CSS } from './pages.ts'
import { PANEL_CSS } from './panel.ts'
import { PROGRESS_CSS } from './progress.ts'
import { UPDATE_CSS } from './update.ts'
import { V3_CSS } from './v3.ts'
import { V5_CSS } from './v5.ts'
import { V6_CSS } from './v6.ts'

const STYLE_ID = 'pod-ui/app'

/** 往页面加一次样式表；返回撤销函数，插件卸载时移除。 */
export function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
  if (existing !== null) existing.remove()
  const tag = document.createElement('style')
  tag.dataset.plugin = 'pod-ui'
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = [BASE_CSS, LAYOUT_CSS, CHAT_CSS, EDITOR_CSS, CARDS_CSS, BROWSER_CSS, PANEL_CSS, V3_CSS, V5_CSS, PAGES_CSS, V6_CSS, BUTTONS_CSS, AIBOT_CSS, PROGRESS_CSS, UPDATE_CSS, MOBILE_CSS].join('\n')
  document.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}
