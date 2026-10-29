/** 右侧面板（bot 详情、群聊详情、浏览器）、开关和分段按钮、弹窗、设置和用量图。 */
export const PANEL_CSS = `
.pod-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-left: 1px solid var(--pod-line); background: var(--pod-side-bg); }
.pod-panel-top { display: flex; justify-content: flex-end; padding: 12px 14px 0; }
.pod-panel-top-row { justify-content: flex-start; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--pod-line); }
.pod-panel-scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding: 4px 18px 28px; }
.pod-panel-wide .pod-panel-scroll { padding-top: 14px; }
.pod-panel-hero { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; }
.pod-hero-avatar { appearance: none; position: relative; padding: 0; border: 0; border-radius: 50%; background: none; cursor: pointer; }
.pod-hero-avatar:has(.pod-botfigure) { border-radius: 24%; }
.pod-hero-avatar:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 3px; }
.pod-hero-avatar-edit { position: absolute; right: 0; bottom: 2px; display: grid; place-items: center; width: 26px; height: 26px; border: 1px solid var(--pod-line); border-radius: 50%; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-secondary); }
.pod-hero-avatar:has(.pod-botfigure) .pod-hero-avatar-edit { right: -6px; bottom: -6px; }
.pod-icon-picker { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 4px; width: 100%; max-height: 312px; overflow-y: auto; padding: 8px; border: 1px solid var(--pod-line); border-radius: 18px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 8px 24px color-mix(in srgb, #000 8%, transparent); }
.pod-icon-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 4px; max-height: 236px; overflow-y: auto; padding: 4px; border: 1px solid var(--pod-line); border-radius: 12px; }
.pod-icon-pick { appearance: none; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; padding: 6px 2px 5px; border: 0; border-radius: 12px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; cursor: pointer; }
.pod-icon-pick:hover { background: var(--pod-soft); }
.pod-icon-pick:focus-visible { outline: 2px solid var(--pod-info); outline-offset: -2px; }
.pod-icon-pick-on { box-shadow: inset 0 0 0 2px var(--pod-info); background: color-mix(in srgb, var(--pod-info) 8%, transparent); color: var(--dsw-alias-label-primary); }
.pod-icon-pick-label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; line-height: 1.4; }
.pod-icon-pick-blank { display: grid; place-items: center; width: 56px; height: 56px; border: 1px dashed var(--pod-line); border-radius: 50%; }
.pod-hero-name { display: flex; align-items: center; gap: 2px; padding-left: 26px; }
.pod-hero-name strong { font-size: 20px; }
.pod-hero-form { width: 100%; max-width: 320px; text-align: left; }
.pod-tag-removable { display: inline-flex; align-items: center; gap: 4px; }
.pod-tag-removable button { appearance: none; display: inline-grid; place-items: center; padding: 0; border: 0; background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.pod-tag-add { appearance: none; border: 1px dashed var(--pod-line); background: transparent; font: inherit; cursor: pointer; }
.pod-tag-input { width: 110px; padding: 2px 10px; border-radius: 999px; font-size: 12px; }
.pod-panel-tabs { display: flex; justify-content: center; gap: 4px; }
.pod-panel-tabs button { appearance: none; padding: 6px 14px; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 14px; cursor: pointer; }
.pod-panel-tabs button:hover { background: var(--pod-soft); }
.pod-panel-tabs .pod-panel-tab-on { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); color: var(--dsw-alias-label-primary); font-weight: 600; }
.pod-box { display: flex; flex-direction: column; padding: 4px 0; border: 1px solid var(--pod-line); border-radius: 14px; background: var(--dsw-alias-bg-layer-1, #fff); }
.pod-box-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 10px 4px 14px; }
.pod-box-head strong { font-size: 14px; }
.pod-box-action { margin-left: auto; }
.pod-box-pad { padding: 4px 14px 10px; }
.pod-kv { display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: center; gap: 10px; padding: 8px 14px; font-size: 13.5px; line-height: 1.6; }
.pod-kv > span:first-child { color: var(--dsw-alias-label-tertiary); overflow-wrap: break-word; }
/* 英文标签长（Responsibilities 这类一个词就超过 64px），标签列放宽，多个词的会折行。 */
.pod-kv:lang(en) { grid-template-columns: 112px minmax(0, 1fr); }
.pod-kv-top { align-items: start; }
.pod-kv-top > span:first-child { padding-top: 4px; }
.pod-kv .pod-input { width: 100%; }
.pod-box-entry { appearance: none; display: flex; align-items: center; gap: 10px; padding: 11px 14px; border: 0; background: none; color: inherit; font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.pod-box-entry > span:first-child { flex: 1; }
.pod-box-entry:hover { background: var(--pod-soft); }
.pod-box-entry + .pod-box-entry { border-top: 1px solid color-mix(in srgb, var(--pod-line) 60%, transparent); }
.pod-persona-text { margin: 0 0 6px; white-space: pre-wrap; font-size: 13.5px; line-height: 1.65; }
.pod-stack-tight { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pod-grow { flex: 1; }
.pod-center { justify-content: center; }
.pod-member-row { display: flex; align-items: center; gap: 8px; padding: 2px 10px 2px 6px; }
.pod-member-open { appearance: none; flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0; padding: 6px 8px; border: 0; border-radius: 10px; background: none; color: inherit; font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.pod-member-open:hover { background: var(--pod-soft); }
.pod-lib-list, .pod-auto-list { display: flex; flex-direction: column; padding: 4px; border: 1px solid var(--pod-line); border-radius: 14px; background: var(--dsw-alias-bg-layer-1, #fff); }
.pod-lib-item { appearance: none; display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 0; border-radius: 10px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.pod-lib-item:hover { background: var(--pod-soft); }
.pod-lib-thumb, .pod-lib-icon { flex: none; width: 34px; height: 34px; border-radius: 6px; }
.pod-lib-thumb { border: 1px solid var(--pod-line); object-fit: cover; }
.pod-lib-icon { display: grid; place-items: center; background: var(--pod-soft); color: var(--dsw-alias-label-secondary); }
.pod-lib-web { color: var(--pod-info); }
.pod-lib-text { display: flex; flex-direction: column; min-width: 0; font-size: 13.5px; }
.pod-auto-row { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 10px; }
.pod-auto-row:hover { background: var(--pod-soft); }
.pod-auto-main { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 13.5px; }
.pod-auto-status { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.pod-auto-failed { color: var(--pod-danger); }
.pod-computer { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--pod-line); border-radius: 14px; background: var(--dsw-alias-bg-layer-1, #fff); }
.pod-computer-shot { appearance: none; overflow: hidden; aspect-ratio: 16 / 10; padding: 0; border: 0; border-radius: 10px; background: #1b1b1f; cursor: zoom-in; }
.pod-computer-shot img { display: block; width: 100%; height: 100%; object-fit: cover; }
.pod-browser-card { display: grid; grid-template-columns: 168px minmax(0, 1fr); gap: 12px; max-width: 560px; padding: 10px; border: 1px solid var(--pod-line); border-radius: 14px; background: var(--dsw-alias-bg-layer-1, #fff); }
.pod-browser-card-shot { appearance: none; overflow: hidden; aspect-ratio: 16 / 10; padding: 0; border: 0; border-radius: 8px; background: #1b1b1f; cursor: zoom-in; }
.pod-browser-card-shot img { display: block; width: 100%; height: 100%; object-fit: cover; }
.pod-browser-card-main { display: flex; flex-direction: column; justify-content: center; gap: 6px; min-width: 0; font-size: 13.5px; }
.pod-pick-list { display: flex; flex-direction: column; gap: 2px; }
.pod-pick { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; font-size: 14px; cursor: pointer; }
.pod-pick:hover { background: var(--pod-soft); }
.pod-segmented { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 3px; border-radius: 999px; background: var(--pod-soft); }
.pod-segmented button { appearance: none; padding: 4px 12px; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12.5px; white-space: nowrap; cursor: pointer; }
.pod-segmented .pod-segmented-on { background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary); box-shadow: 0 1px 2px color-mix(in srgb, #000 10%, transparent); }
.pod-segmented button:focus-visible, .pod-switch:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; }
.pod-switch { appearance: none; position: relative; flex: none; width: 38px; height: 22px; padding: 0; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent); cursor: pointer; }
.pod-switch span { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px color-mix(in srgb, #000 20%, transparent); transition: left .15s; }
.pod-switch-on { background: var(--dsw-alias-label-primary); }
.pod-switch-on span { left: 19px; }
.pod-modal-backdrop { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 24px; background: color-mix(in srgb, #000 30%, transparent); }
.pod-modal { display: flex; flex-direction: column; width: min(560px, 100%); max-height: 86vh; overflow: hidden; border-radius: 18px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 24px 64px color-mix(in srgb, #000 18%, transparent); }
.pod-modal-wide { width: min(760px, 100%); }
.pod-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px 8px; }
.pod-modal-head h2 { margin: 0; font-size: 16px; }
.pod-modal-body { flex: 1; overflow-y: auto; padding: 6px 18px 20px; }
.pod-search-input { padding: 10px 14px; border-radius: 12px; font-size: 15px; }
.pod-settings { display: flex; width: min(960px, 100%); height: min(780px, 92vh); overflow: hidden; border-radius: 20px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 24px 64px color-mix(in srgb, #000 18%, transparent); }
.pod-settings-nav { flex: none; display: flex; flex-direction: column; gap: 2px; width: 190px; padding: 16px 10px; border-right: 1px solid var(--pod-line); background: var(--pod-side-bg); }
.pod-settings-title { padding: 4px 12px 12px; font-size: 16px; }
.pod-settings-nav button { appearance: none; padding: 8px 12px; border: 0; border-radius: 10px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.pod-settings-nav button:hover { background: var(--pod-soft); }
.pod-settings-nav .pod-settings-tab-on { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); color: var(--dsw-alias-label-primary); font-weight: 600; }
.pod-settings-nav .pod-settings-stop { display: inline-flex; align-items: center; gap: 6px; color: var(--pod-danger); }
.pod-settings-content { flex: 1; display: flex; flex-direction: column; gap: 12px; min-width: 0; overflow-y: auto; padding: 18px 26px 28px; }
.pod-settings-head { display: flex; align-items: center; justify-content: space-between; }
.pod-settings-head h2 { margin: 0; font-size: 18px; }
.pod-settings-group { display: flex; flex-direction: column; gap: 6px; padding: 10px 0; border-top: 1px solid var(--pod-line); }
.pod-settings-group summary { font-size: 13px; cursor: pointer; }
.pod-recycle-row { display: flex; align-items: center; gap: 10px; font-size: 13.5px; }
.pod-recycle-row > .pod-ellipsis { flex: 1; }
.pod-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.pod-tile-stat { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border: 1px solid var(--pod-line); border-radius: 14px; }
.pod-tile-stat span { font-size: 12.5px; color: var(--dsw-alias-label-tertiary); }
.pod-tile-stat strong { font-size: 22px; font-weight: 600; letter-spacing: -.01em; }
.pod-usage-chart { gap: 12px; }
.pod-chart { display: flex; flex-direction: column; gap: 6px; padding: 22px 0 0 48px; }
.pod-chart-plot { position: relative; height: 150px; border-bottom: 1px solid var(--pod-axis); }
.pod-chart-grid { position: absolute; left: 0; right: 0; height: 0; border-top: 1px solid var(--pod-grid); }
.pod-chart-grid span { position: absolute; top: -8px; right: calc(100% + 8px); font-size: 11.5px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; font-variant-numeric: tabular-nums; }
.pod-chart-cols { position: absolute; inset: 0; display: grid; align-items: end; }
.pod-chart-col { position: relative; display: flex; align-items: flex-end; justify-content: center; height: 100%; padding: 0 1px; border-radius: 6px; outline: none; }
.pod-chart-col:focus-visible { box-shadow: inset 0 0 0 2px var(--pod-info); }
.pod-chart-bar { display: block; width: 100%; max-width: 24px; border-radius: 4px 4px 0 0; background: var(--pod-series); }
.pod-chart-col:hover .pod-chart-bar, .pod-chart-col:focus-visible .pod-chart-bar { filter: brightness(1.15); }
.pod-chart-cap { position: absolute; left: 50%; transform: translateX(-50%); font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.pod-chart-tip { position: absolute; left: 50%; z-index: 3; display: none; flex-direction: column; gap: 1px; padding: 6px 10px; transform: translateX(-50%); border-radius: 10px; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-1, #fff); font-size: 12px; white-space: nowrap; pointer-events: none; }
.pod-chart-tip strong { font-size: 13px; }
.pod-chart-tip span { opacity: .8; }
.pod-chart-tip-left { left: 0; transform: none; }
.pod-chart-tip-right { left: auto; right: 0; transform: none; }
.pod-chart-col:hover .pod-chart-tip, .pod-chart-col:focus .pod-chart-tip { display: flex; }
.pod-chart-x { display: grid; }
.pod-chart-x span { display: flex; justify-content: center; min-width: 0; font-size: 11.5px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.pod-usage-table { border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.pod-usage-table th, .pod-usage-table td { padding: 5px 16px 5px 0; border-bottom: 1px solid var(--pod-line); text-align: left; }
.pod-usage-table th { font-weight: 500; color: var(--dsw-alias-label-tertiary); }
.pod-usage-line { position: relative; display: grid; grid-template-columns: 150px minmax(0, 1fr); align-items: center; gap: 12px; min-height: 36px; padding: 2px 8px; border-radius: 10px; font-size: 13.5px; outline: none; }
.pod-usage-line:hover, .pod-usage-line:focus-visible { background: var(--pod-soft); }
.pod-usage-track { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pod-usage-fill { flex: none; display: block; height: 8px; border-radius: 0 4px 4px 0; background: var(--pod-series); }
.pod-usage-amount { font-size: 12.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.pod-usage-tip { left: 170px; bottom: calc(100% - 4px); transform: none; }
.pod-usage-line:hover .pod-usage-tip, .pod-usage-line:focus .pod-usage-tip { display: flex; }
`
