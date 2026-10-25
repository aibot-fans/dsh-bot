/** 外壳：左侧栏、中间对话、右侧面板三栏，顶部的对象、用量和“…”菜单。颜色取 dsh 的主题变量。 */
export const LAYOUT_CSS = `
.pod-app { --pod-side-bg: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, var(--dsw-alias-bg-layer-1, #fff)); --pod-bubble: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, var(--dsw-alias-bg-layer-1, #fff)); --pod-series: var(--pod-info); --pod-grid: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent); --pod-axis: color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent); --pod-panel-width: minmax(360px, 440px); }
.pod-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: 248px minmax(0, 1fr); }
.pod-layout-panel { grid-template-columns: 248px minmax(0, 1fr) var(--pod-panel-width); }
.pod-layout-collapsed { grid-template-columns: 64px minmax(0, 1fr); }
.pod-layout-collapsed.pod-layout-panel { grid-template-columns: 64px minmax(0, 1fr) var(--pod-panel-width); }
.pod-layout-panel:has(.pod-panel-wide) { --pod-panel-width: minmax(420px, 44%); }
.pod-side { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--pod-side-bg); border-right: 1px solid var(--pod-line); padding: 10px 10px 8px; }
.pod-side-top { display: flex; align-items: center; gap: 4px; padding: 2px 0 10px; }
.pod-side-top .pod-round { width: 34px; height: 34px; }
.pod-side-fold { width: 32px; height: 32px; border-radius: 8px; color: var(--dsw-alias-label-secondary); }
.pod-side-brand { display: inline-flex; align-items: center; gap: 6px; margin-right: auto; font-weight: 700; font-size: 16px; letter-spacing: -.01em; }
.pod-side-error { padding: 0 8px 6px; }
.pod-round { appearance: none; flex: none; width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--pod-line); background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 1px 2px color-mix(in srgb, #000 6%, transparent); display: inline-grid; place-items: center; color: var(--dsw-alias-label-primary); cursor: pointer; padding: 0; }
.pod-round:hover { background: var(--pod-soft); }
.pod-round:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; }
.pod-round-small { width: 32px; height: 32px; }
.pod-side-scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }
.pod-side-section { display: flex; align-items: center; justify-content: space-between; min-height: 30px; padding: 10px 2px 2px 10px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.pod-side-row { appearance: none; position: relative; display: flex; align-items: center; gap: 10px; width: 100%; min-height: 40px; padding: 6px 8px; border: 0; border-radius: 10px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.pod-side-row:hover { background: var(--pod-soft); }
.pod-side-row:focus-visible { outline: 2px solid var(--pod-info); outline-offset: -2px; }
.pod-side-row-active { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
.pod-side-row-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.pod-side-busy { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--pod-info); animation: pod-blink 1.6s infinite; }
.pod-side-empty { margin: 0; padding: 4px 10px; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }
.pod-side-bottom { display: flex; align-items: center; gap: 4px; margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--pod-line); }
.pod-side-bottom .pod-side-row { flex: 1; }
.pod-side-divider { display: block; width: 24px; height: 1px; margin: 0 auto; background: var(--pod-line); }
.pod-side-collapsed { padding: 10px 6px 8px; align-items: stretch; }
.pod-side-collapsed .pod-side-top { flex-direction: column; padding: 0 0 8px; }
.pod-side-collapsed .pod-side-section { justify-content: center; padding: 8px 0 4px; }
.pod-side-collapsed .pod-side-row { justify-content: center; padding: 6px; }
.pod-side-collapsed .pod-side-busy { position: absolute; top: 5px; right: 6px; }
.pod-side-collapsed .pod-side-bottom { flex-direction: column; }
.pod-avatar-image { display: block; width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.pod-convo { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--dsw-alias-bg-layer-1, #fff); }
.pod-convo-head { display: flex; align-items: center; gap: 8px; min-height: 56px; padding: 10px 16px 10px 18px; }
.pod-convo-title { appearance: none; display: inline-flex; align-items: center; gap: 8px; min-width: 0; padding: 4px 10px 4px 4px; border: 0; border-radius: 10px; background: none; color: inherit; font: inherit; cursor: pointer; }
.pod-convo-title:hover { background: var(--pod-soft); }
.pod-convo-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
.pod-convo-group { display: flex; align-items: center; gap: 4px; min-width: 0; }
.pod-convo-icon { appearance: none; flex: none; display: inline-grid; padding: 2px; border: 0; border-radius: 10px; background: none; cursor: pointer; }
.pod-convo-icon:hover { background: var(--pod-soft); }
.pod-convo-name { appearance: none; min-width: 0; padding: 4px 6px; border: 0; border-radius: 8px; background: none; color: inherit; font: inherit; cursor: text; }
.pod-convo-name:hover { background: var(--pod-soft); }
.pod-convo-name strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
.pod-convo-rename { width: 220px; font-size: 14px; }
.pod-convo-head-gap { flex: 1; }
.pod-usage-chip { appearance: none; padding: 5px 12px; border: 1px solid var(--pod-line); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12.5px; white-space: nowrap; cursor: pointer; }
.pod-usage-chip:hover { background: var(--pod-soft); }
.pod-popover-anchor { position: relative; }
.pod-popover { position: absolute; top: calc(100% + 6px); right: 0; z-index: 30; display: flex; flex-direction: column; gap: 2px; min-width: 220px; padding: 6px; border: 1px solid var(--pod-line); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 12px 32px color-mix(in srgb, #000 14%, transparent); }
.pod-popover-menu { width: 230px; }
.pod-usage-popover { display: flex; flex-direction: column; gap: 8px; padding: 6px; }
.pod-usage-background { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pod-usage-total { display: flex; flex-direction: column; gap: 2px; }
.pod-usage-total strong { font-size: 20px; }
.pod-usage-row { display: grid; grid-template-columns: 120px minmax(0, 1fr) 56px; gap: 8px; align-items: center; font-size: 13px; }
.pod-usage-bar { height: 6px; overflow: hidden; border-radius: 3px; background: var(--pod-soft); }
.pod-usage-bar span { display: block; height: 100%; border-radius: 0 3px 3px 0; background: var(--pod-series); }
.pod-usage-value { text-align: right; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
.pod-menu-danger { color: var(--pod-danger); }
.pod-menu-label { padding: 6px 8px 2px; font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
.pod-menu-divider { height: 1px; margin: 4px 0; background: var(--pod-line); }
.pod-menu-check { display: inline-grid; place-items: center; width: 16px; color: var(--pod-info); }
.pod-banner { flex: none; }
@media (max-width: 1100px) {
  .pod-layout-panel, .pod-layout-collapsed.pod-layout-panel { grid-template-columns: 220px minmax(0, 1fr); }
  .pod-layout-collapsed.pod-layout-panel { grid-template-columns: 64px minmax(0, 1fr); }
  .pod-panel { position: fixed; top: 0; right: 0; bottom: 0; z-index: 40; width: min(460px, 100%); box-shadow: -8px 0 24px color-mix(in srgb, #000 12%, transparent); padding-top: var(--dsh-frame-top-clearance, 0px); }
  .pod-panel-wide { width: min(720px, 100%); }
}
@media (max-width: 760px) {
  .pod-layout, .pod-layout-panel, .pod-layout-collapsed.pod-layout-panel { grid-template-columns: 64px minmax(0, 1fr); }
  .pod-side { padding: 10px 6px 8px; }
  .pod-side-brand, .pod-side-row-title, .pod-side-section span, .pod-side-section .pod-icon-button, .pod-side-empty, .pod-side .pod-badge { display: none; }
  .pod-side-top { flex-direction: column; padding: 0 0 8px; }
  .pod-side-row { justify-content: center; padding: 6px; }
  .pod-usage-chip { display: none; }
}
`
