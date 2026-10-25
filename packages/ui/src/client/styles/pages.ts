/**
 * 0.6 的页面：对话里的页面卡片和小标签、右侧的页面库、页面查看器（沙箱里的页面、修改对话、版本列表）、
 * 导出菜单、新建 bot 的预设。颜色都取 dsh 的主题变量。
 */
export const PAGES_CSS = `
.pod-kind { flex: none; display: inline-grid; place-items: center; border-radius: 9px; color: var(--pod-info); background: color-mix(in srgb, var(--pod-info) 10%, transparent); }
.pod-page-card { appearance: none; display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; border: 1px solid var(--pod-line); border-radius: 14px; background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.pod-page-card:hover:not(:disabled) { border-color: color-mix(in srgb, var(--pod-info) 45%, var(--pod-line)); background: color-mix(in srgb, var(--pod-info) 3%, var(--dsw-alias-bg-layer-1, #fff)); }
.pod-page-card:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; }
.pod-page-card-gone { cursor: default; opacity: .6; }
.pod-page-card-gone .pod-kind { color: var(--dsw-alias-label-tertiary); background: var(--pod-soft); }
.pod-page-card-main { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; font-size: 13.5px; }
.pod-page-card-main strong { font-size: 14.5px; }
.pod-page-card-note { color: var(--dsw-alias-label-secondary); font-size: 13px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.pod-page-card-open { flex: none; padding: 4px 12px; border: 1px solid var(--pod-line); border-radius: 8px; font-size: 12.5px; color: var(--dsw-alias-label-primary); }
.pod-page-chip { appearance: none; display: inline-flex; align-items: center; gap: 4px; max-width: 260px; padding: 0 8px; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--pod-info) 10%, transparent); color: var(--pod-info); font: inherit; font-size: 11.5px; line-height: 20px; cursor: pointer; }
.pod-page-chip:hover:not(:disabled) { background: color-mix(in srgb, var(--pod-info) 18%, transparent); }
.pod-page-chip:disabled { cursor: default; color: var(--dsw-alias-label-tertiary); background: var(--pod-soft); }
.pod-bubble > .pod-page-chip { margin: 2px 0 4px; }
.pod-msg-head .pod-page-chip { align-self: center; }
.pod-page-library { padding-top: 14px; }
.pod-page-group-head { display: flex; align-items: center; gap: 6px; min-width: 0; margin: 4px 0 2px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-tertiary); }
.pod-page-row { display: flex; align-items: center; gap: 2px; padding-right: 4px; border-radius: 10px; }
.pod-page-row:hover { background: var(--pod-soft); }
.pod-page-row-open { appearance: none; flex: 1; display: flex; align-items: center; gap: 12px; min-width: 0; padding: 8px 10px; border: 0; border-radius: 10px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.pod-page-row-open:focus-visible { outline: 2px solid var(--pod-info); outline-offset: -2px; }
.pod-page-row-text { display: flex; flex-direction: column; min-width: 0; font-size: 13.5px; }
.pod-page-row-text .pod-rename { padding: 2px 8px; }
.pod-page-row-pin { display: inline-grid; place-items: center; width: 22px; color: var(--dsw-alias-label-tertiary); }
.pod-viewer { min-width: 0; }
.pod-viewer-head { display: flex; align-items: center; gap: 8px; min-height: 56px; padding: 10px 16px 10px 12px; border-bottom: 1px solid var(--pod-line); }
.pod-viewer-title { appearance: none; min-width: 0; padding: 4px 6px; border: 0; border-radius: 8px; background: none; color: inherit; font: inherit; cursor: text; }
.pod-viewer-title:hover:not(:disabled) { background: var(--pod-soft); }
.pod-viewer-title:disabled { cursor: default; }
.pod-viewer-title strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
.pod-viewer-rename { width: 260px; font-size: 14px; }
.pod-viewer-banner { padding: 8px 16px 0; }
.pod-viewer-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 340px; }
.pod-viewer-frame { min-width: 0; min-height: 0; display: flex; background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, var(--dsw-alias-bg-layer-1, #fff)); }
.pod-page-frame { flex: 1; width: 100%; height: 100%; border: 0; background: transparent; }
.pod-viewer-side { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-left: 1px solid var(--pod-line); background: var(--pod-side-bg); }
.pod-viewer-tabs { display: flex; gap: 4px; padding: 10px 12px 6px; }
.pod-viewer-tabs button { appearance: none; padding: 5px 14px; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13.5px; cursor: pointer; }
.pod-viewer-tabs button:hover { background: var(--pod-soft); }
.pod-viewer-tabs .pod-panel-tab-on { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); color: var(--dsw-alias-label-primary); font-weight: 600; }
.pod-viewer-side-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 12px 20px; }
.pod-thread { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.pod-thread-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 6px 14px 14px; }
.pod-thread-empty { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; padding: 14px; border: 1px dashed var(--pod-line); border-radius: 12px; font-size: 13px; color: var(--dsw-alias-label-tertiary); }
.pod-thread-empty strong { color: var(--dsw-alias-label-secondary); font-size: 13.5px; }
.pod-thread-owner { display: flex; justify-content: flex-end; }
.pod-thread-owner .pod-bubble { max-width: 88%; white-space: pre-wrap; font-size: 13.5px; }
.pod-thread-bot { display: flex; align-items: flex-start; gap: 8px; }
.pod-thread-bot-main { flex: 1; min-width: 0; font-size: 13.5px; }
.pod-thread-live .pod-thread-bot-main { opacity: .85; }
.pod-thread-line { display: flex; align-items: baseline; gap: 8px; padding: 0 4px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.pod-thread-line span { flex: 1; min-width: 0; }
.pod-thread-line time { flex: none; font-size: 11px; }
.pod-thread-compose { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px 12px; border-top: 1px solid var(--pod-line); }
.pod-thread-compose .pod-textarea { min-height: 72px; resize: none; background: var(--dsw-alias-bg-layer-1, #fff); }
.pod-page-versions { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.pod-page-versions li { border-radius: 10px; }
.pod-page-version { appearance: none; display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 8px 10px; border: 0; border-radius: 10px; background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.pod-page-version:hover { background: var(--pod-soft); }
.pod-page-version:focus-visible { outline: 2px solid var(--pod-info); outline-offset: -2px; }
.pod-page-version-on { background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pod-info) 40%, var(--pod-line)); }
.pod-page-version-on .pod-page-version:hover { background: none; }
.pod-page-version-note { color: var(--dsw-alias-label-secondary); }
.pod-page-version-actions { padding: 0 10px 10px; }
.pod-export-item { flex-direction: column; align-items: flex-start; gap: 0; }
.pod-hit-page { flex-direction: row; align-items: center; gap: 10px; }
.pod-presets { display: flex; flex-direction: column; gap: 6px; padding-bottom: 10px; border-bottom: 1px solid var(--pod-line); }
.pod-preset { appearance: none; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--pod-line); border-radius: 12px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.pod-preset:hover:not(:disabled) { background: var(--pod-soft); }
.pod-preset:disabled { opacity: .5; cursor: default; }
.pod-preset:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; }
.pod-preset-text { flex: 1; display: flex; flex-direction: column; min-width: 0; font-size: 13.5px; }
.pod-preset-go { flex: none; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
@media (max-width: 1100px) { .pod-viewer-body { grid-template-columns: minmax(0, 1fr) 300px; } }
@media (max-width: 900px) {
  .pod-viewer-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(240px, 38%); }
  .pod-viewer-side { border-left: 0; border-top: 1px solid var(--pod-line); }
  .pod-viewer-head .pod-badge, .pod-viewer-head .pod-muted-inline { display: none; }
}
`
