import type { ComponentType } from 'react'

/**
 * Pod 页面用到的 dsh 浏览器端服务，写成最小的结构类型。
 * 对应 dsh 0.2.1 的 slots（侧栏面板列表和主区 keyed slot）、
 * dsh-client-ui-layout（ctx.layout）和 dsh-client-ui-workspace（ctx.uiWorkspace）。
 */

export type Disposer = () => void

/** 侧栏“全局面板”列表里的一行；同一个 id 对应主区里的页面。 */
export interface PanelEntryRegistration {
  readonly name: 'sidebar.panellist'
  readonly id: string
  readonly order?: number
  readonly label: string | (() => string)
}

/** 主区 keyed slot 里的一个页面；inject 返回的对象会作为 props 传给组件。 */
export interface MainPanelRegistration {
  readonly name: 'main'
  readonly key: string
  readonly inject?: () => object
}

export interface Slots {
  /** 等外壳声明了这个座位再注册；返回撤销函数。 */
  inject(name: string, register: () => Disposer): Disposer
  register(registration: PanelEntryRegistration | MainPanelRegistration, component: ComponentType<never>): Disposer
}

export interface Layout {
  /** 选中一个全局面板；null 表示回到对话界面。 */
  selectPanel(id: string | null): void
}

export interface UiWorkspace {
  openSession(sessionId: string): void
}

/** dsh-client-locale 提供的 ctx.locale：dsh 现在的界面语言和变化通知。 */
export interface LocaleRuntime {
  getLocale(): { readonly active: string }
  subscribe(listener: () => void): Disposer
}

export interface ClientContext {
  effect(execute: () => Disposer, label?: string): unknown
  get(name: string): unknown
  readonly slots: Slots
  readonly uiWorkspace: UiWorkspace
}

/** 侧栏行图标拿到的 props：外壳决定尺寸。 */
export interface PanelIconProps {
  readonly size: number
}
