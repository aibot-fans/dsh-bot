/**
 * 手机和触屏：760px 以下一次一页（列表、对话、整页的详情和设置），菜单从底下升起；
 * 能点的地方至少 44px，输入框 16px（iOS 上更小会放大页面），底部留出安全区，弹键盘时输入框跟着上来。
 * 放在最后，盖过前面各处的宽屏样式。
 */
export const MOBILE_CSS = `
.pod-sheet-backdrop { position: fixed; inset: 0; z-index: 70; display: flex; flex-direction: column; justify-content: flex-end; background: color-mix(in srgb, #000 32%, transparent); animation: pod-fade-in .14s ease-out; }
.pod-sheet { display: flex; flex-direction: column; max-height: 82%; margin: 0 8px calc(8px + env(safe-area-inset-bottom, 0px)); padding: 6px; border-radius: 16px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 -8px 30px color-mix(in srgb, #000 16%, transparent); color: var(--dsw-alias-label-primary); font-size: 15px; animation: pod-sheet-up .18s ease-out; }
.pod-sheet-title { flex: none; padding: 8px 12px 6px; font-size: 12.5px; color: var(--dsw-alias-label-tertiary); text-align: center; }
.pod-sheet-body { display: flex; flex-direction: column; gap: 1px; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.pod-sheet .pod-menu-item { width: 100%; min-height: 48px; padding: 0 12px; border-radius: 10px; font-size: 15.5px; }
.pod-sheet .pod-menu-icon { width: 20px; }
.pod-sheet .pod-menu-hint { max-width: 50%; font-size: 12.5px; }
.pod-sheet .pod-menu-form { padding: 8px 6px; }
.pod-sheet-cancel { appearance: none; flex: none; min-height: 48px; margin-top: 4px; border: 0; border-top: 1px solid var(--pod-line); background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 15.5px; font-weight: 600; cursor: pointer; }
.pod-sheet-wide .pod-history, .pod-sheet-wide .pod-usage-popover { width: auto; }
@keyframes pod-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes pod-sheet-up { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .pod-sheet-backdrop, .pod-sheet { animation: none; } }
.pod-panel-back { order: -1; margin-right: auto; }
.pod-select-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 16px; line-height: 1.7; -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }

@media (hover: none) {
  .pod-msg { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
  .pod-msg-pressed { border-radius: 12px; background: var(--pod-soft); box-shadow: 0 0 0 6px var(--pod-soft); }
  .pod-history-remove, .pod-hero-title .pod-icon { opacity: 1; }
}

@media (max-width: 760px) {
  .pod-layout, .pod-layout-panel, .pod-layout-collapsed, .pod-layout-collapsed.pod-layout-panel { grid-template-columns: minmax(0, 1fr); }
  .pod-input, .pod-editor, .pod-editor-placeholder, .pod-app textarea, .pod-app select { font-size: 16px; }

  .pod-side { border-right: 0; padding: 6px 6px calc(6px + env(safe-area-inset-bottom, 0px)); }
  .pod-side-top { gap: 6px; padding: 4px 4px 8px 10px; }
  .pod-side-top .pod-round { width: 44px; height: 44px; }
  .pod-side-brand { font-size: 18px; }
  .pod-side-section { min-height: 36px; padding: 12px 2px 4px 12px; font-size: 12.5px; }
  .pod-side-section .pod-icon-button, .pod-side-folder .pod-icon-button { width: 44px; height: 36px; }
  .pod-side-folder-toggle { min-height: 36px; font-size: 13px; }
  .pod-side-row-tall { gap: 12px; min-height: 68px; padding: 8px 10px; }
  .pod-side-row-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .pod-side-row-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .pod-side-row-tall .pod-side-row-title { font-size: 16px; font-weight: 500; }
  .pod-side-row-time { flex: none; font-size: 12px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
  .pod-side-row-preview { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; color: var(--dsw-alias-label-tertiary); }
  .pod-side-toggle { min-height: 44px; font-size: 14px; }
  .pod-side-empty { font-size: 13px; }
  .pod-side-bottom .pod-side-row { min-height: 48px; }

  .pod-convo-head { gap: 2px; min-height: 52px; padding: 4px 6px 4px 4px; }
  .pod-convo-head .pod-head-button { width: 44px; height: 44px; border-radius: 12px; }
  .pod-convo-title { flex: 0 1 auto; min-width: 0; min-height: 44px; padding: 4px 8px 4px 4px; }
  .pod-convo-title strong { min-width: 0; font-size: 16px; }
  .pod-convo-title > svg { flex: none; color: var(--dsw-alias-label-tertiary); }
  .pod-convo { padding-bottom: var(--pod-keyboard, 0px); }

  .pod-timeline-inner { padding: 8px 12px 16px; }
  .pod-msg-card, .pod-line, .pod-folded, .pod-msg-routing { padding-left: 0; }
  .pod-msg-card > * { max-width: 100%; }
  .pod-bubble { max-width: 88%; }
  .pod-jump-latest { bottom: 12px; width: 44px; height: 44px; }
  .pod-composer { padding: 0 8px calc(8px + env(safe-area-inset-bottom, 0px)); }
  .pod-keyboard-open .pod-composer { padding-bottom: 6px; }
  .pod-composer-row .pod-icon-button, .pod-send { width: 40px; height: 40px; }
  .pod-mentions { left: 8px; right: 8px; width: auto; }
  .pod-mentions button { min-height: 44px; font-size: 15px; }
  .pod-progress { max-width: none; }

  .pod-panel, .pod-panel-wide { left: 0; width: auto; border-left: 0; box-shadow: none; }
  .pod-panel-top { padding: 6px 8px 0; }
  .pod-panel-top-row { padding: 6px 8px; }
  .pod-panel-top .pod-round, .pod-panel-top .pod-icon-button { width: 44px; height: 44px; }
  .pod-panel-top .pod-back { min-height: 44px; }
  .pod-panel-scroll { padding: 4px 14px calc(24px + env(safe-area-inset-bottom, 0px)); }
  .pod-panel-tabs button { min-height: 40px; font-size: 15px; }

  .pod-drawer, .pod-drawer-wide { width: 100%; border-left: 0; }
  .pod-drawer-head, .pod-modal-head { justify-content: flex-start; gap: 4px; padding: 6px 10px 6px 4px; }
  .pod-modal-head { padding-top: calc(6px + var(--dsh-frame-top-clearance, 0px)); }
  .pod-drawer-head h2, .pod-modal-head h2 { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pod-drawer-head .pod-icon-button, .pod-modal-head .pod-icon-button, .pod-settings-head .pod-icon-button { width: 44px; height: 44px; }
  .pod-drawer-body { padding: 12px 14px calc(24px + env(safe-area-inset-bottom, 0px)); }
  .pod-modal-backdrop { align-items: stretch; padding: 0; }
  .pod-modal, .pod-modal-wide { width: 100%; height: 100%; max-height: none; border-radius: 0; }
  .pod-modal-body { padding: 6px 14px calc(20px + env(safe-area-inset-bottom, 0px)); }

  .pod-settings { flex-direction: column; width: 100%; height: 100%; border-radius: 0; }
  .pod-settings-nav { flex-direction: row; flex-wrap: nowrap; gap: 4px; width: auto; padding: calc(8px + var(--dsh-frame-top-clearance, 0px)) 10px 8px; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--pod-line); scrollbar-width: none; }
  .pod-settings-nav::-webkit-scrollbar { display: none; }
  .pod-settings-nav button { flex: none; min-height: 40px; white-space: nowrap; }
  .pod-settings-title, .pod-settings-nav .pod-grow { display: none; }
  .pod-settings-content { padding: 8px 14px calc(24px + env(safe-area-inset-bottom, 0px)); }
  .pod-settings-head { justify-content: flex-start; gap: 4px; margin-left: -10px; }
  .pod-settings-head h2 { flex: 1; min-width: 0; }
  .pod-usage-line { grid-template-columns: 100px minmax(0, 1fr); }

  .pod-viewer-head { gap: 4px; min-height: 52px; padding: 4px 6px; }
  .pod-viewer-head .pod-icon-button, .pod-viewer-head .pod-head-button { width: 44px; height: 44px; }
  .pod-viewer-head .pod-button-small { min-height: 36px; }
  .pod-viewer-body { grid-template-rows: minmax(0, 1fr) minmax(280px, 52%); }
  .pod-viewer-body-full { grid-template-rows: minmax(0, 1fr); }
  .pod-viewer-body-full .pod-viewer-side { display: none; }
}
`
