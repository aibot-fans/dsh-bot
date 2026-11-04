import { AIBOT_CSS } from './aibot.ts'
import { BASE_CSS } from './base.ts'
import { BROWSER_CSS } from './browser.ts'
import { BUTTONS_CSS } from './buttons.ts'
import { CARDS_CSS } from './cards.ts'
import { CHAT_CSS } from './chat.ts'
import { COMPUTER_CSS } from './computer.ts'
import { EDITOR_CSS } from './editor.ts'
import { LAYOUT_CSS } from './layout.ts'
import { MOBILE_CSS } from './mobile.ts'
import { PAGES_CSS } from './pages.ts'
import { PANEL_CSS } from './panel.ts'
import { PINS_CSS } from './pins.ts'
import { UPDATE_CSS } from './update.ts'
import { V3_CSS } from './v3.ts'
import { V5_CSS } from './v5.ts'
import { V6_CSS } from './v6.ts'
import { V8_CSS } from './v8.ts'
import { V9_CSS } from './v9.ts'
import { V10_CSS } from './v10.ts'
import { V11_CSS } from './v11.ts'
import { V12_CSS } from './v12.ts'
import { V13_CSS } from './v13.ts'
import { V14_CSS } from './v14.ts'
import { V15_CSS } from './v15.ts'
import { V16_CSS } from './v16.ts'
import { V17_CSS } from './v17.ts'
import { V18_CSS } from './v18.ts'
import { V19_CSS } from './v19.ts'

const STYLE_ID = 'pod-ui/app'

/** 往页面加一次样式表；返回撤销函数，插件卸载时移除。 */
export function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
  if (existing !== null) existing.remove()
  const tag = document.createElement('style')
  tag.dataset.plugin = 'pod-ui'
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = [BASE_CSS, LAYOUT_CSS, CHAT_CSS, EDITOR_CSS, CARDS_CSS, BROWSER_CSS, PANEL_CSS, V3_CSS, V5_CSS, PAGES_CSS, V6_CSS, PINS_CSS, BUTTONS_CSS, AIBOT_CSS, UPDATE_CSS, V8_CSS, V9_CSS, V10_CSS, V11_CSS, V12_CSS, V13_CSS, V14_CSS, V15_CSS, V16_CSS, V17_CSS, V18_CSS, V19_CSS, COMPUTER_CSS, MOBILE_CSS].join('\n')
  document.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}
