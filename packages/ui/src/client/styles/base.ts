/** 基础：外壳布局、导航、按钮、表单、徽标。颜色全部取 dsh 的主题变量。 */
export const BASE_CSS = `
.pod-app { --pod-warn: var(--dsw-alias-state-warning-primary, #b54708); --pod-ok: var(--dsw-alias-state-success-primary, #067647); --pod-danger: var(--dsw-alias-state-error-primary, #b42318); --pod-info: var(--dsw-alias-brand-primary, #3b5bdb); --pod-line: var(--dsw-alias-border-l2); --pod-soft: var(--dsw-alias-interactive-bg-hover); box-sizing: border-box; height: 100%; display: flex; flex-direction: column; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 1.55; padding-top: var(--dsh-frame-top-clearance, 0px); padding-left: var(--dsh-frame-leading-clearance, 0px); }
.pod-app *, .pod-app *::before, .pod-app *::after { box-sizing: border-box; }
.pod-nav { display: flex; align-items: center; gap: 16px; padding: 10px 20px; border-bottom: 1px solid var(--pod-line); flex: none; }
.pod-nav-brand { display: flex; align-items: center; gap: 8px; font-size: 15px; }
.pod-conn { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-label-caption); }
.pod-conn-open { background: var(--pod-ok); }
.pod-conn-connecting { background: var(--pod-warn); }
.pod-nav-tabs { display: flex; gap: 2px; flex: 1; overflow-x: auto; }
.pod-nav-tab { appearance: none; border: 0; background: none; font: inherit; color: var(--dsw-alias-label-secondary); display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
.pod-nav-tab:hover { background: var(--pod-soft); color: var(--dsw-alias-label-primary); }
.pod-nav-tab-active { background: var(--pod-soft); color: var(--dsw-alias-label-primary); font-weight: 600; }
.pod-bell { position: relative; }
.pod-bell-dot { position: absolute; top: -2px; right: -4px; min-width: 15px; height: 15px; border-radius: 8px; padding: 0 3px; font-size: 10px; line-height: 15px; color: #fff; background: var(--pod-danger); }
.pod-hit-read { opacity: .65; }
.pod-nav-search { width: 160px; font: inherit; font-size: 13px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--pod-line); background: var(--dsw-alias-bg-layer-3, transparent); color: var(--dsw-alias-label-primary); }
.pod-nav-search:focus-visible { outline: none; border-color: var(--pod-info); width: 220px; }
.pod-stop-all { appearance: none; font: inherit; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--pod-danger) 40%, transparent); color: var(--pod-danger); background: transparent; cursor: pointer; }
.pod-stop-all:hover { background: color-mix(in srgb, var(--pod-danger) 8%, transparent); }
.pod-banner { padding: 8px 20px; font-size: 13px; color: var(--pod-warn); background: color-mix(in srgb, var(--pod-warn) 10%, transparent); }
.pod-banner-action { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.pod-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.pod-page { flex: 1; min-height: 0; overflow-y: auto; padding: 24px 32px 48px; display: flex; flex-direction: column; gap: 20px; }
.pod-page > * { max-width: 1120px; width: 100%; margin-left: auto; margin-right: auto; }
.pod-page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.pod-page-head h1 { margin: 0; font-size: 20px; font-weight: 600; }
.pod-page-head p { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; max-width: 720px; }
.pod-stack { display: flex; flex-direction: column; gap: 10px; }
.pod-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pod-wrap { flex-wrap: wrap; }
.pod-ellipsis { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pod-section-title { font-size: 12px; color: var(--dsw-alias-label-tertiary); font-weight: 600; letter-spacing: .02em; margin: 4px 0; }
.pod-muted { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 13px; }
.pod-muted-inline { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.pod-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; font-weight: 400; }
.pod-label { font-size: 12px; color: var(--dsw-alias-label-tertiary); margin-right: 6px; }
.pod-pre { white-space: pre-wrap; margin: 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.pod-icon { flex: none; }
.pod-avatar { position: relative; flex: none; border-radius: 50%; display: inline-grid; place-items: center; user-select: none; }
.pod-boticon { display: block; flex: none; overflow: hidden; border-radius: 50%; }
.pod-boticon > img, .pod-botfigure > img { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
.pod-botfigure { display: block; flex: none; }
.pod-botfigure-tinted { border-radius: 24%; overflow: hidden; }
.pod-avatar-dot { position: absolute; right: -1px; bottom: -1px; width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--dsw-alias-bg-layer-1, #fff); }
.pod-avatar-dot-busy { background: var(--pod-ok); }
.pod-avatar-dot-waiting { background: var(--pod-warn); }
.pod-avatar-dot-idle { background: var(--dsw-alias-label-caption); }
.pod-button { appearance: none; font: inherit; font-size: 13px; line-height: 1.5; display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px; border-radius: 8px; border: 1px solid var(--pod-line); background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; white-space: nowrap; }
.pod-button:hover:not(:disabled) { background: var(--pod-soft); }
.pod-button:disabled { opacity: .45; cursor: default; }
.pod-button-small { padding: 3px 10px; font-size: 12px; }
.pod-button-primary { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-1, #fff); border-color: transparent; }
.pod-button-primary:hover:not(:disabled) { background: var(--dsw-alias-label-primary); opacity: .88; }
.pod-button-quiet { border-color: transparent; color: var(--dsw-alias-label-secondary); }
.pod-button-danger { color: var(--pod-danger); border-color: color-mix(in srgb, var(--pod-danger) 40%, transparent); }
.pod-button:focus-visible, .pod-link:focus-visible, .pod-icon-button:focus-visible, .pod-nav-tab:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; }
.pod-icon-button { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); width: 26px; height: 26px; border-radius: 6px; display: inline-grid; place-items: center; cursor: pointer; }
.pod-icon-button:hover:not(:disabled) { background: var(--pod-soft); color: var(--dsw-alias-label-primary); }
.pod-link { appearance: none; border: 0; background: none; padding: 0; font: inherit; font-size: 13px; color: var(--dsw-alias-label-secondary); cursor: pointer; text-align: left; }
.pod-link:hover { color: var(--dsw-alias-label-primary); text-decoration: underline; }
.pod-badge { flex: none; display: inline-flex; align-items: center; padding: 0 8px; border-radius: 999px; font-size: 11px; line-height: 18px; white-space: nowrap; color: var(--dsw-alias-label-secondary); background: var(--pod-soft); }
.pod-badge-info { color: var(--pod-info); background: color-mix(in srgb, var(--pod-info) 12%, transparent); }
.pod-badge-ok { color: var(--pod-ok); background: color-mix(in srgb, var(--pod-ok) 12%, transparent); }
.pod-badge-warn { color: var(--pod-warn); background: color-mix(in srgb, var(--pod-warn) 14%, transparent); }
.pod-badge-danger { color: var(--pod-danger); background: color-mix(in srgb, var(--pod-danger) 12%, transparent); }
.pod-tag { flex: none; padding: 1px 8px; border-radius: 999px; font-size: 11px; color: var(--dsw-alias-label-secondary); background: var(--pod-soft); }
.pod-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.pod-unread { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; font-size: 11px; line-height: 18px; text-align: center; color: #fff; background: var(--pod-info); }
.pod-unread-warn { background: var(--pod-warn); }
.pod-chip { appearance: none; font: inherit; font-size: 12px; padding: 3px 12px; border-radius: 999px; border: 1px solid var(--pod-line); background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.pod-chip-active { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-1, #fff); border-color: transparent; }
.pod-tabs { display: flex; gap: 6px; }
.pod-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-radius: 10px; font-size: 13px; color: var(--pod-danger); background: color-mix(in srgb, var(--pod-danger) 8%, transparent); }
.pod-form-error { margin: 0; color: var(--pod-danger); font-size: 12px; }
.pod-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 40px 16px; color: var(--dsw-alias-label-tertiary); text-align: center; font-size: 13px; }
.pod-empty strong { color: var(--dsw-alias-label-secondary); font-size: 14px; }
.pod-form { display: flex; flex-direction: column; gap: 12px; }
.pod-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.pod-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 500; }
.pod-field-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pod-input, .pod-textarea { width: 100%; font: inherit; font-size: 13px; font-weight: 400; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-3, transparent); border: 1px solid var(--pod-line); border-radius: 8px; padding: 6px 10px; }
.pod-input-number { width: 120px; }
.pod-input-time { width: 110px; }
.pod-textarea { resize: vertical; line-height: 1.6; }
.pod-textarea-small { min-height: 0; }
.pod-input:focus-visible, .pod-textarea:focus-visible { outline: none; border-color: var(--pod-info); }
.pod-form-actions { display: flex; justify-content: flex-end; gap: 8px; }
.pod-check-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.pod-toggle { width: 16px; height: 16px; }
.pod-drawer-backdrop { position: fixed; inset: 0; z-index: 50; background: color-mix(in srgb, #000 28%, transparent); display: flex; justify-content: flex-end; }
.pod-drawer { width: min(520px, 100%); height: 100%; background: var(--dsw-alias-bg-layer-1, #fff); border-left: 1px solid var(--pod-line); display: flex; flex-direction: column; box-shadow: -8px 0 24px color-mix(in srgb, #000 12%, transparent); }
.pod-drawer-wide { width: min(760px, 100%); }
.pod-drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--pod-line); padding-top: calc(var(--dsh-frame-top-clearance, 0px) + 14px); }
.pod-drawer-head h2 { margin: 0; font-size: 16px; }
.pod-drawer-body { flex: 1; overflow-y: auto; padding: 16px 18px 32px; }
.pod-menu { margin: 0 10px 8px; padding: 6px; border: 1px solid var(--pod-line); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); display: flex; flex-direction: column; gap: 2px; }
.pod-menu-tabs { display: flex; gap: 4px; padding: 4px; }
.pod-menu-item { appearance: none; border: 0; background: none; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; text-align: left; }
.pod-menu-item:hover { background: var(--pod-soft); }
.pod-menu-footer { color: var(--dsw-alias-label-secondary); border-top: 1px solid var(--pod-line); margin-top: 4px; padding-top: 8px; }
@media (max-width: 720px) { .pod-page { padding: 16px; } .pod-nav { padding: 8px 12px; gap: 8px; } .pod-nav-tab span { display: none; } }
`
