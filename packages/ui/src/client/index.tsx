import { addEnglish } from 'pod-domain'
import type { HostActions } from './state/app.ts'
import type { HostLocale } from './state/language.ts'
import type { ClientContext, Layout, LocaleRuntime } from './dsh.ts'
import { UI_EN } from './locales/en.ts'
import { PodIcon } from './PodIcon.tsx'
import { injectStyles } from './styles/index.ts'
import { PodApp } from './views/Shell.tsx'
import { reopenAfterUpdate } from './views/update/reopen.ts'

/** 侧栏行和主区页面共用的面板 id。 */
const PANEL_ID = 'pod'

/** 在侧栏全局面板里的位置：插件页是 0，定时是 10。 */
const PANEL_ORDER = 30

export const inject = ['slots', 'uiWorkspace']

function isLayout(value: unknown): value is Layout {
  return typeof value === 'object' && value !== null && typeof (value as Layout).selectPanel === 'function'
}

function isLocaleRuntime(value: unknown): value is LocaleRuntime {
  return typeof value === 'object' && value !== null && typeof (value as LocaleRuntime).getLocale === 'function' && typeof (value as LocaleRuntime).subscribe === 'function'
}

addEnglish(UI_EN)

/**
 * 注册侧栏的 dsh-bot 入口和主区的 Pod 页面。
 * 两处都走 slots.inject：等外壳声明了座位才注册，和外壳插件的加载顺序无关。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => injectStyles(), 'pod-ui: styles')

  const host: HostActions = {
    openSession(sessionId) {
      ctx.uiWorkspace.openSession(sessionId)
      const layout = ctx.get('layout')
      if (isLayout(layout)) layout.selectPanel(null)
    },
  }

  // dsh 的界面语言（dsh-client-locale）：dsh-bot 的语言设置是“跟随 dsh”时照它显示。
  const locale: HostLocale = {
    get() {
      const runtime = ctx.get('locale')
      return isLocaleRuntime(runtime) ? runtime.getLocale().active : undefined
    },
    subscribe(listener) {
      const runtime = ctx.get('locale')
      return isLocaleRuntime(runtime) ? runtime.subscribe(listener) : () => undefined
    },
  }

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: 'dsh-bot' }, PodIcon),
      ),
    'pod-ui: sidebar entry',
  )
  ctx.effect(
    () => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, inject: () => ({ host, locale }) }, PodApp)),
    'pod-ui: main panel',
  )
  ctx.effect(
    () =>
      reopenAfterUpdate(() => {
        const layout = ctx.get('layout')
        return isLayout(layout) ? layout : undefined
      }, PANEL_ID),
    'pod-ui: reopen after update',
  )
}
